import { expect, it } from 'vitest';
import { pdfIssue } from '../src/renderer/latex/presentation';
import { defaultBuildSettings, type BuildState } from '../src/contracts/latex';
import type { ProjectSnapshot } from '../src/contracts/project';
const project = {
  id: 'p',
  rootId: 'root',
  sourceRevision: 'rev1',
  files: [
    { id: 'root', path: 'multi-file/main.tex', deleted: false },
    { id: 'body', path: 'multi-file/sections/introduction.tex', deleted: false },
  ],
} as ProjectSnapshot;
const failed = {
  settings: defaultBuildSettings,
  tools: [],
  current: {
    root: 'multi-file/main.tex',
    revision: 'rev1',
    settings: defaultBuildSettings,
    status: 'failed',
    log: "! LaTeX Error: File `sections/introduction.tex' not found.",
    diagnostics: [],
  },
} as unknown as BuildState;
it('distinguishes a paper opened from above from genuinely missing files and local styles', () => {
  expect(pdfIssue(project, failed)?.action).toBe('folder');
  expect(pdfIssue({ ...project, files: project.files.slice(0, 1) }, failed)?.action).toBe('source');
  const style = {
    ...failed,
    current: { ...failed.current!, log: "! LaTeX Error: File `custom.sty' not found." },
  };
  expect(pdfIssue(project, style)?.detail).toContain('came with your template');
  expect(pdfIssue(project, style)?.action).toBe('setup');
});
it('never uses an earlier failure to offer a folder or source action for a changed paper', () => {
  expect(pdfIssue({ ...project, sourceRevision: 'rev2' }, failed)?.action).toBe('retry');
  expect(
    pdfIssue(
      { ...project, files: [{ ...project.files[0], path: 'another/main.tex' }, project.files[1]] },
      failed,
    )?.action,
  ).toBe('retry');
  expect(
    pdfIssue(project, { ...failed, settings: { ...defaultBuildSettings, engine: 'xelatex' } })
      ?.action,
  ).toBe('retry');
});
