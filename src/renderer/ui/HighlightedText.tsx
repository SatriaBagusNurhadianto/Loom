import { For, createMemo } from 'solid-js';
import type { MatchRange } from '../../domain/search';

/** Render original text safely; search results are never interpreted as HTML. */
export function HighlightedText(props: { text: string; ranges: MatchRange[] }) {
  const parts = createMemo(() => {
    const result: Array<{ text: string; match: boolean }> = [];
    let end = 0;
    for (const range of [...props.ranges].sort((a, b) => a.from - b.from)) {
      const from = Math.max(end, range.from),
        to = Math.min(props.text.length, range.to);
      if (from >= to) continue;
      if (from > end) result.push({ text: props.text.slice(end, from), match: false });
      result.push({ text: props.text.slice(from, to), match: true });
      end = to;
    }
    if (end < props.text.length) result.push({ text: props.text.slice(end), match: false });
    return result;
  });
  return (
    <For each={parts()}>
      {(part) => (part.match ? <mark class="search-match">{part.text}</mark> : part.text)}
    </For>
  );
}
