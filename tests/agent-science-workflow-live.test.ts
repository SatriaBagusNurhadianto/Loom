import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentService } from '../src/services/agents/service';
import { BuildService } from '../src/services/latex/builds';
import { ProjectService } from '../src/services/project/projects';
import { MetadataStore } from '../src/services/project/store';

it.skipIf(process.env.LOOM_SCIENCE_WORKFLOW !== '1')(
  'revises notation across files and adds a table and project-relative figure',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-image-workflow-'));
    const root = join(dir, 'paper');
    await mkdir(root);
    const original =
      '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nWe use $\\alpha$ as the rate.\n\\input{sections/results}\nPLACEHOLDER\n\\end{document}\n';
    const section = 'The rate $\\alpha$ is positive.\n';
    await mkdir(join(root, 'sections'));
    await mkdir(join(root, 'figures'));
    const image = await readFile('tests/fixtures/whiteboard-equation.png');
    await writeFile(join(root, 'main.tex'), original);
    await writeFile(join(root, 'figures', 'board.png'), image);
    await writeFile(join(root, 'sections', 'results.tex'), section);
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
        attachments: [],
        selection: null,
        revision: projects.snapshot().sourceRevision!,
        prompt:
          'Across the paper change the rate notation from alpha to beta consistently. Replace PLACEHOLDER with a small editable table of two illustrative values with a caption and label tab:rates, and a figure using the existing figures/board.png via a project-relative path, with caption and label fig:board. Preserve the image and unrelated content. Use only native filesystem tools; do not call Loom MCP tools, compile or commit.',
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
      const editedSection = await readFile(join(root, 'sections', 'results.tex'), 'utf8');
      expect(edited).toContain('\\beta');
      expect(editedSection).toContain('\\beta');
      expect(edited + editedSection).not.toContain('\\alpha');
      expect(edited).toContain('\\label{tab:rates}');
      expect(edited).toContain('\\label{fig:board}');
      expect(edited).toContain('figures/board.png');
      expect(edited).toContain('\\begin{tabular}');
      expect(await readFile(join(root, 'figures', 'board.png'))).toEqual(image);
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
      ).toMatch(/rate/i);
      await agents.command({
        type: 'review',
        projectId,
        turnId: state.turns[0].id,
        path: 'main.tex',
        action: 'revert',
        revision: projects.snapshot().sourceRevision!,
      });
      await agents.command({
        type: 'review',
        projectId,
        turnId: state.turns[0].id,
        path: 'sections/results.tex',
        action: 'revert',
        revision: projects.snapshot().sourceRevision!,
      });
      expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(original);
      expect(await readFile(join(root, 'sections', 'results.tex'), 'utf8')).toBe(section);
      expect(await readFile(join(root, 'figures', 'board.png'))).toEqual(image);
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
