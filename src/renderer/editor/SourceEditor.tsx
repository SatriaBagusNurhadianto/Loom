import { createEffect, createMemo, onCleanup } from 'solid-js';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  searchKeymap,
  highlightSelectionMatches,
  search,
  openSearchPanel,
} from '@codemirror/search';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { ProjectWorkspace } from './documents';
export function SourceEditor(props: { workspace: ProjectWorkspace }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  const wrap = new Compartment();
  const font = new Compartment();
  const document = createMemo(() => {
    props.workspace.version();
    return props.workspace.live(props.workspace.active());
  });
  createEffect(() => {
    const w = props.workspace;
    const d = document();
    if (!d) return;
    const id = w.active();
    let cancelled = false;
    void d.ready.then(() => {
      if (cancelled || !d.initialized) return;
      const caret = w.caret(id);
      view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: d.doc.getText('source').toString(),
          selection: EditorSelection.single(
            Math.min(caret?.anchor ?? 0, d.doc.getText('source').length),
            Math.min(caret?.head ?? 0, d.doc.getText('source').length),
          ),
          extensions: [
            search({ top: true }),
            EditorView.updateListener.of((update) => {
              if (update.selectionSet || update.docChanged) {
                const selection = update.state.selection.main;
                w.saveCaret(id, {
                  anchor: selection.anchor,
                  head: selection.head,
                  scroll: update.view.scrollDOM.scrollTop,
                });
              }
            }),
            lineNumbers(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            StreamLanguage.define(stex),
            syntaxHighlighting(defaultHighlightStyle),
            EditorView.domEventHandlers({
              keydown(event) {
                if (
                  !event.isComposing &&
                  (event.ctrlKey || event.metaKey) &&
                  !event.altKey &&
                  event.shiftKey &&
                  event.key.toLowerCase() === 'z'
                ) {
                  event.preventDefault();
                  d.undo.redo();
                  return true;
                }
                return false;
              },
            }),
            keymap.of([
              ...yUndoManagerKeymap,
              ...searchKeymap,
              ...defaultKeymap,
              indentWithTab,
              {
                key: 'Mod-s',
                run: () => {
                  void w.flush();
                  return true;
                },
              },
            ]),
            yCollab(d.doc.getText('source'), undefined, { undoManager: d.undo }),
            wrap.of(w.wrap() ? EditorView.lineWrapping : []),
            font.of(EditorView.theme({ '&': { fontSize: `${w.font()}px` } })),
            EditorView.theme(
              {
                '&': {
                  height: '100%',
                  backgroundColor: 'var(--surface-editor)',
                  color: 'var(--text-primary)',
                },
                '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-source)' },
                '.cm-content': { caretColor: 'var(--text-primary)' },
                '.cm-gutters': {
                  background: 'var(--surface-editor)',
                  color: 'var(--text-muted)',
                  border: 'none',
                },
                '.cm-activeLine': { background: '#ffffff08' },
                '&.cm-focused': { outline: 'none' },
                '.cm-cursor': { borderLeftColor: 'var(--text-primary)' },
              },
              { dark: true },
            ),
            EditorView.contentAttributes.of({
              'aria-label': 'LaTeX source editor',
              spellcheck: 'false',
            }),
          ],
        }),
      });
      if (caret) view.scrollDOM.scrollTop = caret.scroll;
      view.dom.addEventListener('loom:find', () => openSearchPanel(view!));
      const locate = (event: Event) => {
        const offset = Math.min((event as CustomEvent<number>).detail, view!.state.doc.length);
        view!.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
        view!.focus();
      };
      view.dom.addEventListener('loom:locate', locate);
    });
    onCleanup(() => {
      cancelled = true;
      if (view) {
        const selection = view.state.selection.main;
        w.saveCaret(id, {
          anchor: selection.anchor,
          head: selection.head,
          scroll: view.scrollDOM.scrollTop,
        });
      }
      view?.destroy();
      view = undefined;
    });
  });
  // Font and wrapping changes are handled by the editor's compartments.
  createEffect(() => {
    const wrapping = props.workspace.wrap(),
      size = props.workspace.font();
    view?.dispatch({
      effects: [
        wrap.reconfigure(wrapping ? EditorView.lineWrapping : []),
        font.reconfigure(EditorView.theme({ '&': { fontSize: `${size}px` } })),
      ],
    });
  });
  return <div class="live-editor" ref={host} />;
}
