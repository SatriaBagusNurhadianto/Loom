import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService } from '../src/services/agents/service';
import { BuildService } from '../src/services/latex/builds';
import { ProjectService } from '../src/services/project/projects';
import { MetadataStore } from '../src/services/project/store';

for (const harness of ['opencode', 'codex'] as const) {
  it.skipIf(!(process.env.LOOM_COMPUTE_LIVE ?? '').split(',').includes(harness))(
    `shows native ${harness} computation inputs and output`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'loom-computation-live-'));
      const root = join(dir, 'paper');
      await mkdir(root);
      await writeFile(join(root, 'main.tex'), 'Synthetic manuscript.\n');
      const store = new MetadataStore(join(dir, 'data'));
      const projects = new ProjectService(store);
      await projects.open(root);
      const agents = new AgentService(
        projects,
        new BuildService(projects, join(dir, 'builds')),
        join(dir, 'data'),
      );
      try {
        const projectId = projects.snapshot().id;
        let state = await agents.command({ type: 'connect', projectId, harness });
        const model = state.models.find((item) =>
          harness === 'codex'
            ? item.id === 'gpt-6.1-sol'
            : item.providerId === 'opencode' && item.id === 'big-pickle',
        );
        expect(model).toBeTruthy();
        state = await agents.command({ type: 'session', projectId });
        state = await agents.command({
          type: 'send',
          projectId,
          sessionId: state.sessionId!,
          model: model!,
          prompt:
            'Use your shell tool to run exactly python3 -c "print(137 * 29)". Report the command output. Do not edit files.',
          attachments: [],
          selection: null,
          revision: projects.snapshot().sourceRevision!,
        });
        const deadline = Date.now() + 110_000;
        while (state.running && Date.now() < deadline) {
          for (const permission of state.permissions) {
            const requested = permission.resources.join(' ');
            expect(requested).toContain('python3');
            expect(requested).toContain('137');
            expect(requested).toContain('29');
            await agents.command({
              type: 'permission',
              projectId,
              requestId: permission.id,
              reply: 'once',
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 750));
          state = await agents.command({ type: 'status', projectId });
        }
        expect(state.running).toBe(false);
        expect(state.turns[0].status).toBe('succeeded');
        const execution = state.messages.find((message) =>
          message.execution?.command.includes('137'),
        )?.execution;
        expect(execution?.output).toContain('3973');
      } finally {
        await agents.close();
        store.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
    140_000,
  );
}
