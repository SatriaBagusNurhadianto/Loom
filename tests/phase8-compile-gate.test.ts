import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { findLatexExecutable, latexEnvironment } from '../src/services/latex/tools';
import {
  compileGateReady,
  compileGateRelease,
  withCompileGate,
} from './helpers/phase8-compile-gate';

it('rejects ambiguous input rather than silently running an ungated benchmark', () => {
  expect(() => withCompileGate('no document')).toThrow('exactly one document start');
  expect(() => withCompileGate('\\begin{document}\\begin{document}')).toThrow();
});

it.skipIf(process.env.LOOM_TEST_TEX !== '1')(
  'keeps native latexmk busy until release, then produces a PDF',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-compile-gate-'));
    const output = join(directory, 'output');
    await mkdir(output);
    await writeFile(
      join(directory, 'main.tex'),
      withCompileGate(
        '\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\begin{document}\nTiny gate check.\\end{document}\n',
      ),
    );
    const executable = await findLatexExecutable('latexmk');
    expect(executable, 'LOOM_TEST_TEX=1 requires a local latexmk installation.').not.toBeNull();
    const child = spawn(
      executable!,
      [
        '-norc',
        '-pdf',
        '-no-shell-escape',
        '-interaction=nonstopmode',
        '-synctex=1',
        `-outdir=${output}`,
        './main.tex',
      ],
      {
        cwd: directory,
        env: { ...process.env, ...latexEnvironment(), openin_any: 'p', openout_any: 'p' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let log = '';
    child.stdout.on('data', (chunk) => {
      log += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      log += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    // Avoid an unhandled rejection if the engine is missing before the marker poll.
    void exited.catch(() => {});
    try {
      await expect
        .poll(() => readFile(join(output, compileGateReady), 'utf8'), { timeout: 3000 })
        .toBe('ready\n');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(child.exitCode, log).toBeNull();
      await writeFile(join(output, compileGateRelease), 'release\n');
      await expect.poll(() => child.exitCode, { timeout: 5000, message: log }).toBe(0);
      expect(await exited, log).toBe(0);
      expect((await readFile(join(output, 'main.pdf'))).subarray(0, 4).toString()).toBe('%PDF');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await exited.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000,
);
