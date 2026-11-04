import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService } from '../src/services/agents/service';
import { BuildService } from '../src/services/latex/builds';
import { ProjectService } from '../src/services/project/projects';
import { MetadataStore } from '../src/services/project/store';

for (const harness of ['opencode', 'codex'] as const) {
  it.skipIf(!(process.env.LOOM_IMAGE_LIVE ?? '').split(',').includes(harness))(
    `native ${harness} reads a protected image snapshot and transcribes the synthetic equation`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'loom-image-live-'));
      const root = join(dir, 'paper');
      await mkdir(root);
      await writeFile(
        join(root, 'main.tex'),
        '\\documentclass{article}\n\\begin{document}\n\\end{document}\n',
      );
      await writeFile(
        join(root, 'board.png'),
        await readFile('tests/fixtures/whiteboard-equation.png'),
      );
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
        const model = state.models.find(
          (item) =>
            item.images &&
            (harness === 'opencode'
              ? item.providerId === 'opencode' && item.id === 'nemotron-3.5-super-vl-free'
              : item.id === 'gpt-6.1-sol'),
        );
        expect(model, 'The configured vision model must report image input support.').toBeTruthy();
        state = await agents.command({ type: 'session', projectId });
        state = await agents.command({
          type: 'send',
          projectId,
          sessionId: state.sessionId!,
          prompt:
            'Read the attached synthetic equation. Respond with only the equation in LaTeX. Do not edit any files or run commands.',
          model: model!,
          attachments: ['board.png'],
          selection: null,
          revision: projects.snapshot().sourceRevision!,
        });
        const deadline = Date.now() + 110_000;
        while (state.running && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          state = await agents.command({ type: 'status', projectId });
        }
        expect(state.running).toBe(false);
        expect(state.turns[0].status).toBe('succeeded');
        expect(
          state.messages
            .filter((message) => message.role === 'assistant')
            .map((message) => message.text)
            .join('\n'),
        ).toMatch(/E\s*=\s*m\s*c\s*(?:\^\s*\{?2\}?|²)/i);
        const saved = await agents.command({
          type: 'preview-submitted-image',
          projectId,
          turnId: state.turns[0].id,
          path: 'board.png',
        });
        expect(saved.imagePreview?.data).toBe(
          (await readFile(join(root, 'board.png'))).toString('base64'),
        );
      } finally {
        await agents.close();
        store.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
    140_000,
  );
}
