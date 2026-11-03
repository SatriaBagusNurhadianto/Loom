import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, cp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { BuildService } from '../src/services/latex/builds';
import { defaultBuildSettings } from '../src/contracts/latex';
import { TexlabClient } from '../src/services/latex/language';
let dir: string,
  projects: ProjectService,
  store: MetadataStore,
  builds: BuildService,
  language: TexlabClient;
describe.skipIf(process.env.LOOM_TEST_TEX !== '1')(
  'live local TeX / TexLab (explicit toolchain setup)',
  () => {
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'loom-live-'));
      store = new MetadataStore(join(dir, 'data'));
      projects = new ProjectService(store);
      builds = new BuildService(projects, join(dir, 'builds'));
      language = new TexlabClient();
    });
    afterEach(async () => {
      language.dispose();
      builds.dispose();
      await builds.idle(projects.snapshot().id);
      store.close();
      await rm(dir, { recursive: true, force: true });
    });
    for (const engine of ['pdflatex', 'xelatex', 'lualatex'] as const)
      it(`builds a real multi-file ${engine} paper and maps source in both directions`, async () => {
        const root = join(dir, '论文 with spaces');
        await cp(resolve('examples/phase-3/multi-file'), root, { recursive: true });
        await projects.open(root);
        const id = projects.snapshot().id;
        await builds.status(id);
        await builds.settings(id, { ...defaultBuildSettings, engine });
        builds.request(id, false);
        await builds.idle(id);
        const state = await builds.status(id);
        expect(state.current?.status, state.current?.log).toBe('succeeded');
        expect(state.successful?.hasSynctex).toBe(true);
        const buildId = state.successful!.id;
        const forward = await builds.mapping({
          type: 'forward',
          projectId: id,
          buildId,
          path: 'sections/introduction.tex',
          line: 3,
        });
        expect(forward.kind).toBe('forward');
        if (forward.kind !== 'forward') throw new Error('wrong mapping');
        const reverse = await builds.mapping({
          type: 'reverse',
          projectId: id,
          buildId,
          page: forward.page,
          x: forward.x,
          y: forward.y,
        });
        expect(reverse).toMatchObject({ kind: 'reverse', path: 'sections/introduction.tex' });
        expect(state.successful?.revision).toBe(projects.snapshot().sourceRevision);
        await writeFile(join(root, 'sections/introduction.tex'), '\\LoomUndefinedCommand');
        await projects.refresh();
        builds.request(id, true);
        await builds.idle(id);
        const failed = await builds.status(id);
        expect(failed.current?.status).toBe('failed');
        expect(failed.successful?.id).toBe(buildId);
        expect(
          failed.current?.diagnostics.some((d) => d.path === 'sections/introduction.tex'),
        ).toBe(true);
        expect(
          (
            await builds.mapping({
              type: 'forward',
              projectId: id,
              buildId,
              path: 'sections/introduction.tex',
              line: 3,
            })
          ).kind,
        ).toBe('forward');
      }, 60000);
    for (const backend of ['biber', 'bibtex'] as const)
      it(`runs a real ${backend} bibliography sequence and restores portable configuration`, async () => {
        const root = join(dir, backend);
        await cp(resolve(`examples/phase-3/${backend}`), root, { recursive: true });
        await projects.open(root);
        const id = projects.snapshot().id;
        await builds.status(id);
        builds.request(id, false);
        await builds.idle(id);
        const state = await builds.status(id);
        expect(state.current?.status, state.current?.log).toBe('succeeded');
        expect(state.current?.log.toLowerCase()).toContain(backend);
        const artifact = builds.artifact(id, state.successful!.id);
        expect(await readFile(join(artifact.directory, 'output/main.bbl'), 'utf8')).toContain(
          'loom2026',
        );
        const other = new MetadataStore(join(dir, 'other-data'));
        const copy = new ProjectService(other);
        await copy.open(root);
        expect(copy.buildContext(copy.snapshot().id).settings?.bibliography).toBe(backend);
        other.close();
      }, 60000);
    it('connects real TexLab for completion, project definitions and diagnostics', async () => {
      const root = join(dir, 'language');
      await cp(resolve('examples/phase-3/multi-file'), root, { recursive: true });
      await projects.open(root);
      const context = projects.buildContext(projects.snapshot().id),
        file = context.files.find((f) => f.path === 'sections/introduction.tex')!;
      const update = {
        type: 'language' as const,
        projectId: context.snapshot.id,
        fileId: file.id,
        version: 1,
        text: file.text!,
        action: 'update' as const,
        position: { line: 0, character: 0 },
      };
      expect(await language.execute(context, update)).toMatchObject({ available: true });
      const text = file.text! + '\n\\ref{sec:i';
      await language.execute(context, { ...update, version: 2, text });
      await new Promise((r) => setTimeout(r, 600));
      const completions = await language.execute(context, {
        ...update,
        version: 2,
        text,
        action: 'completion',
        position: { line: text.split('\n').length - 1, character: 10 },
      });
      expect(completions.kind).toBe('language');
      if (completions.kind === 'language')
        expect(
          completions.completions.some((c) => c.label.includes('sec:introduction')),
          JSON.stringify(completions),
        ).toBe(true);
      const reference = file.text! + '\n\\ref{sec:introduction}';
      const definition = await language.execute(context, {
        ...update,
        version: 3,
        text: reference,
        action: 'definition',
        position: { line: reference.split('\n').length - 1, character: 12 },
      });
      if (definition.kind === 'language')
        expect(definition.locations).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: file.path, line: 1 })]),
        );
      const invalid = file.text! + '\n\\begin{unclosed}';
      await language.execute(context, { ...update, version: 4, text: invalid });
      await new Promise((r) => setTimeout(r, 1000));
      const diagnostics = await language.execute(context, { ...update, version: 4, text: invalid });
      if (diagnostics.kind === 'language')
        expect(diagnostics.diagnostics.length).toBeGreaterThan(0);
    }, 30000);
  },
);
