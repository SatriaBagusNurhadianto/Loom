import {
  autocompletion,
  completionKeymap,
  startCompletion,
  type CompletionContext,
  type Completion,
} from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { keymap, ViewPlugin, type EditorView } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import type { ProjectWorkspace } from '../editor/documents';
import type { LatexWorkspace } from './workspace';
function position(doc: Text, offset: number) {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}
function offset(doc: Text, value: { line: number; character: number }) {
  const line = doc.line(Math.max(1, Math.min(doc.lines, value.line + 1)));
  return Math.min(line.to, line.from + value.character);
}
export function languageExtensions(
  workspace: ProjectWorkspace,
  latex: LatexWorkspace,
  fileId: string,
): Extension {
  const projectId = workspace.project()!.id;
  let version = 0;
  async function request(
    view: EditorView,
    action: 'update' | 'completion' | 'definition',
    at = view.state.selection.main.head,
  ) {
    const document = view.state.doc;
    const result = await latex.request(
      {
        type: 'language',
        projectId,
        fileId,
        version: ++version,
        text: document.toString(),
        action,
        position: position(document, at),
      },
      true,
    );
    if (
      workspace.project()?.id !== projectId ||
      workspace.active() !== fileId ||
      view.state.doc !== document ||
      result?.kind !== 'language'
    )
      return;
    latex.setLanguageStatus(result.message);
    latex.setEditorDiagnostics({
      revision: workspace.project()?.sourceRevision ?? '',
      items: result.diagnostics.slice(0, 20),
    });
    return result;
  }
  async function complete(context: CompletionContext) {
    if (!context.view) return null;
    const document = context.state.doc;
    const token = context.matchBefore(/[\\\w:./-]+/);
    if (!context.explicit && (!token || token.from === token.to)) return null;
    const result = await request(context.view, 'completion', context.pos);
    if (!result?.available || context.aborted || context.view.state.doc !== document) return null;
    const options: Completion[] = result.completions.map((item) => ({
      label: item.label,
      detail: item.detail,
      type: 'text',
      apply: (view, _completion, from, to) => {
        if (view.state.doc !== document) return;
        const start = item.from ? offset(document, item.from) : from,
          end = item.to ? offset(document, item.to) : to;
        view.dispatch({
          changes: { from: start, to: end, insert: item.text },
          selection: { anchor: start + item.text.length },
        });
      },
    }));
    return options.length ? { from: token?.from ?? context.pos, options, filter: false } : null;
  }
  async function definition(view: EditorView) {
    const result = await request(view, 'definition');
    if (result?.locations[0]) await latex.locate(result.locations[0]);
    else
      latex.setLanguageStatus(
        result?.available
          ? 'TexLab could not resolve a project definition here.'
          : (result?.message ?? 'TexLab unavailable.'),
      );
  }
  return [
    ViewPlugin.define((view) => {
      const define = () => void definition(view),
        complete = () => startCompletion(view);
      view.dom.addEventListener('loom:definition', define);
      view.dom.addEventListener('loom:complete', complete);
      return {
        destroy() {
          view.dom.removeEventListener('loom:definition', define);
          view.dom.removeEventListener('loom:complete', complete);
        },
      };
    }),
    autocompletion({ override: [complete], activateOnTyping: true }),
    lintGutter(),
    linter(
      async (view) => {
        const document = view.state.doc;
        const result = await request(view, 'update');
        if (!result?.available || view.state.doc !== document) return [];
        const path = workspace.file()?.path;
        return result.diagnostics
          .filter((d) => d.path === path)
          .map((d): Diagnostic => {
            const from = offset(document, { line: d.line - 1, character: d.column });
            return {
              from,
              to: Math.min(document.length, from + 1),
              severity: d.severity,
              message: d.message,
              source: 'TexLab',
            };
          });
      },
      { delay: 600 },
    ),
    keymap.of([
      {
        key: 'F12',
        run: (view) => {
          void definition(view);
          return true;
        },
      },
      { key: 'Mod-Space', run: startCompletion },
      ...completionKeymap,
    ]),
    // These events serve visible toolbar actions as well as keyboard shortcuts.
    keymap.of([
      {
        key: 'Mod-Shift-b',
        run: () => {
          void latex.compile();
          return true;
        },
      },
    ]),
  ];
}
