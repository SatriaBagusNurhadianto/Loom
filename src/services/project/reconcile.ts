import { diffChars } from 'diff';
type Edit = { from: number; to: number; text: string };
export function textChanges(
  base: string,
  next: string,
  budget?: { timeout: number; maxEditLength: number },
): Edit[] {
  let offset = 0;
  const result: Edit[] = [];
  const parts = budget ? diffChars(base, next, budget) : diffChars(base, next);
  if (!parts) throw new Error('The comparison is too large for an automatic merge.');
  for (const part of parts) {
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
export function reconcile(
  base: string,
  local: string,
  disk: string,
  budget?: { timeout: number; maxEditLength: number },
): string | null {
  if (local === base || local === disk) return disk;
  if (disk === base) return local;
  let a: Edit[], b: Edit[];
  try {
    a = textChanges(base, local, budget);
    b = textChanges(base, disk, budget);
  } catch {
    if (budget) return null;
    throw new Error('The document comparison failed.');
  }
  for (const x of a) for (const y of b) if (x.from <= y.to && y.from <= x.to) return null;
  let merged = base;
  for (const e of [...a, ...b].sort((x, y) => y.from - x.from))
    merged = merged.slice(0, e.from) + e.text + merged.slice(e.to);
  return merged;
}
