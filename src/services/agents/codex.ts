import { findExecutable, runTool, spawnOwnedTool } from '../latex/tools';
import { object, list, string, type HarnessAdapter } from './opencode';
import type { AgentMessage, AgentModel } from '../../contracts/agent';
import { StringDecoder } from 'node:string_decoder';

type Session = {
  directory: string;
  messages: AgentMessage[];
  turnId: string;
  running: boolean;
  outcome: string;
  permissions: Map<
    string,
    { nativeId: string | number; method: string; params: Record<string, unknown> }
  >;
  questions: Map<string, { nativeId: string | number; params: Record<string, unknown> }>;
};
export class CodexAdapter implements HarnessAdapter {
  readonly capabilities = {
    streaming: true,
    permissions: true,
    questions: true,
    nativeWrites: true,
    images: true,
  };
  version = '';
  ownership = 'loom' as const;
  onEvent?: (event: Record<string, unknown>) => void;
  onLost?: () => void;
  auth: 'available' | 'required' | 'unknown' = 'unknown';
  private child: ReturnType<typeof spawnOwnedTool>;
  private pendingRPC = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      method: string;
    }
  >();
  private sessions = new Map<string, Session>();
  private earlyEvents = new Map<string, Record<string, unknown>[]>();
  private nextId = 0;
  private ended = false;
  private constructor(
    executable: string,
    directory: string,
    version: string,
    tool?: { url: string; token: string },
  ) {
    this.version = version;
    const args = ['app-server', '--listen', 'stdio://'];
    if (tool)
      args.push(
        '-c',
        `mcp_servers.loom.url=${JSON.stringify(tool.url)}`,
        '-c',
        'mcp_servers.loom.bearer_token_env_var="LOOM_AGENT_TOOL_TOKEN"',
      );
    this.child = spawnOwnedTool(
      executable,
      args,
      directory,
      tool ? { LOOM_AGENT_TOOL_TOKEN: tool.token } : undefined,
    );
    this.child.stderr.resume();
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    this.child.stdout.on('data', (bytes: Buffer) => {
      buffer += decoder.write(bytes);
      if (buffer.length > 16 * 1024 * 1024) {
        this.fail();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          this.receive(object(JSON.parse(line)));
        } catch {
          this.fail();
          return;
        }
      }
    });
    this.child.on('error', () => this.fail());
    this.child.on('exit', () => this.fail());
  }
  static async detect() {
    const executable = await findExecutable('codex');
    if (!executable) return { installed: false, version: 'Not installed', executable: null };
    try {
      const r = await runTool(executable, ['--version'], { timeoutMs: 5000 });
      return {
        installed: r.code === 0,
        version: r.output.match(/\d+\.\d+\.\d+/)?.[0] ?? 'Unknown',
        executable,
      };
    } catch {
      return { installed: false, version: 'Version check failed', executable };
    }
  }
  static async owned(directory: string, tool?: { url: string; token: string }) {
    const found = await this.detect();
    if (!found.installed || !found.executable)
      throw new Error('Install Codex and sign in with “codex login”, then connect again.');
    if (!/^0\.159\./.test(found.version))
      throw new Error(`Codex ${found.version} is incompatible. This Loom build supports 0.159.x.`);
    const adapter = new CodexAdapter(found.executable, directory, found.version, tool);
    try {
      await adapter.rpc('initialize', {
        clientInfo: { name: 'loom', title: 'Loom', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      adapter.write({ method: 'initialized' });
      const account = object(await adapter.rpc('account/read', {}));
      adapter.auth = account.account
        ? 'available'
        : account.requiresOpenaiAuth === false
          ? 'available'
          : 'required';
      return adapter;
    } catch (error) {
      await adapter.close();
      throw error;
    }
  }
  private write(value: unknown) {
    if (this.ended) throw new Error('Codex connection is closed.');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  private fail() {
    if (this.ended) return;
    this.ended = true;
    for (const p of this.pendingRPC.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Codex connection interrupted. Reconnect to continue.'));
    }
    this.pendingRPC.clear();
    for (const s of this.sessions.values()) {
      s.running = false;
      s.outcome = 'interrupted';
      s.permissions.clear();
      s.questions.clear();
    }
    this.child.stdin.end();
    this.onLost?.();
  }
  private rpc(method: string, params: unknown): Promise<unknown> {
    if (this.pendingRPC.size >= 32) return Promise.reject(new Error('Too many Codex requests.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRPC.delete(id);
        reject(new Error('Codex request timed out. Reconnect before retrying.'));
      }, 12000);
      this.pendingRPC.set(id, { resolve, reject, timer, method });
      try {
        this.write({ id, method, params });
      } catch {
        clearTimeout(timer);
        this.pendingRPC.delete(id);
        reject(new Error('Codex connection closed.'));
      }
    });
  }
  private receive(message: Record<string, unknown>) {
    if (typeof message.id === 'number' && !message.method) {
      const p = this.pendingRPC.get(message.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pendingRPC.delete(message.id);
      if (message.error)
        p.reject(
          new Error(
            `Codex rejected ${p.method} (code ${typeof object(message.error).code === 'number' ? object(message.error).code : 'unknown'}). Check sign-in, model access and connection.`,
          ),
        );
      else p.resolve(message.result);
      return;
    }
    const method = string(message.method),
      p = message.params ? object(message.params) : {};
    const threadId = string(p.threadId);
    const session = this.sessions.get(threadId);
    if (message.id !== undefined) {
      const nativeId = typeof message.id === 'number' ? message.id : string(message.id);
      const key = String(nativeId);
      if (!session) {
        if (threadId && this.earlyEvents.size < 32) {
          const events = this.earlyEvents.get(threadId) ?? [];
          if (events.length < 200) {
            events.push(message);
            this.earlyEvents.set(threadId, events);
            return;
          }
        }
        this.write({ id: nativeId, error: { code: -32601, message: 'No matching Loom session.' } });
        return;
      }
      if (method === 'item/tool/requestUserInput')
        session.questions.set(key, { nativeId, params: p });
      else if (
        method === 'item/commandExecution/requestApproval' ||
        method === 'item/fileChange/requestApproval'
      )
        session.permissions.set(key, { nativeId, method, params: p });
      else {
        this.write({
          id: nativeId,
          error: {
            code: -32601,
            message:
              'This request is not supported in Loom. Use the harness directly for this capability.',
          },
        });
      }
      this.onEvent?.({ type: 'pending', sessionId: threadId });
      return;
    }
    if (!session) {
      if (threadId && this.earlyEvents.size < 32) {
        const events = this.earlyEvents.get(threadId) ?? [];
        if (events.length < 200) {
          events.push(message);
          this.earlyEvents.set(threadId, events);
        }
      }
      return;
    }
    if (method === 'turn/started') {
      session.turnId = string(object(p.turn).id);
      session.running = true;
    }
    if (method === 'item/agentMessage/delta') {
      const id = string(p.itemId);
      let m = session.messages.find((m) => m.id === id);
      if (!m) {
        m = { id, role: 'assistant', text: '', state: '' };
        session.messages.push(m);
      }
      m.text = (m.text + string(p.delta)).slice(0, 100000);
    }
    if (method === 'item/started' || method === 'item/completed') {
      const item = object(p.item),
        type = string(item.type),
        id = string(item.id);
      if (type === 'agentMessage' && method === 'item/completed') {
        const old = session.messages.find((m) => m.id === id);
        if (old) old.text = string(item.text).slice(0, 100000);
        else
          session.messages.push({
            id,
            role: 'assistant',
            text: string(item.text).slice(0, 100000),
            state: '',
          });
      }
      if (
        ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall'].includes(
          type,
        )
      ) {
        const m = {
          id,
          role: 'tool' as const,
          text:
            type === 'commandExecution'
              ? string(item.command)
              : type === 'mcpToolCall'
                ? string(item.tool)
                : type,
          state: method === 'item/started' ? 'running' : string(item.status, 'completed'),
        };
        const old = session.messages.findIndex((v) => v.id === id);
        if (old >= 0) session.messages[old] = m;
        else session.messages.push(m);
      }
    }
    if (method === 'turn/completed') {
      const turn = object(p.turn);
      session.running = false;
      session.turnId = '';
      session.outcome =
        turn.status === 'completed'
          ? 'succeeded'
          : turn.status === 'interrupted'
            ? 'interrupted'
            : 'failed';
      session.permissions.clear();
      session.questions.clear();
      session.messages.push({
        id: string(turn.id) + ':status',
        role: 'status',
        text:
          session.outcome === 'succeeded'
            ? 'Request complete'
            : session.outcome === 'interrupted'
              ? 'Request stopped · partial work is retained'
              : 'Request failed · partial work is retained',
        state: session.outcome,
      });
    }
    session.messages = session.messages.slice(-200);
    this.onEvent?.({ type: method, sessionId: threadId });
  }
  async models(_directory: string): Promise<AgentModel[]> {
    const out: AgentModel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = object(
        await this.rpc('model/list', { limit: 100, ...(cursor ? { cursor } : {}) }),
      );
      for (const raw of list(response.data)) {
        const m = object(raw);
        if (m.hidden === true) continue;
        out.push({
          id: string(m.model, string(m.id)),
          providerId: 'codex',
          name: string(m.displayName),
          images: Array.isArray(m.inputModalities) && m.inputModalities.includes('image'),
          tools: true,
        });
      }
      cursor = typeof response.nextCursor === 'string' ? response.nextCursor : undefined;
      if (!cursor) break;
    }
    return out.slice(0, 3000);
  }
  private options(directory: string) {
    return {
      cwd: directory,
      sandbox: 'workspace-write',
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'user',
    };
  }
  private replay(sessionId: string) {
    const events = this.earlyEvents.get(sessionId) ?? [];
    this.earlyEvents.delete(sessionId);
    for (const event of events) this.receive(event);
  }
  async create(directory: string) {
    const response = object(await this.rpc('thread/start', this.options(directory)));
    const id = string(object(response.thread).id);
    this.sessions.set(id, {
      directory,
      messages: [],
      turnId: '',
      running: false,
      outcome: '',
      permissions: new Map(),
      questions: new Map(),
    });
    this.replay(id);
    return id;
  }
  async resume(sessionId: string, directory: string) {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.directory !== directory)
        throw new Error('This Codex conversation belongs to another paper folder.');
      return;
    }
    const response = object(
      await this.rpc('thread/resume', {
        threadId: sessionId,
        ...this.options(directory),
        excludeTurns: false,
      }),
    );
    const thread = object(response.thread);
    if (string(thread.cwd) !== directory)
      throw new Error('This Codex conversation belongs to another paper folder.');
    const s: Session = {
      directory,
      messages: [],
      turnId: '',
      running: string(object(thread.status).type) === 'active',
      outcome: '',
      permissions: new Map(),
      questions: new Map(),
    };
    this.sessions.set(sessionId, s);
    for (const raw of Array.isArray(thread.turns) ? thread.turns : []) {
      const turn = object(raw);
      if (turn.status === 'inProgress') s.turnId = string(turn.id);
      for (const value of Array.isArray(turn.items) ? turn.items : []) {
        const item = object(value);
        if (item.type === 'agentMessage')
          s.messages.push({
            id: string(item.id),
            role: 'assistant',
            text: string(item.text).slice(0, 100000),
            state: '',
          });
        if (item.type === 'userMessage') {
          const content = Array.isArray(item.content) ? item.content : [];
          s.messages.push({
            id: string(item.id),
            role: 'user',
            text: content
              .map((v) => string(object(v).text))
              .join('\n')
              .slice(0, 100000),
            state: '',
          });
        }
      }
    }
    s.messages = s.messages.slice(-200);
    this.replay(sessionId);
  }
  async session(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('Reconnect this Codex conversation.');
    return { location: { directory: s.directory }, outcome: s.outcome };
  }
  async submit(sessionId: string, prompt: string, model: AgentModel, files: string[]) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('Reconnect this conversation.');
    const text =
      prompt +
      (files.length
        ? '\n\nExplicitly attached project files (inspect these paths):\n' + files.join('\n')
        : '');
    s.running = true;
    s.outcome = '';
    try {
      const response = object(
        await this.rpc('turn/start', {
          threadId: sessionId,
          input: [{ type: 'text', text, text_elements: [] }],
          model: model.id,
        }),
      );
      const turnId = string(object(response.turn).id);
      if (s.running) s.turnId = turnId;
      s.messages.push({ id: turnId + ':user', role: 'user', text: prompt, state: '' });
    } catch (error) {
      // Admission can time out after Codex accepted a turn. Stop the owned process
      // before the caller takes its final filesystem checkpoint.
      await this.close();
      throw error;
    }
  }
  async interrupt(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s?.turnId) await this.rpc('turn/interrupt', { threadId: sessionId, turnId: s.turnId });
  }
  async active(sessionId: string) {
    return this.sessions.get(sessionId)?.running ?? false;
  }
  async messages(sessionId: string) {
    return this.sessions.get(sessionId)?.messages ?? [];
  }
  async pending(sessionId: string) {
    const s = this.sessions.get(sessionId);
    return {
      permissions: [...(s?.permissions ?? [])].map(([id, r]) => ({
        id,
        action: r.method.includes('fileChange') ? 'Change project files' : 'Run a command',
        resources: [
          string(r.params.command, string(r.params.reason, 'Requested native operation')),
        ],
      })),
      questions: [...(s?.questions ?? [])].map(([id, r]) => ({
        id,
        title: 'A question about your paper',
        fields: list(r.params.questions).map((value) => {
          const q = object(value);
          return {
            key: string(q.id),
            type: 'string',
            title: string(q.question),
            required: true,
            options: Array.isArray(q.options)
              ? q.options.map((v) => {
                  const o = object(v);
                  return { value: string(o.label), label: string(o.label) };
                })
              : [],
          };
        }),
      })),
    };
  }
  async permission(sessionId: string, id: string, reply: 'once' | 'reject') {
    const s = this.sessions.get(sessionId),
      r = s?.permissions.get(id);
    if (!r) throw new Error('This approval request is no longer pending.');
    const decision = reply === 'reject' ? 'decline' : 'accept';
    const options = r.params.availableDecisions;
    if (Array.isArray(options) && !options.includes(decision))
      throw new Error(
        'This native approval needs options not supported in Loom. Deny it or use Codex directly.',
      );
    this.write({ id: r.nativeId, result: { decision } });
    s!.permissions.delete(id);
  }
  async answer(sessionId: string, id: string, answer: unknown) {
    const s = this.sessions.get(sessionId),
      r = s?.questions.get(id);
    if (!r) throw new Error('This question is no longer pending.');
    const values = object(answer);
    this.write({
      id: r.nativeId,
      result: {
        answers: Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key,
            { answers: Array.isArray(value) ? value : [String(value)] },
          ]),
        ),
      },
    });
    s!.questions.delete(id);
  }
  async close() {
    this.onLost = undefined;
    const child = this.child;
    const exited = child.exitCode !== null || child.signalCode !== null;
    const stopped = exited
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once('close', () => resolve()));
    this.fail();
    await stopped;
  }
}
