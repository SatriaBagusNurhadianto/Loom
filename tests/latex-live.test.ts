import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, cp, rm, writeFile, readFile, rename } from 'node:fs/promises';
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
    it('recovers a nested paper by explicitly opening the main document folder', async () => {
      const parent = join(dir, 'sample collection');
      await cp(resolve('examples/phase-3/multi-file'), join(parent, 'multi-file'), {
        recursive: true,
      });
      await projects.open(parent);
      const id = projects.snapshot().id;
      await builds.status(id);
      builds.request(id, false);
      await builds.idle(id);
      const state = await builds.status(id);
      expect(state.current?.status).toBe('failed');
      expect(state.current?.log).toContain("File `sections/introduction.tex' not found");
      const opened = await projects.openMainFolder(id);
      expect(opened.name).toBe('multi-file');
      expect(opened.files.some((file) => file.path === 'sections/introduction.tex')).toBe(true);
      await builds.status(opened.id);
      builds.request(opened.id, false);
      await builds.idle(opened.id);
      const recovered = await builds.status(opened.id);
      expect(recovered.current?.status, recovered.current?.log).toBe('succeeded');
    }, 60000);
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
        expect(state.current?.tools.find((tool) => tool.name === 'synctex')?.version).not.toContain(
          'ERROR',
        );
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
    it('renders a starter paper with an absent optional bibliography in automatic mode and records a warning', async () => {
      const root = join(dir, 'starter');
      await cp(resolve('examples/phase-3/bibtex'), root, { recursive: true });
      await writeFile(
        join(root, 'main.tex'),
        '\\documentclass{article}\n\\begin{document}\nStarter paper.\n\\bibliographystyle{plain}\n\\bibliography{not-added-yet}\n\\end{document}\n',
      );
      await projects.open(root);
      const id = projects.snapshot().id;
      await builds.status(id);
      await builds.settings(id, { ...defaultBuildSettings, bibliography: 'auto' });
      builds.request(id, false);
      await builds.idle(id);
      const state = await builds.status(id);
      expect(state.current?.status, state.current?.log).toBe('succeeded');
      expect(
        state.current?.diagnostics.some(
          (item) =>
            item.severity === 'warning' && item.message.includes('Bibliography files are missing'),
        ),
      ).toBe(true);
      await builds.settings(id, { ...defaultBuildSettings, bibliography: 'bibtex' });
      builds.request(id, false);
      await builds.idle(id);
      expect((await builds.status(id)).current?.status).toBe('failed');
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
      const invalid = file.text! + '\n\\begin{unclosed';
      await language.execute(context, { ...update, version: 4, text: invalid });
      await new Promise((r) => setTimeout(r, 1000));
      const diagnostics = await language.execute(context, { ...update, version: 4, text: invalid });
      if (diagnostics.kind === 'language')
        expect(
          diagnostics.diagnostics.some((d) => d.path === file.path && d.severity === 'error'),
        ).toBe(true);
    }, 30000);
    it('refreshes inactive TexLab definitions after external edits, rename and deletion', async () => {
      const root = join(dir, 'inactive');
      await cp(resolve('examples/phase-3/multi-file'), root, { recursive: true });
      await projects.open(root);
      const id = projects.snapshot().id;
      let context = projects.buildContext(id);
      const file = context.files.find((f) => f.path === 'main.tex')!;
      const text = file.text!.replace('\\end{document}', '\\ref{sec:fresh}\n\\end{document}');
      const command = {
        type: 'language' as const,
        projectId: id,
        fileId: file.id,
        version: 1,
        text,
        action: 'update' as const,
        position: {
          line: text.slice(0, text.indexOf('\\ref{')).split('\n').length - 1,
          character: 10,
        },
      };
      await language.execute(context, command);
      await writeFile(
        join(root, 'sections/results.tex'),
        '\\section{Fresh}\n\\label{sec:fresh}\nHello',
      );
      await projects.refresh();
      context = projects.buildContext(id);
      const changed = await language.execute(context, {
        ...command,
        action: 'definition',
        version: 2,
      });
      if (changed.kind !== 'language') throw new Error('wrong result');
      expect(changed.locations).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'sections/results.tex' })]),
      );
      await rename(join(root, 'sections/results.tex'), join(root, 'sections/renamed.tex'));
      await projects.refresh();
      context = projects.buildContext(id);
      const renamedText = text.replace('sections/results', 'sections/renamed');
      const renamed = await language.execute(context, {
        ...command,
        text: renamedText,
        action: 'definition',
        version: 3,
      });
      if (renamed.kind !== 'language') throw new Error('wrong result');
      expect(renamed.locations).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'sections/renamed.tex' })]),
      );
      await rm(join(root, 'sections/renamed.tex'));
      await projects.refresh();
      context = projects.buildContext(id);
      const deleted = await language.execute(context, {
        ...command,
        text: renamedText,
        action: 'definition',
        version: 4,
      });
      if (deleted.kind !== 'language') throw new Error('wrong result');
      expect(deleted.locations).toEqual([]);
    }, 30000);
  },
);
