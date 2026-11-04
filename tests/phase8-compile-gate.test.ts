import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
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
  'keeps a real engine busy until release in its output directory, then produces a PDF',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-compile-gate-'));
    const output = join(directory, 'output');
    await mkdir(output);
    await writeFile(
      join(directory, 'main.tex'),
      withCompileGate(
        '\\documentclass{article}\n\\begin{document}\nTiny gate check.\\end{document}\n',
      ),
    );
    const child = spawn(
      'pdflatex',
      ['-no-shell-escape', '-interaction=nonstopmode', `-output-directory=${output}`, 'main.tex'],
      {
        cwd: directory,
        env: { ...process.env, openin_any: 'p', openout_any: 'p' },
        stdio: 'ignore',
      },
    );
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
      expect(child.exitCode).toBeNull();
      await writeFile(join(output, compileGateRelease), 'release\n');
      await expect.poll(() => child.exitCode, { timeout: 3000 }).toBe(0);
      expect(await exited).toBe(0);
      expect((await readFile(join(output, 'main.pdf'))).subarray(0, 4).toString()).toBe('%PDF');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await exited.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  },
);
