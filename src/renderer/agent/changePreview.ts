import { createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import type { AgentChange, AgentState, AgentTurn } from '../../contracts/agent';
import type { ProjectSnapshot } from '../../contracts/project';
import type { SourceLocation } from '../../contracts/latex';
import type { LatexWorkspace } from '../latex/workspace';

/** New-source line numbers, excluding preamble-only, comment and binary changes. */
export function changeLocations(changes: AgentChange[]): SourceLocation[] {
  return changes
    .filter(
      (change) =>
        !change.binary &&
        change.kind !== 'deleted' &&
        /\.(tex|sty|cls|bib)$/i.test(change.path) &&
        change.after !== null,
    )
    .sort((a, b) => Number(!a.path.endsWith('.tex')) - Number(!b.path.endsWith('.tex')))
    .flatMap((change) => {
      const after = change.after!.split('\n');
      const start = after.findIndex((line) => line.includes('\\begin{document}'));
      const firstBody =
        start < 0 ? 1 : start + (after[start].split('\\begin{document}')[1]?.trim() ? 1 : 2);
      let line = 1;
      for (const part of change.diff ?? []) {
        const lines = part.text.split('\n');
        if (lines.at(-1) === '') lines.pop();
        if (part.kind !== 'same') {
          const candidate =
            part.kind === 'removed'
              ? Math.min(line, after.length)
              : line +
                Math.max(
                  0,
                  lines.findIndex(
                    (text, offset) =>
                      line + offset >= firstBody &&
                      text.trim() &&
                      !text.trimStart().startsWith('%'),
                  ),
                );
          if (
            candidate >= firstBody &&
            candidate <= after.length &&
            after[candidate - 1].trim() &&
            !after[candidate - 1].trimStart().startsWith('%')
          )
            return [{ path: change.path, line: candidate, column: 0 }];
        }
        if (part.kind !== 'removed') line += lines.length;
      }
      // Old saved records can lack a diff. A common-prefix comparison is bounded by the saved excerpt.
      if (!change.diff) {
        const before = (change.before ?? '').split('\n');
        const index = after.findIndex(
          (text, i) =>
            i + 1 >= firstBody &&
            text !== before[i] &&
            text.trim() &&
            !text.trimStart().startsWith('%'),
        );
        if (index >= 0) return [{ path: change.path, line: index + 1, column: 0 }];
      }
      return [];
    })
    .slice(0, 12);
}

export function createAgentChangePreview(props: {
  agent: () => AgentState | null;
  project: () => ProjectSnapshot | null;
  latex: LatexWorkspace;
  openPdf: () => void;
  report: (message: string) => void;
}) {
  let projectId = '';
  let seen = new Map<string, AgentTurn['status']>();
  const [pending, setPending] = createSignal<{
    id: string;
    revision: string;
    locations: SourceLocation[];
  } | null>(null);
  let mapping = '';
  createEffect(() => {
    const state = props.agent();
    if (!state || state.projectId !== props.project()?.id) {
      setPending(null);
      return;
    }
    if (projectId !== state.projectId) {
      projectId = state.projectId;
      seen = new Map(state.turns.map((turn) => [turn.id, turn.status]));
      setPending(null);
      return;
    }
    for (const turn of state.turns) {
      if (turn.status === 'succeeded' && seen.get(turn.id) === 'running' && turn.resultRevision) {
        const locations = changeLocations(turn.changes);
        if (locations.length) {
          setPending({ id: turn.id, revision: turn.resultRevision, locations });
          void props.latex.refresh();
        }
      }
      seen.set(turn.id, turn.status);
    }
  });
  createEffect(() => {
    const target = pending();
    if (!target) return;
    const timer = setInterval(() => void props.latex.refresh(), 700);
    const timeout = setTimeout(() => {
      if (pending()?.id === target.id) {
        setPending(null);
        props.report(
          'Automatic change preview is waiting for a matching PDF. Update the PDF after saving your latest writing.',
        );
      }
    }, 120000);
    onCleanup(() => {
      clearInterval(timer);
      clearTimeout(timeout);
    });
  });
  createEffect(() => {
    const target = pending();
    const state = props.latex.state();
    const project = props.project();
    if (
      !target ||
      !project ||
      state?.projectId !== project.id ||
      props.latex.running() ||
      state.queued
    )
      return;
    if (
      state.current?.revision === target.revision &&
      ['failed', 'cancelled', 'interrupted'].includes(state.current.status)
    ) {
      setPending(null);
      return;
    }
    if (
      project.sourceRevision !== target.revision ||
      state.successful?.revision !== target.revision ||
      props.latex.stale()
    )
      return;
    const key = `${target.id}:${state.successful.id}`;
    if (mapping === key) return;
    mapping = key;
    untrack(() => {
      void (async () => {
        let mapped = false;
        for (const location of target.locations) {
          if (pending()?.id !== target.id) return;
          if (await props.latex.previewSource(location, target.revision)) {
            mapped = true;
            break;
          }
        }
        if (pending()?.id !== target.id) return;
        setPending(null);
        if (mapped) props.openPdf();
        else
          props.report(
            'PDF updated. The changed passage has no source mapping; use the source review to inspect it.',
          );
      })().catch(() => {
        if (pending()?.id !== target.id) return;
        setPending(null);
        props.report(
          'Could not locate the changed passage in the PDF. Update the PDF and retry source preview.',
        );
      });
    });
  });
}
