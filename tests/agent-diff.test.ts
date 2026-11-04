import { expect, it } from 'vitest';
import { changeCounts, diffRows } from '../src/renderer/agent/changePresentation';
import type { AgentChange } from '../src/contracts/agent';
const change = (diff: AgentChange['diff']): AgentChange => ({
  path: 'main.tex',
  kind: 'modified',
  before: '',
  after: '',
  binary: false,
  review: 'pending',
  humanTouched: false,
  diff,
});
it('aligns before/after line numbers and groups a replacement into one navigable change', () => {
  const value = change([
    { kind: 'same', text: 'Title\n' },
    { kind: 'removed', text: 'Old sentence\n' },
    { kind: 'added', text: 'New sentence\nExtra evidence\n' },
    { kind: 'same', text: 'Methods\n' },
    { kind: 'added', text: 'Conclusion' },
  ]);
  expect(diffRows(value)).toEqual({
    limited: false,
    rows: [
      { kind: 'same', text: 'Title', old: 1, next: 1, hunk: 0 },
      { kind: 'removed', text: 'Old sentence', old: 2, next: null, hunk: 1 },
      { kind: 'added', text: 'New sentence', old: null, next: 2, hunk: 1 },
      { kind: 'added', text: 'Extra evidence', old: null, next: 3, hunk: 1 },
      { kind: 'same', text: 'Methods', old: 3, next: 4, hunk: 0 },
      { kind: 'added', text: 'Conclusion', old: null, next: 5, hunk: 2 },
    ],
  });
  expect(changeCounts(value)).toEqual({ added: 3, removed: 1 });
});
it('bounds rendered diff rows without claiming a complete preview', () => {
  const result = diffRows(change([{ kind: 'added', text: 'line\n'.repeat(5000) }]));
  expect(result.limited).toBe(true);
  expect(result.rows).toHaveLength(4000);
});
