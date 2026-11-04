import type { AgentChange } from '../../contracts/agent';
export function changeCounts(change: AgentChange) {
  const count = (kind: 'added' | 'removed') =>
    change.diff
      ?.filter((part) => part.kind === kind)
      .reduce(
        (sum, part) => sum + part.text.split('\n').length - (part.text.endsWith('\n') ? 1 : 0),
        0,
      ) ?? 0;
  return { added: count('added'), removed: count('removed') };
}
type DiffRow = {
  kind: 'same' | 'added' | 'removed';
  text: string;
  old: number | null;
  next: number | null;
  hunk: number;
};
export function diffRows(change: AgentChange) {
  let old = 1,
    next = 1,
    hunk = 0,
    changing = false;
  const rows: DiffRow[] = [];
  for (const part of change.diff ?? []) {
    if (part.kind !== 'same' && !changing) hunk++;
    changing = part.kind !== 'same';
    const lines = part.text.split('\n');
    if (part.text.endsWith('\n')) lines.pop();
    for (const text of lines) {
      if (rows.length >= 4000) return { rows, limited: true };
      rows.push({
        kind: part.kind,
        text,
        old: part.kind === 'added' ? null : old++,
        next: part.kind === 'removed' ? null : next++,
        hunk: changing ? hunk : 0,
      });
    }
  }
  return { rows, limited: false };
}
