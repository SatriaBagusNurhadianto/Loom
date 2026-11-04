import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentService } from '../src/services/agents/service';
import { BuildService } from '../src/services/latex/builds';
import { ProjectService } from '../src/services/project/projects';
import { MetadataStore } from '../src/services/project/store';

it.skipIf(process.env.LOOM_IMAGE_WORKFLOW !== '1')(
  'converts a synthetic image into editable LaTeX, builds and safely reverts it',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-image-workflow-'));
    const root = join(dir, 'paper');
    await mkdir(root);
    const original = '\\documentclass{article}\n\\begin{document}\nPLACEHOLDER\n\\end{document}\n';
    const image = await readFile('tests/fixtures/whiteboard-equation.png');
    await writeFile(join(root, 'main.tex'), original);
    await writeFile(join(root, 'board.png'), image);
    const store = new MetadataStore(join(dir, 'data'));
    const projects = new ProjectService(store);
    await projects.open(root);
    const builds = new BuildService(projects, join(dir, 'builds'));
    const agents = new AgentService(projects, builds, join(dir, 'data'));
    const projectId = projects.snapshot().id;
    try {
      let state = await agents.command({ type: 'connect', projectId, harness: 'codex' });
      const model = state.models.find((item) => item.id === 'gpt-6.1-sol' && item.images);
      expect(model).toBeTruthy();
      await agents.command({
        type: 'settings',
        projectId,
        settings: { permissionMode: 'auto-accept-edits', reasoning: '' },
      });
      state = await agents.command({ type: 'session', projectId });
      state = await agents.command({
        type: 'send',
        projectId,
        sessionId: state.sessionId!,
        model: model!,
        attachments: ['board.png'],
        selection: null,
        revision: projects.snapshot().sourceRevision!,
        prompt:
          'Read the attached synthetic equation. Replace PLACEHOLDER in main.tex with an editable LaTeX equation transcribing the image, using an equation environment with label eq:mass-energy. Preserve the rest of the paper and the image. Do not compile or commit. Report any uncertain characters.',
      });
      const deadline = Date.now() + 110_000;
      while (state.running && Date.now() < deadline) {
        expect(
          state.permissions,
          'Unexpected permission in the isolated image-conversion test',
        ).toEqual([]);
        expect(
          state.questions,
          'Unexpected question in the isolated image-conversion test',
        ).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 750));
        state = await agents.command({ type: 'status', projectId });
      }
      expect(
        state.running,
        JSON.stringify({
          error: state.error,
          permissions: state.permissions,
          questions: state.questions,
          messages: state.messages,
        }),
      ).toBe(false);
      expect(state.turns[0].status).toBe('succeeded');
      const edited = await readFile(join(root, 'main.tex'), 'utf8');
      expect(edited).toMatch(/E\s*=\s*m\s*c\s*\^\s*\{?2\}?/i);
      expect(edited).toContain('\\label{eq:mass-energy}');
      expect(edited).toContain('\\begin{equation}');
      expect(edited).toContain('\\end{equation}');
      expect(edited).toContain('\\documentclass{article}');
      expect(edited).toContain('\\begin{document}');
      expect(edited).toContain('\\end{document}');
      expect(edited).not.toContain('PLACEHOLDER');
      expect(await readFile(join(root, 'board.png'))).toEqual(image);
      const comparison = await agents.command({
        type: 'preview-submitted-image',
        projectId,
        turnId: state.turns[0].id,
        path: 'board.png',
      });
      expect(comparison.imagePreview?.data).toBe(image.toString('base64'));
      await builds.status(projectId, true);
      builds.request(projectId, false);
      let build = await builds.status(projectId);
      while (build.current?.status === 'running' || build.queued) {
        await builds.idle(projectId);
        build = await builds.status(projectId);
      }
      expect(build.current?.status, build.current?.log).toBe('succeeded');
      expect(build.successful?.revision).toBe(projects.snapshot().sourceRevision);
      expect(
        execFileSync('pdftotext', [builds.artifact(projectId, build.successful!.id).pdf, '-'], {
          encoding: 'utf8',
        }),
      ).toMatch(/E\s*=\s*mc/i);
      await agents.command({
        type: 'review',
        projectId,
        turnId: state.turns[0].id,
        path: 'main.tex',
        action: 'revert',
        revision: projects.snapshot().sourceRevision!,
      });
      expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(original);
      expect(await readFile(join(root, 'board.png'))).toEqual(image);
    } finally {
      await agents.close();
      builds.dispose();
      await builds.idle(projectId);
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  150_000,
);
