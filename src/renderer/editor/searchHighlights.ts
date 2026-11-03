import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { searchPanelOpen } from '@codemirror/search';
import { textMatches } from '../../domain/search';

/** Recompute decorations only in rendered ranges; never rewrite source or add undo entries. */
export function projectSearchHighlights(query: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.mark(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          searchPanelOpen(update.state) !== searchPanelOpen(update.startState)
        )
          this.decorations = this.mark(update.view);
      }
      mark(view: EditorView): DecorationSet {
        if (!query || searchPanelOpen(view.state)) return Decoration.none;
        const selection = view.state.selection.main;
        const ranges = [];
        let previousEnd = -1;
        for (const visible of view.visibleRanges) {
          const from = Math.max(previousEnd, visible.from - 512, 0);
          const to = Math.min(view.state.doc.length, visible.to + 512);
          if (from >= to) continue;
          previousEnd = to;
          const text = view.state.doc.sliceString(from, to);
          // Sort by position after the relevance-ranked matcher before constructing decorations.
          for (const match of textMatches(text, query, 1000)) {
            const current =
              selection.from === from + match.from && selection.to === from + match.to;
            for (const range of match.ranges)
              ranges.push(
                Decoration.mark({
                  class: `cm-projectSearchMatch${current ? ' is-current' : ''}`,
                }).range(from + range.from, from + range.to),
              );
          }
        }
        return Decoration.set(ranges, true);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
