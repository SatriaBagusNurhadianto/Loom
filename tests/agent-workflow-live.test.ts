import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import type { AgentState, HarnessKind } from '../src/contracts/agent';
import { AgentService } from '../src/services/agents/service';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { BuildService } from '../src/services/latex/builds';

const selected = (process.env.LOOM_WORKFLOW_LIVE ?? '').split(',');
for (const runtime of ['codex', 'classic', 'next']) {
  it.skipIf(!selected.includes(runtime))(
    `actual ${runtime} answers paper questions and creates/edits LaTeX files with native tools`,
    async () => {
      if (runtime === 'classic')
        expect(
          process.env.LOOM_CLASSIC_EXECUTABLE,
          'Set LOOM_CLASSIC_EXECUTABLE to the installed 1.19.x binary',
        ).toBeTruthy();
      const dir = await mkdtemp(join(tmpdir(), 'loom-native-workflow-')),
        root = join(dir, 'paper');
      await mkdir(root);
      const original =
        '\\documentclass{article}\n\\begin{document}\nThe synthetic signal doubles when pressure rises.\n\\end{document}\n';
      await writeFile(join(root, 'main.tex'), original);
      const store = new MetadataStore(join(dir, 'data')),
        projects = new ProjectService(store);
      await projects.open(root);
      const agents = new AgentService(
        projects,
        new BuildService(projects, join(dir, 'builds')),
        join(dir, 'data'),
      );
      const projectId = projects.snapshot().id;
      try {
        const harness: HarnessKind = runtime === 'codex' ? 'codex' : 'opencode';
        let state = await agents.command({
          type: 'connect',
          projectId,
          harness,
          ...(runtime === 'classic'
            ? {
                executable: process.env.LOOM_CLASSIC_EXECUTABLE,
              }
            : {}),
        });
        const toolCalls: string[] = [];
        const toolServer = (agents as unknown as { tools: { server: Server } }).tools.server;
        toolServer.on('request', (req, res) => {
          let body = '';
          req.on('data', (bytes: Buffer) => {
            body += bytes.toString();
          });
          res.once('finish', () => {
            try {
              const call = JSON.parse(body);
              if (res.statusCode === 200 && call.method === 'tools/call')
                toolCalls.push(String(call.params.name));
            } catch {
              /* Non-tool transport request. */
            }
          });
        });
        const model = state.models.find((m) =>
          runtime === 'codex' ? m.id === 'gpt-6.1-sol' : m.id === 'big-pickle',
        );
        expect(model, 'Requested native model must be configured').toBeTruthy();
        state = await agents.command({
          type: 'settings',
          projectId,
          settings: {
            permissionMode: 'auto-accept-edits',
            reasoning: model!.reasoningEfforts?.includes('low') ? 'low' : '',
          },
        });
        state = await agents.command({ type: 'session', projectId });
        const sessionId = state.sessionId!;
        async function waitForTurn(state: AgentState) {
          const end = Date.now() + 110_000;
          while (state.running && Date.now() < end) {
            for (const p of state.permissions)
              await agents.command({
                type: 'permission',
                projectId,
                requestId: p.id,
                reply: 'once',
              });
            for (const q of state.questions)
              if (q.rejectable)
                await agents.command({
                  type: 'answer',
                  projectId,
                  requestId: q.id,
                  answer: Object.fromEntries(
                    q.fields.map((f) => [f.key, f.type === 'boolean' ? true : 'yes']),
                  ),
                });
            await new Promise((r) => setTimeout(r, 500));
            state = await agents.command({ type: 'status', projectId });
          }
          expect(state.error).toBe('');
          expect(state.running).toBe(false);
          expect(state.turns[0].status).toBe('succeeded');
          return state;
        }
        async function send(prompt: string) {
          await projects.run(() => projects.refresh());
          return waitForTurn(
            await agents.command({
              type: 'send',
              projectId,
              sessionId,
              prompt,
              model: model!,
              attachments: ['main.tex'],
              selection: null,
              revision: projects.snapshot().sourceRevision!,
            }),
          );
        }
        state = await send(
          'Use the Loom paper_structure tool and your native source-reading tools to inspect main.tex. What happens to the synthetic signal when pressure rises? Answer briefly. This is a discussion question: do not edit or create files, use browser tools or run a build.',
        );
        expect(
          state.messages.filter((m) => m.role === 'assistant').some((m) => /doubl/i.test(m.text)),
        ).toBe(true);
        expect(toolCalls).toContain('paper_structure');
        expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(original);
        expect(state.turns[0].changes).toEqual([]);
        state = await send(
          'Now make these actual file changes using your native file tools: create sections/notes.tex containing exactly "\\section{Notes}\\nClear writing supports reproducible research.\\n" (with real newlines), and add \\input{sections/notes} immediately before \\end{document} in main.tex. Preserve the existing sentence and all other commands. Create the sections folder if needed. Do not use browser/UI automation, compile or commit.',
        );
        expect(await readFile(join(root, 'sections/notes.tex'), 'utf8')).toContain(
          'reproducible research',
        );
        expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('\\input{sections/notes}');
        expect(state.turns[0].changes.map((c) => c.path).sort()).toEqual([
          'main.tex',
          'sections/notes.tex',
        ]);
        const turnId = state.turns[0].id;
        await agents.command({ type: 'disconnect', projectId });
        state = await agents.command({ type: 'connect', projectId, harness }).catch((error) => {
          throw new Error('Native history reconnect failed', { cause: error });
        });
        expect(state.sessionId).toBe(sessionId);
        expect(state.settings.permissionMode).toBe('auto-accept-edits');
        for (const path of ['main.tex', 'sections/notes.tex']) {
          await projects.run(() => projects.refresh());
          await agents.command({
            type: 'review',
            projectId,
            turnId,
            path,
            action: 'revert',
            revision: projects.snapshot().sourceRevision!,
          });
        }
        expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(original);
        await expect(readFile(join(root, 'sections/notes.tex'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await agents.close();
        store.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
    260_000,
  );
}
