import type { AgentWorkspaceContext } from '../../contracts/agent';
import type { BuildState, LatexDiagnostic } from '../../contracts/latex';
import type { BuildInput } from '../latex/builds';

// Only paper diagnostics enter this context, never environment variables,
// connection configuration, private harness logs, or unrelated project files.
const clean = (value: string, limit: number) =>
  value
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1<redacted>@')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer <redacted>')
    .replace(
      /\b([a-z0-9_]*(?:password|api[_-]?key|access[_-]?token|secret)[a-z0-9_]*)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=<redacted>',
    )
    .slice(0, limit);

export function diagnosticContext(
  context: BuildInput,
  state: BuildState | null,
  observed?: AgentWorkspaceContext,
) {
  if (state?.projectId !== context.snapshot.id) state = null;
  const current = state?.current;
  const revision = context.snapshot.sourceRevision;
  const root = context.files.find((file) => file.id === context.snapshot.rootId)?.path ?? null;
  const buildIsCurrent =
    !!current &&
    current.revision === revision &&
    current.root === root &&
    current.settings.engine === state?.settings.engine &&
    current.settings.bibliography === state?.settings.bibliography;
  const diagnostics = (items: LatexDiagnostic[]) =>
    items.slice(0, 20).map((item) => ({
      ...item,
      path: context.files.some((file) => file.path === item.path) ? item.path : null,
      message: clean(item.message, 1000),
    }));
  // Include errors before warnings when the compiler reports many messages.
  const ordered = [...(current?.diagnostics ?? [])].sort(
    (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'),
  );
  const buildDiagnostics = diagnostics(ordered);
  const editorDiagnostics = observed?.editorDiagnostics
    ? {
        observedRevision: observed.editorDiagnostics.revision,
        matchesSavedRevision: observed.editorDiagnostics.revision === revision,
        items: diagnostics(observed.editorDiagnostics.items),
      }
    : null;
  const locations = [...buildDiagnostics, ...(editorDiagnostics?.items ?? [])].filter(
    (item) => item.path,
  );
  const activeFile = context.files.find((file) => file.path === observed?.activeFile)?.path ?? null;
  if (activeFile)
    locations.push({ path: activeFile, line: 1, column: 0, severity: 'info', message: '' });
  const seen = new Set<string>();
  const excerpts = [];
  for (const location of locations) {
    if (excerpts.length >= 5) break;
    const file = context.files.find((file) => file.path === location.path);
    // Never incidentally include .env, credentials, binaries, or arbitrary assets.
    if (!file?.text || !/\.(tex|bib|sty|cls)$/.test(file.path)) continue;
    const line = Math.max(1, location.line);
    const key = `${file.path}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lines = file.text.split('\n');
    const start = Math.max(0, Math.min(line - 1, lines.length - 1) - 3);
    excerpts.push({
      path: file.path,
      revision,
      firstLine: start + 1,
      lines: lines
        .slice(start, start + 9)
        .map((text, index) => ({ line: start + index + 1, text: clean(text, 300) })),
    });
  }
  const log = clean(current?.log ?? '', 150000);
  const logExcerpt =
    log.length > 12000
      ? `${clean(log.slice(0, 2000), 2000)}\n[Middle of build log omitted]\n${clean(log.slice(-10000), 10000)}`
      : clean(log, 12000);
  return {
    savedRevision: revision,
    mainDocument: root,
    activeFile,
    buildStatusAvailable: state !== null,
    build: current
      ? {
          id: current.id,
          revision: current.revision,
          root: current.root,
          status: current.status,
          matchesSavedSourceAndSettings: buildIsCurrent,
          settings: current.settings,
          diagnostics: buildDiagnostics,
          diagnosticCount: current.diagnostics.length,
          logExcerpt,
          logTruncated: log.length > 12000,
        }
      : null,
    lastSuccessfulBuild: state?.successful
      ? { id: state.successful.id, revision: state.successful.revision }
      : null,
    tools: state?.tools ?? [],
    editorDiagnostics,
    observedWorkspaceErrors: (observed?.errors ?? []).map((item) => ({
      ...item,
      message: clean(item.message, 2000),
    })),
    sourceExcerpts: excerpts,
    sourceExcerptNote:
      'These excerpts are from current saved source, not necessarily the source of an earlier build. Read the paper files for more context. No build has been started by collecting this context.',
  };
}
