/** UTF-16 offsets, matching CodeMirror and JavaScript string slicing. */
export type MatchRange = { from: number; to: number };
export type TextMatch = MatchRange & { ranges: MatchRange[]; score: number; approximate: boolean };

const words = /[\p{L}\p{N}\p{M}_]+/gu;
const phrase = /^[\p{L}\p{N}\p{M}_]+(?:\s+[\p{L}\p{N}\p{M}_]+)*$/u;
const literalPattern = (query: string) =>
  new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');

// Bounded optimal-string-alignment distance: insertion, deletion, substitution or transposition.
// Long commands/identifiers and short words stay literal to avoid noise and quadratic work.
function distance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max || b.length > 64) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let before = previous;
  for (let i = 1; i <= a.length; i++) {
    const row = Array<number>(b.length + 1).fill(max + 1);
    row[0] = i;
    let best = max + 1;
    for (let j = Math.max(1, i - max); j <= Math.min(b.length, i + max); j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + +(a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        row[j] = Math.min(row[j], before[j - 2] + 1);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    before = previous;
    previous = row;
  }
  return previous[b.length];
}

export function textMatches(text: string, rawQuery: string, limit = 20): TextMatch[] {
  const query = rawQuery.trim();
  if (!query || query.length > 500 || limit <= 0) return [];
  const result: TextMatch[] = [];
  for (const match of text.matchAll(literalPattern(query))) {
    const range = { from: match.index, to: match.index + match[0].length };
    result.push({ ...range, ranges: [range], score: 10, approximate: false });
    if (result.length >= limit) return result;
  }
  // Punctuation-heavy LaTeX expressions remain literal, with no regex interpretation.
  const terms = query.toLowerCase().normalize('NFC').split(/\s+/u);
  if (!phrase.test(query) || terms.length > 8 || terms.some((term) => term.length > 64))
    return result;
  if (terms.every((term) => term.length < 4)) return result;
  const cache = new Map<string, number>();
  const window: Array<MatchRange & { word: string }> = [];
  for (const token of text.matchAll(words)) {
    window.push({
      from: token.index,
      to: token.index + token[0].length,
      word: token[0].toLowerCase().normalize('NFC'),
    });
    if (window.length > terms.length) window.shift();
    if (window.length !== terms.length) continue;
    let edits = 0;
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i],
        max = term.length < 4 || !/\p{L}/u.test(term) ? 0 : term.length < 8 ? 1 : 2;
      const key = `${i}:${window[i].word}`;
      let value = cache.get(key);
      if (value === undefined) {
        value = distance(term, window[i].word, max);
        if (cache.size < 4096) cache.set(key, value);
      }
      if (value > max) {
        edits = 3;
        break;
      }
      edits += value;
    }
    if (!edits || edits > 2) continue;
    const from = window[0].from,
      to = window[window.length - 1].to;
    if (result.some((match) => from < match.to && to > match.from)) continue;
    result.push({
      from,
      to,
      ranges: window.map(({ from, to }) => ({ from, to })),
      score: 100 + edits * 10,
      approximate: true,
    });
    if (result.length >= limit) break;
  }
  return result.sort((a, b) => a.score - b.score || a.from - b.from);
}

/** Filename abbreviations match in order; typo matching uses the same word rules as source. */
export function pathMatch(path: string, rawQuery: string): TextMatch | undefined {
  const query = rawQuery.trim();
  if (!query || query.length > 500) return;
  const exact = [...path.matchAll(literalPattern(query))][0];
  const basename = path.lastIndexOf('/') + 1;
  if (exact) {
    const from = exact.index,
      to = from + exact[0].length;
    return {
      from,
      to,
      ranges: [{ from, to }],
      approximate: false,
      score: from === basename ? (to === path.length ? 0 : 1) : 2,
    };
  }
  if (query.length < 2 || /\s/u.test(query)) return textMatches(path, query, 1)[0];
  // Try the basename first, then the full relative path. Preserve original code-point offsets.
  for (const start of basename ? [basename, 0] : [0]) {
    const ranges: MatchRange[] = [];
    let offset = start;
    const chars = [...query.toLowerCase()];
    for (const char of path.slice(start)) {
      if (char.toLowerCase() === chars[ranges.length])
        ranges.push({ from: offset, to: offset + char.length });
      offset += char.length;
      if (ranges.length === chars.length) break;
    }
    if (ranges.length !== chars.length) continue;
    const from = ranges[0].from,
      to = ranges[ranges.length - 1].to;
    return {
      from,
      to,
      ranges,
      approximate: true,
      score: 200 + (to - from - query.length) + (from - start) * 3 + (start === basename ? 0 : 20),
    };
  }
  // Do not mistake an abbreviation such as mtex for a typo of every .tex extension.
  return textMatches(
    path.slice(0, path.lastIndexOf('.') > basename ? path.lastIndexOf('.') : path.length),
    query,
    1,
  )[0];
}
