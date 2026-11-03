import { expect, it } from 'vitest';
import { pathMatch, textMatches } from '../src/domain/search';

it('ranks literal filenames and content ahead of typos and abbreviations', () => {
  expect(pathMatch('main.tex', 'MAIN.TEX')?.score).toBe(0);
  expect(pathMatch('main.tex', 'main')?.score).toBe(1);
  const abbreviated = pathMatch('sections/main.tex', 'mtex')!;
  expect(abbreviated.approximate).toBe(true);
  expect(
    abbreviated.ranges.map((range) => 'sections/main.tex'.slice(range.from, range.to)).join(''),
  ).toBe('mtex');
  expect(textMatches('Introduction', 'intrduction')[0].score).toBeLessThan(abbreviated.score);
  expect(pathMatch('main.tex', 'xtem')).toBeUndefined();
});

it('finds insertions, deletions, substitutions and transpositions without replacing source text', () => {
  for (const query of ['intrduction', 'introduuction', 'introductxon', 'introductoin']) {
    const text = 'A scientific Introduction. Introduction again.';
    const matches = textMatches(text, query);
    expect(matches).toHaveLength(2);
    expect(matches.every((match) => match.approximate)).toBe(true);
    expect(matches.map((match) => text.slice(match.from, match.to))).toEqual([
      'Introduction',
      'Introduction',
    ]);
  }
});

it('keeps exact substring matches first, even when an earlier word matches approximately', () => {
  const text = 'methodology first, then metodology';
  expect(textMatches(text, 'metodology').map((match) => match.approximate)).toEqual([false, true]);
  expect(textMatches('Introduction', 'intro')[0].approximate).toBe(false);
});

it('supports adjacent multiword phrases with at most two total edits and original word ranges', () => {
  const text = 'A reliable scientific manuscript. A scientific unrelated manuscript.';
  const [match] = textMatches(text, 'scietific manuscrip');
  expect(text.slice(match.from, match.to)).toBe('scientific manuscript');
  expect(match.ranges.map((range) => text.slice(range.from, range.to))).toEqual([
    'scientific',
    'manuscript',
  ]);
  expect(textMatches(text, 'scietific manuscrip')).toHaveLength(1);
});

it('keeps short words, numbers and punctuation-heavy scientific expressions literal', () => {
  expect(textMatches('the cat 2025 \\alpha{x}', 'teh')).toEqual([]);
  expect(textMatches('2025', '2026')).toEqual([]);
  expect(textMatches('\\alpha{x}', '\\alpa{x}')).toEqual([]);
  expect(textMatches('\\alpha{x}', '\\alpha{x}')[0].approximate).toBe(false);
  expect(textMatches('anything', '.*')).toEqual([]);
});

it('retains correct UTF-16 offsets after non-ASCII characters and mixed case', () => {
  const text = '🧪 İ 章节 INTRODUCTION Méthodologie';
  for (const query of ['intrduction', '章节', 'méthodologie']) {
    const [match] = textMatches(text, query);
    expect(text.slice(match.from, match.to)).toBe(
      query === 'intrduction' ? 'INTRODUCTION' : query === '章节' ? '章节' : 'Méthodologie',
    );
  }
});

it('bounds results and rejects empty/oversized queries and pathological tokens', () => {
  expect(textMatches('Introduction '.repeat(100), 'intrduction')).toHaveLength(20);
  expect(textMatches('hello', '   ')).toEqual([]);
  expect(pathMatch('hello.tex', '   ')).toBeUndefined();
  expect(textMatches('a'.repeat(501), 'a'.repeat(501))).toEqual([]);
  expect(textMatches('x'.repeat(100_000), 'scientific')).toEqual([]);
});
