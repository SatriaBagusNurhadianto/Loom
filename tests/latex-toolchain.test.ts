import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLatexExecutable, latexEnvironment, runTool } from '../src/services/latex/tools';

it('finds a persistent user TeX installation from a desktop environment and exposes its engines to latexmk', async () => {
  const home = await mkdtemp(join(tmpdir(), 'loom-tex-discovery-'));
  const bin = join(home, '.TinyTeX/bin/x86_64-linux');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pdflatex'), '#!/bin/sh\nprintf "user-local engine\\n"\n');
  await writeFile(join(bin, 'latexmk'), '#!/bin/sh\nexec pdflatex --version\n');
  await chmod(join(bin, 'pdflatex'), 0o755);
  await chmod(join(bin, 'latexmk'), 0o755);
  try {
    const options = { home, path: '/nonexistent-loom-system-bin' };
    expect(await findLatexExecutable('pdflatex', options)).toBe(join(bin, 'pdflatex'));
    const result = await runTool(join(bin, 'latexmk'), [], { env: latexEnvironment(options) });
    expect(result.code).toBe(0);
    expect(result.output).toBe('user-local engine\n');
    // An explicit machine override remains isolatable and never searches the project directory.
    expect(
      await findLatexExecutable('pdflatex', { ...options, override: './:/no-tools' }),
    ).toBeNull();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
