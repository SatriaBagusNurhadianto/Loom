import { diffChars } from 'diff';
type Edit = { from: number; to: number; text: string };
function edits(base: string, next: string): Edit[] {
  let offset = 0;
  const result: Edit[] = [];
  for (const part of diffChars(base, next)) {
    if (part.added) {
      const last = result.at(-1);
      if (last && last.to === offset) last.text += part.value;
      else result.push({ from: offset, to: offset, text: part.value });
    } else if (part.removed) {
      const last = result.at(-1);
      if (last && last.to === offset) last.to += part.value.length;
      else result.push({ from: offset, to: offset + part.value.length, text: '' });
      offset += part.value.length;
    } else offset += part.value.length;
  }
  return result;
}
export function reconcile(base: string, local: string, disk: string): string | null {
  if (local === base || local === disk) return disk;
  if (disk === base) return local;
  const a = edits(base, local),
    b = edits(base, disk);
  for (const x of a) for (const y of b) if (x.from <= y.to && y.from <= x.to) return null;
  let merged = base;
  for (const e of [...a, ...b].sort((x, y) => y.from - x.from))
    merged = merged.slice(0, e.from) + e.text + merged.slice(e.to);
  return merged;
}
