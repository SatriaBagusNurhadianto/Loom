import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { unzipSync } from 'fflate';
import { sourceArchive, sourcePreflight } from '../src/services/git/export';
import { gitResultSchema } from '../src/contracts/git';
import { writeSourceExport } from '../src/main/source-export';

describe('portable source export', () => {
  it('keeps ordinary source, local classes, bibliography, and assets while excluding private/generated data', () => {
    const files = new Map([
      [
        'main.tex',
        Buffer.from(
          '\\documentclass{paper}\n\\begin{document}\\ref{missing} \\cite{unknown} \\includegraphics{figures/plot}\\end{document}',
        ),
      ],
      ['paper.cls', Buffer.from('\\ProvidesClass{paper}')],
      ['refs.bib', Buffer.from('@article{known, title={Known}}')],
      ['figures/plot.png', Buffer.from([1, 2, 3])],
      ['.env', Buffer.from('TOKEN=synthetic')],
      ['main.aux', Buffer.from('temporary')],
      ['.loom/recovery.json', Buffer.from('private')],
    ]);
    const preflight = sourcePreflight(files, 'revision-a');
    expect(preflight.included).toEqual(['main.tex', 'paper.cls', 'refs.bib', 'figures/plot.png']);
    expect(preflight.excluded.map(({ path }) => path)).toEqual([
      '.env',
      'main.aux',
      '.loom/recovery.json',
    ]);
    expect(preflight.warnings.join('\n')).toContain('Unresolved labels');
    expect(preflight.warnings.join('\n')).toContain('Unresolved citation keys');
    expect(preflight.warnings.join('\n')).not.toContain('Missing local figure');
    const archive = sourceArchive(files, 'revision-a');
    const entries = unzipSync(archive.bytes);
    expect(Object.keys(entries).sort()).toEqual(preflight.included.slice().sort());
    expect(Buffer.from(entries['main.tex']!).toString()).toContain('cite{unknown}');
    expect(entries['.env']).toBeUndefined();
  });

  it('warns about missing literal assets and checks export revision consistency', () => {
    const files = new Map([
      [
        'main.tex',
        Buffer.from('\\includegraphics{missing/plot}\n\\ref{absent}\\bibliography{not-present}'),
      ],
    ]);
    const report = sourcePreflight(files, 'revision-2');
    expect(report.warnings.join('\n')).toContain('Missing local figure');
    expect(report.warnings.join('\n')).toContain('Unresolved labels');
    expect(report.warnings.join('\n')).toContain('Missing bibliography files');
  });

  it('bounds preflight warning strings to the renderer response contract', () => {
    const refs = Array.from({ length: 20 }, (_, index) => `missing-${index}-${'x'.repeat(45)}`);
    const source = refs.map((key) => `\\ref{${key}}`).join('\n');
    const report = sourcePreflight(new Map([['main.tex', Buffer.from(source)]]), 'revision-long');
    expect(report.warnings.every((warning) => warning.length <= 500)).toBe(true);
    expect(gitResultSchema.safeParse({ ok: true, value: report }).success).toBe(true);
  });

  it('rejects a source snapshot that exceeds the expanded archive limit', () => {
    const oversized = Buffer.alloc(128 * 1024 * 1024 + 1);
    expect(() => sourcePreflight(new Map([['large.bin', oversized]]), 'revision-large')).toThrow(
      /128 MiB expanded/,
    );
  });

  it('rejects an incompressible archive that exceeds the compressed export limit', () => {
    const incompressible = randomBytes(64 * 1024 * 1024 + 1);
    expect(() => sourceArchive(new Map([['asset.bin', incompressible]]), 'revision-large')).toThrow(
      /64 MiB compressed/,
    );
  });

  it('writes atomically outside the project and does not truncate a linked source file', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'loom-source-export-'));
    const root = join(parent, 'paper');
    await mkdir(root);
    try {
      const source = join(root, 'main.tex');
      const destination = join(parent, 'linked.zip');
      await writeFile(source, 'preserve me');
      await link(source, destination);
      await writeSourceExport(destination, new Uint8Array([1, 2, 3]), {
        root,
        paths: ['main.tex'],
      });
      expect(await readFile(source, 'utf8')).toBe('preserve me');
      expect(Array.from(await readFile(destination))).toEqual([1, 2, 3]);
      await expect(
        writeSourceExport(join(root, 'inside.zip'), new Uint8Array([4]), {
          root,
          paths: ['main.tex'],
        }),
      ).rejects.toThrow(/outside the project/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
