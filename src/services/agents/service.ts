import { join } from 'node:path';
import { z } from 'zod';
import {
  agentSettingsSchema,
  defaultAgentSettings,
  type AgentSettings,
  harnessSchema,
} from '../../contracts/agent';
import type { AgentCommand, AgentState, HarnessKind } from '../../contracts/agent';
import { ProjectService } from '../project/projects';
import { BuildService } from '../latex/builds';
import { AgentChanges } from './changes';
import { OpenCodeAdapter, object, string, list, type HarnessAdapter } from './opencode';
import { OpenCodeClassicAdapter } from './opencode-classic';
import { CodexAdapter } from './codex';
import { AgentTools } from './tools';

type SessionRef = { id: string; harness: HarnessKind; title: string; settings?: AgentSettings };
function authorMessages(messages: AgentState['messages']) {
  return messages.map((message) => {
    if (message.role !== 'user') return message;
    const marker = /\n\nLoom author request \((\d+) characters\):\n/.exec(message.text);
    if (
      !message.text.startsWith('You are helping with the research paper “') ||
      !marker ||
      marker.index === undefined
    )
      return message;
    const start = marker.index + marker[0].length;
    const length = Number(marker[1]);
    if (!Number.isSafeInteger(length) || length > 50000 || start + length > message.text.length)
      return message;
    return { ...message, text: message.text.slice(start, start + length) };
  });
}
export class AgentService {
  private adapter: HarnessAdapter | null = null;
  private tools: AgentTools | null = null;
  private changes: AgentChanges;
  private projectId = '';
  private generation = 0;
  private refreshBusy = false;
  private state: AgentState | null = null;
  private sessions: SessionRef[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private backgroundQueued = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private projects: ProjectService,
    private builds: BuildService,
    directory: string,
  ) {
    this.changes = new AgentChanges(projects, join(directory, 'agent-recovery'));
    this.timer = setInterval(() => {
      if (this.state?.running && !this.backgroundQueued) {
        this.backgroundQueued = true;
        void this.serialized(() => this.refresh())
          .catch(() => {})
          .finally(() => {
            this.backgroundQueued = false;
          });
      }
    }, 650);
  }
  async initialize() {
    const current = await this.projects.run(() => this.projects.current());
    if (current) await this.serialized(() => this.bind(current.id));
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  active() {
    return !!this.state?.running || !!this.changes.unsettled();
  }
  private persist() {
    this.projects.store.set(
      `agent-sessions:${this.projectId}`,
      JSON.stringify({
        version: 1,
        sessions: this.sessions,
        sessionId: this.state?.sessionId,
        harness: this.state?.harness,
      }),
    );
  }
  private async bind(projectId: string) {
    await this.projects.run(async () => {
      await this.projects.current();
      this.projects.buildContext(projectId);
    });
    if (this.projectId === projectId) return;
    if (this.active()) throw new Error('Stop the current agent request before changing papers.');
    await this.disconnect();
    const raw = JSON.parse(
      this.projects.store.get(`agent-sessions:${projectId}`) ?? '{"version":1,"sessions":[]}',
    );
    const parsed = z
      .object({
        version: z.literal(1),
        sessions: z
          .array(
            z
              .object({
                id: z.string().min(1).max(160),
                harness: harnessSchema,
                title: z.string().max(300),
                settings: agentSettingsSchema.optional(),
              })
              .strict(),
          )
          .max(100),
        sessionId: z.string().max(160).nullable().optional(),
        harness: harnessSchema.optional(),
      })
      .strict()
      .safeParse(raw.version === undefined ? { ...raw, version: 1 } : raw);
    if (!parsed.success)
      throw new Error(
        'Agent conversation references need a compatible Loom version. Keep application data to retain recovery.',
      );
    await this.changes.bind(projectId);
    const stored = parsed.data;
    this.projectId = projectId;
    this.sessions = stored.sessions;
    this.state = {
      projectId,
      harness: stored.harness ?? 'opencode',
      providers: [
        { id: 'opencode', installed: false, version: 'Not checked', auth: 'unknown' },
        { id: 'codex', installed: false, version: 'Not checked', auth: 'unknown' },
      ],
      connection: 'disconnected',
      installed: false,
      version: 'Not checked',
      ownership: null,
      models: [],
      sessions: this.sessions,
      sessionId: stored.sessionId ?? null,
      settings:
        stored.sessions.find((ref) => ref.id === stored.sessionId)?.settings ??
        defaultAgentSettings(),
      messages: [],
      permissions: [],
      questions: [],
      turns: this.changes.views(),
      running: false,
      error: '',
      toolsAvailable: false,
    };
    const recovered = await this.projects.run(() => this.changes.recoverInterrupted());
    if (!recovered)
      this.state.error =
        'A previous agent process has not stopped. Wait for it to exit, then refresh to recover the paper.';
  }
  private async detect() {
    const [opencode, codex] = await Promise.all([
      OpenCodeAdapter.detect(this.projects.store.get('agent-runtime:opencode') ?? undefined),
      CodexAdapter.detect(this.projects.store.get('agent-runtime:codex') ?? undefined),
    ]);
    this.state!.providers = this.state!.providers.map((p) => ({
      ...p,
      ...(p.id === 'opencode'
        ? {
            installed: opencode.installed,
            version: opencode.version,
            executable: opencode.executable ?? '',
          }
        : {
            installed: codex.installed,
            version: codex.version,
            executable: codex.executable ?? '',
          }),
    }));
    const current = this.state!.providers.find((p) => p.id === this.state!.harness)!;
    this.state!.installed = current.installed;
    this.state!.version = current.version;
  }
  private async confirmedIdle(adapter: HarnessAdapter, sessionId: string) {
    for (let attempt = 0; attempt < 12; attempt++) {
      if (!(await adapter.active(sessionId))) {
        const session = await adapter.session(sessionId);
        const turn = this.changes.running() ?? this.changes.unsettledExternal();
        if (
          adapter instanceof CodexAdapter ||
          !turn ||
          Number(object(session.time).idle) >= Date.parse(turn.view.startedAt)
        )
          return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }
  private async disconnect(outcome: 'interrupted' | 'cancelled' = 'interrupted') {
    ++this.generation;
    const adapter = this.adapter,
      s = this.state;
    if (adapter) {
      adapter.onLost = undefined;
      if (s?.running && s.sessionId) {
        let idle = false;
        try {
          await adapter.interrupt(s.sessionId);
          idle = await this.confirmedIdle(adapter, s.sessionId);
        } catch {
          /* Owned process closure below is the fallback. */
        }
        if (!idle && adapter.ownership === 'external') {
          s.connection = 'interrupted';
          s.error =
            'OpenCode has not confirmed that this request stopped. Stop it in OpenCode, then retry Disconnect. Partial work remains protected.';
          throw new Error(s.error);
        }
      }
      await adapter.close();
      // Close/confirmed-idle precedes the final observation so late partial writes are included.
      if (s?.running) await this.projects.run(() => this.changes.finish(outcome));
    }
    this.adapter = null;
    await this.tools?.close();
    this.tools = null;
    if (s) {
      s.connection = 'disconnected';
      s.running = false;
      s.permissions = [];
      s.questions = [];
      s.ownership = null;
      s.toolsAvailable = false;
    }
  }
  async command(command: AgentCommand): Promise<AgentState> {
    // Cancel/permission requests must not wait behind a long model execution; submit returns only admission.
    return this.serialized(async () => {
      await this.bind(command.projectId);
      const s = this.state!;
      if (command.type === 'status') {
        if (!s.running && this.changes.unsettled() && !this.changes.unsettledExternal()) {
          const recovered = await this.projects.run(() => this.changes.recoverInterrupted());
          if (recovered) s.error = '';
        }
        if (command.detect || s.version === 'Not checked') await this.detect();
        if (this.adapter) await this.refresh();
        s.turns = this.changes.views();
        return structuredClone(s);
      }
      if (command.type === 'settings') {
        if (s.running || this.changes.unsettled())
          throw new Error(
            'Stop or recover the current request before changing its permissions or reasoning.',
          );
        s.settings = command.settings;
        const ref = this.sessions.find((ref) => ref.id === s.sessionId);
        if (ref) ref.settings = { ...s.settings };
        this.persist();
        return structuredClone(s);
      }
      if (command.type === 'disconnect') {
        await this.disconnect();
        return structuredClone(s);
      }
      if (command.type === 'connect') {
        if (s.running && s.connection === 'connected')
          throw new Error('Stop the current request before changing agent connections.');
        await this.disconnect();
        if (s.harness !== command.harness) s.settings = defaultAgentSettings();
        s.harness = command.harness;
        s.error = '';
        const context = await this.projects.run(async () =>
          this.projects.buildContext(command.projectId),
        );
        const generation = ++this.generation;
        try {
          this.tools = await new AgentTools(this.projects, this.builds, command.projectId).start();
          const adapter =
            command.harness === 'codex'
              ? await CodexAdapter.owned(
                  context.root,
                  {
                    url: this.tools.url,
                    token: this.tools.token,
                  },
                  command.executable ?? this.projects.store.get('agent-runtime:codex') ?? undefined,
                )
              : command.endpoint
                ? await OpenCodeAdapter.attach(
                    command.endpoint,
                    command.password ?? '',
                    command.username ?? 'opencode',
                  )
                : await OpenCodeAdapter.owned(
                    context.root,
                    command.executable ??
                      this.projects.store.get('agent-runtime:opencode') ??
                      undefined,
                  );
          this.adapter = adapter;
          s.models = await adapter.models(context.root);
          if (adapter instanceof OpenCodeAdapter || adapter instanceof OpenCodeClassicAdapter) {
            await adapter.verify();
            if (adapter.ownership === 'loom')
              await adapter.configureTools(context.root, this.tools.url, this.tools.token);
            await adapter.stream();
          }
          s.version = adapter.version;
          s.installed = true;
          s.ownership = adapter.ownership;
          s.connection = 'connected';
          s.toolsAvailable = adapter.ownership === 'loom';
          const authentication =
            adapter instanceof CodexAdapter
              ? adapter.auth
              : adapter instanceof OpenCodeAdapter || adapter instanceof OpenCodeClassicAdapter
                ? await adapter.authentication(context.root)
                : 'unknown';
          s.providers = s.providers.map((p) =>
            p.id === s.harness
              ? {
                  ...p,
                  installed: true,
                  version: adapter.version,
                  auth: authentication,
                }
              : p,
          );
          adapter.onLost = () => {
            if (generation !== this.generation) return;
            s.connection = 'interrupted';
            s.error =
              'Agent connection interrupted. Reconnect to recover the conversation and review partial changes.';
            s.permissions = [];
            s.questions = [];
            // Do not finalize an unknown native execution merely because its stream failed.
          };
          if (
            s.sessionId &&
            this.sessions.find((r) => r.id === s.sessionId)?.harness === s.harness
          ) {
            try {
              await this.resume(s.sessionId);
            } catch (error) {
              if (this.changes.unsettledExternal()) throw error;
              s.error =
                'The saved conversation is unavailable on this server. Start a new chat to continue; recovery comparisons are retained.';
              s.sessionId = null;
            }
          } else s.sessionId = null;
          if (command.executable !== undefined)
            this.projects.store.set('agent-runtime:' + command.harness, command.executable);
          this.persist();
          return structuredClone(s);
        } catch (error) {
          await this.disconnect();
          s.error = error instanceof Error ? error.message : 'Agent connection failed.';
          throw error;
        }
      }
      const adapter = this.adapter;
      if (!adapter || s.connection !== 'connected')
        throw new Error('Connect an agent in Agent connections first.');
      if (command.type === 'session') {
        if (s.running) throw new Error('Stop the current request before changing chats.');
        if (command.sessionId) {
          if (!this.sessions.some((r) => r.id === command.sessionId && r.harness === s.harness))
            throw new Error('This conversation belongs to another agent. Connect its agent first.');
          await this.resume(command.sessionId);
          s.settings =
            this.sessions.find((ref) => ref.id === command.sessionId)?.settings ??
            defaultAgentSettings();
          this.persist();
        } else {
          if (this.sessions.length >= 100)
            throw new Error('This pilot supports up to 100 chats per paper.');
          const id = await adapter.create(
            (await this.projects.run(async () => this.projects.buildContext(command.projectId)))
              .root,
          );
          if (!id) throw new Error('The harness did not return a session identity.');
          s.sessionId = id;
          this.sessions.unshift({
            id,
            harness: s.harness,
            title: 'New conversation',
            settings: { ...s.settings },
          });
          s.messages = [];
          this.persist();
        }
      } else if (command.type === 'send') {
        if (s.running || this.changes.unsettled())
          throw new Error('Reconnect and stop the previous request before sending another.');
        if (command.sessionId !== s.sessionId)
          throw new Error('The active conversation changed. Try again.');
        const model = s.models.find(
          (m) => m.id === command.model.id && m.providerId === command.model.providerId,
        );
        if (!model)
          throw new Error('This model is no longer available. Choose an available model.');
        const reasoning = s.settings.reasoning || model.defaultReasoning || '';
        if (reasoning && !(model.reasoningEfforts ?? []).includes(reasoning))
          throw new Error('Choose a reasoning level supported by this model.');
        const context = await this.projects.run(async () => {
          const context = this.projects.buildContext(command.projectId);
          for (const path of command.attachments) {
            const file = context.files.find((f) => f.path === path && f.diskKind === 'text');
            if (!file)
              throw new Error(
                'Attach a text file from this paper. Image workflows arrive separately.',
              );
          }
          if (
            command.selection &&
            !context.files.some(
              (f) =>
                f.path === command.selection!.path && f.text?.includes(command.selection!.text),
            )
          )
            throw new Error('The selected passage changed. Attach it again.');
          await this.changes.begin(
            command.sessionId,
            command.revision,
            adapter.ownership === 'external',
            adapter.supervisorPid,
          );
          return context;
        });
        const selection = command.selection;
        const prompt = `You are helping with the research paper “${context.snapshot.name}”. Work in this paper folder using your native filesystem and shell tools. You can read, create and edit ordinary .tex/.bib files and subfolders as the author requests. Do not use browser or Loom editor UI automation to access manuscript files. For questions, inspect and explain without changing files unless the author asks. Inspect relevant source files and cite project-relative paths in explanations. Changes are direct writes followed by review, not staged proposals. Preserve unrelated author writing. Do not commit, push or claim a build/check ran without an actual tool result.${s.toolsAvailable ? ' Loom MCP tools inspect paper structure and schedule/review saved-source PDF builds.' : ''}\n\nLoom author request (${command.prompt.length} characters):\n${command.prompt}${selection ? '\n\nAuthor-selected passage from ' + selection.path + ':\n' + selection.text : ''}`;
        s.running = true;
        s.error = '';
        try {
          await adapter.submit(
            command.sessionId,
            prompt,
            model,
            command.attachments.map((path) => join(context.root, path)),
            { ...s.settings, reasoning },
          );
          const ref = this.sessions.find((r) => r.id === command.sessionId)!;
          if (ref.title === 'New conversation') ref.title = command.prompt.slice(0, 80);
          this.persist();
        } catch (error) {
          s.connection = 'interrupted';
          s.error =
            'Request admission was interrupted. Reconnect and inspect the chat before sending again; partial work is retained.';
          throw error;
        }
      } else if (command.type === 'cancel') {
        if (s.sessionId && s.running) {
          await adapter.interrupt(s.sessionId);
          await this.refresh();
          if (
            s.running &&
            adapter instanceof OpenCodeClassicAdapter &&
            adapter.ownership === 'loom'
          ) {
            await this.disconnect('cancelled');
          }
          if (!s.running) await this.projects.run(() => this.changes.finish('cancelled'));
        }
      } else if (command.type === 'permission' || command.type === 'answer') {
        if (!s.sessionId) throw new Error('No active conversation.');
        if (command.type === 'permission') {
          if (!s.permissions.some((p) => p.id === command.requestId))
            throw new Error('This permission request is no longer pending.');
          await adapter.permission(s.sessionId, command.requestId, command.reply);
        } else {
          if (!s.questions.some((q) => q.id === command.requestId))
            throw new Error('This question is no longer pending.');
          await adapter.answer(s.sessionId, command.requestId, command.answer, command.reject);
        }
        await this.refresh();
      } else if (command.type === 'review') {
        await this.projects.run(() =>
          this.changes.review(command.turnId, command.path, command.action, command.revision),
        );
      }
      s.turns = this.changes.views();
      return structuredClone(s);
    });
  }
  private async resume(id: string) {
    const adapter = this.adapter!,
      s = this.state!;
    const context = await this.projects.run(async () => this.projects.buildContext(this.projectId));
    if (adapter instanceof CodexAdapter) await adapter.resume(id, context.root);
    const session = await adapter.session(id);
    if (string(object(session.location).directory) !== context.root)
      throw new Error('This conversation belongs to a different paper folder.');
    const unresolved = this.changes.unsettledExternal();
    if ((await adapter.active(id)) || unresolved?.view.sessionId === id) {
      await adapter.interrupt(id);
      if (!(await this.confirmedIdle(adapter, id)))
        throw new Error('The native request is still stopping. Reconnect again before continuing.');
    }
    if (unresolved?.view.sessionId === id)
      await this.projects.run(() => this.changes.settleExternal());
    const messages = authorMessages(await adapter.messages(id));
    s.sessionId = id;
    s.messages = messages;
    this.persist();
  }
  private async refresh() {
    if (
      this.refreshBusy ||
      !this.adapter ||
      !this.state?.sessionId ||
      this.state.connection !== 'connected'
    )
      return;
    this.refreshBusy = true;
    const generation = this.generation,
      adapter = this.adapter,
      s = this.state,
      sessionId = s.sessionId!;
    try {
      const [messages, pending, active] = await Promise.all([
        adapter.messages(sessionId),
        adapter.pending(sessionId),
        adapter.active(sessionId),
      ]);
      if (generation !== this.generation || s.sessionId !== sessionId) return;
      s.messages = authorMessages(messages);
      s.permissions = pending.permissions.map((p) => ({
        id: string(p.id),
        action: string(p.action),
        resources: Array.isArray(p.resources)
          ? p.resources.slice(0, 100).map((v) => string(v).slice(0, 3000))
          : [],
      }));
      s.questions = pending.questions.map((q) => ({
        id: string(q.id),
        title: string(q.title),
        rejectable: q.rejectable === true,
        fields: list(q.fields)
          .slice(0, 100)
          .map((value) => {
            const f = object(value);
            return {
              key: string(f.key),
              title: string(f.title),
              description: string(f.description),
              type: ['string', 'multiselect', 'boolean', 'number', 'integer', 'external'].includes(
                string(f.type),
              )
                ? (string(f.type) as 'string')
                : 'external',
              required: f.required === true,
              options: Array.isArray(f.options)
                ? f.options.slice(0, 100).map((value) => {
                    const o = object(value);
                    return { value: string(o.value), label: string(o.label) };
                  })
                : [],
            };
          }),
      }));
      if (s.running) {
        const session = !active ? await adapter.session(sessionId) : null;
        await this.projects.run(async () => {
          if (generation !== this.generation) return;
          await this.changes.observe();
          const finished =
            session &&
            (adapter instanceof CodexAdapter ||
              Number(object(session.time).idle) >=
                Date.parse(this.changes.running()?.view.startedAt ?? ''));
          if (finished) {
            const outcome = string(session.outcome);
            await this.changes.finish(
              outcome === 'succeeded'
                ? 'succeeded'
                : outcome === 'interrupted'
                  ? 'cancelled'
                  : outcome === 'failed'
                    ? 'failed'
                    : 'interrupted',
            );
            s.running = false;
          }
        });
      }
      s.turns = this.changes.views();
    } catch {
      if (generation === this.generation) {
        s.connection = 'interrupted';
        s.error =
          'The agent connection was interrupted. Reconnect before continuing. Partial work is retained.';
        s.permissions = [];
        s.questions = [];
      }
    } finally {
      this.refreshBusy = false;
    }
  }
  async close() {
    clearInterval(this.timer);
    await this.disconnect();
  }
}
