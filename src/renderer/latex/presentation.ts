import type { BuildState, SourceLocation } from '../../contracts/latex';
import type { ProjectSnapshot } from '../../contracts/project';
export type PdfIssue = {
  title: string;
  detail: string;
  action: 'main' | 'folder' | 'setup' | 'source' | 'retry';
  location?: SourceLocation;
};
export function pdfStatus(state: BuildState | null, stale: boolean) {
  switch (state?.current?.status) {
    case 'running':
      return 'Creating PDF…';
    case 'failed':
      return 'PDF needs attention';
    case 'cancelled':
      return 'PDF creation stopped';
    case 'interrupted':
      return 'PDF creation interrupted';
  }
  return state?.successful ? (stale ? 'Changes not in PDF' : 'PDF ready') : 'PDF preview';
}
export function pdfIssue(
  project: ProjectSnapshot | null,
  state: BuildState | null,
): PdfIssue | null {
  if (!project) return null;
  const root = project.files.find((file) => file.id === project.rootId && !file.deleted);
  if (!root)
    return {
      title: 'Which file starts your paper?',
      detail:
        'This folder contains more than one possible paper, or no main document was found. Choose its main file to create a PDF.',
      action: 'main',
    };
  const build = state?.current;
  if (build?.status === 'running') return null;
  if (
    build &&
    build.status !== 'succeeded' &&
    (build.root !== root.path ||
      build.revision !== project.sourceRevision ||
      build.settings.engine !== state?.settings.engine ||
      build.settings.bibliography !== state?.settings.bibliography)
  )
    return {
      title: 'Your paper has changed since this attempt',
      detail:
        'Create the PDF again to check your latest writing and settings. The earlier message is available in the details.',
      action: 'retry',
    };
  const log = build?.log ?? '';
  const missing = log.match(/File\s+[`'"]([^`'"\n]+)[`'"]\s+not found/i)?.[1];
  if (build?.status === 'failed' && missing) {
    const folder = root.path.includes('/') ? root.path.slice(0, root.path.lastIndexOf('/')) : '';
    if (
      folder &&
      project.files.some((file) => !file.deleted && file.path === `${folder}/${missing}`)
    )
      return {
        title: 'Open the folder for this paper',
        detail: `“${missing}” is inside “${folder}”. This paper was opened from a folder above it. Open “${folder}” so its sections and images can be found. Your edits will be saved first.`,
        action: 'folder',
      };
    if (/\.(sty|cls)$/.test(missing))
      return {
        title: 'A style or package could not be found',
        detail: `LaTeX could not find “${missing}”. If it came with your template, add it to this paper’s folder. Otherwise install the package through your LaTeX installation, then try again.`,
        action: 'setup',
      };
    return {
      title: 'A file used by this paper is missing',
      detail: `Loom could not find “${missing}”. Check that it is included in this paper’s folder and that the filename in your text is correct.`,
      action: 'source',
      location: build.diagnostics.find((d) => d.path) ? diagnosticLocation(state) : undefined,
    };
  }
  const missingTools =
    state?.tools.length &&
    ['latexmk', state.settings.engine].some(
      (name) => !state.tools.find((tool) => tool.name === name)?.available,
    );
  if (missingTools || /Missing tools:/.test(log))
    return {
      title: 'Set up PDF creation on this computer',
      detail:
        'Loom needs a LaTeX installation to turn your paper into a PDF. Your writing is saved and you can keep editing while you set it up.',
      action: 'setup',
    };
  if (build?.status === 'failed') {
    const location = diagnosticLocation(state);
    const first = build.diagnostics.find(
      (item) => item.severity === 'error' && !/Emergency stop|Fatal error/i.test(item.message),
    );
    return {
      title: location ? 'A line in your paper needs attention' : 'The PDF could not be created',
      detail:
        (/Undefined control sequence/i.test(first?.message ?? '')
          ? 'LaTeX did not recognise a command on this line. Check its spelling or the package required by your template.'
          : first?.message.replace(/^!\s*|^LaTeX Error:\s*/g, '')) ||
        'Open the details for the message from LaTeX. Your paper is saved; you can fix the problem and try again.',
      action: location ? 'source' : 'retry',
      location,
    };
  }
  if (build?.status === 'cancelled' || build?.status === 'interrupted')
    return {
      title: build.status === 'cancelled' ? 'PDF creation stopped' : 'PDF creation was interrupted',
      detail: 'Your writing is safe. Create the PDF again when you are ready.',
      action: 'retry',
    };
  return null;
}
function diagnosticLocation(state: BuildState | null): SourceLocation | undefined {
  const item = state?.current?.diagnostics.find((d) => d.path && d.severity === 'error');
  return item?.path ? { path: item.path, line: item.line, column: item.column } : undefined;
}
