import { isAbsolute, relative, resolve, sep } from 'node:path';
import { relativePath } from '../../contracts/project';
import type { LatexDiagnostic } from '../../contracts/latex';
export function mappedPath(input: string, root: string, paths: string[]): string | null {
  const normalized = input.replace(/^\.\//, '');
  const path = (isAbsolute(normalized) ? relative(root, normalized) : normalized)
    .split(sep)
    .join('/');
  if (relativePath.safeParse(path).success && paths.includes(path)) return path;
  // Tools sometimes qualify the same source with a relative directory prefix.
  const actual = relative(root, resolve(root, normalized)).split(sep).join('/');
  return paths.includes(actual) ? actual : null;
}
export function compilerDiagnostics(log: string, root: string, paths: string[]): LatexDiagnostic[] {
  const result: LatexDiagnostic[] = [];
  for (const line of log.split(/\r?\n/)) {
    const match = line.match(/^(.+?\.(?:tex|sty|cls|bib)):(\d+):\s*(.*)/);
    if (match)
      result.push({
        path: mappedPath(match[1], root, paths),
        line: +match[2],
        column: 0,
        severity: /warning/i.test(match[3]) ? 'warning' : 'error',
        message: match[3].slice(0, 3000),
      });
    else if (/^(?:! |LaTeX Warning:|Package \S+ Warning:|.*(?:ERROR|WARN) - )/.test(line))
      result.push({
        path: null,
        line: 1,
        column: 0,
        severity: /warning|WARN/.test(line) ? 'warning' : 'error',
        message: line.slice(0, 3000),
      });
    if (result.length === 500) break;
  }
  return result;
}
