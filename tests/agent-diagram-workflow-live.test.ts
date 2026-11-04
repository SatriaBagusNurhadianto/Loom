import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentService } from '../src/services/agents/service';
import { BuildService } from '../src/services/latex/builds';
import { ProjectService } from '../src/services/project/projects';
import { MetadataStore } from '../src/services/project/store';

it.skipIf(process.env.LOOM_DIAGRAM_WORKFLOW !== '1')(
  'clarifies an ambiguous diagram before inserting editable TikZ and building',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-image-workflow-'));
    const root = join(dir, 'paper');
    await mkdir(root);
    const original =
      '\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\nPLACEHOLDER\n\\end{document}\n';
    const image = await readFile('tests/fixtures/whiteboard-diagram.png');
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
          'Inspect the attached diagram. If anything needed for an accurate conversion is unclear, ask me to clarify before making edits. When it is clear, replace PLACEHOLDER in main.tex with editable TikZ inside a captioned figure labeled fig:flow. Preserve the image. Do not compile or commit. Respond in plain text, not a structured question.',
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
      expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(original);
      expect(
        state.messages
          .filter((message) => message.role === 'assistant')
          .map((message) => message.text)
          .join(' '),
      ).toMatch(
        /(label|box|node)[\s\S]{0,120}(\?|clarif|mean|represent|name)|\?[\s\S]{0,120}(label|box|node)/i,
      );
      const imageTurn = state.turns[0];
      state = await agents.command({
        type: 'send',
        projectId,
        sessionId: state.sessionId!,
        model: model!,
        attachments: [],
        selection: null,
        revision: projects.snapshot().sourceRevision!,
        prompt:
          'The unknown label is Detector. Please complete the requested conversion. Preserve all other content and the image. Do not compile or commit.',
      });
      const secondDeadline = Date.now() + 110_000;
      while (state.running && Date.now() < secondDeadline) {
        expect(state.permissions).toEqual([]);
        expect(state.questions).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 750));
        state = await agents.command({ type: 'status', projectId });
      }
      expect(state.running, JSON.stringify({ error: state.error, messages: state.messages })).toBe(
        false,
      );
      const edited = await readFile(join(root, 'main.tex'), 'utf8');
      expect(edited).toContain('\\begin{tikzpicture}');
      expect(edited).toContain('Source');
      expect(edited).toContain('Detector');
      expect(edited).toContain('\\label{fig:flow}');
      expect(edited).toContain('\\caption');
      expect(edited).toMatch(/->|\\arrow|\\path\s*\[.*(?:stealth|latex)/i);
      expect(edited).not.toContain('PLACEHOLDER');
      expect(await readFile(join(root, 'board.png'))).toEqual(image);
      const comparison = await agents.command({
        type: 'preview-submitted-image',
        projectId,
        turnId: imageTurn.id,
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
      ).toMatch(/Source[\s\S]*Detector/i);
      execFileSync('pdftoppm', [
        '-f',
        '1',
        '-l',
        '1',
        '-png',
        '-scale-to',
        '1200',
        builds.artifact(projectId, build.successful!.id).pdf,
        'artifacts/phase-6-diagram-live',
      ]);
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
  250_000,
);
