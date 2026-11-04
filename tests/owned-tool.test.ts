import { expect, it } from 'vitest';
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise the real supervisor in a separate, killable owner, with no Electron,
// TexLab installation, provider or large-project benchmark required.
it.skipIf(process.platform !== 'linux').each(['owner-kill', 'supervisor-stop'] as const)(
  'reaps a backpressured tool after %s',
  async (action) => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-owned-tool-'));
    const pids = join(dir, 'pids.json');
    const entry = join(dir, 'owner.ts');
    await writeFile(
      entry,
      `
    import { spawnOwnedTool } from ${JSON.stringify(resolve('src/services/latex/tools.ts'))};
    const child = spawnOwnedTool(process.execPath, ['-e', \`
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      fs.writeFileSync(process.argv[1], JSON.stringify({ supervisor: process.ppid, tool: process.pid }));
      // Busy language servers can stop consuming source notifications.
      setInterval(() => {}, 1000);
    \`, ${JSON.stringify(pids)}]);
    child.stdin.on('error', () => {});
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.write(Buffer.alloc(8 * 1024 * 1024));
  `,
    );
    await build({
      configFile: false,
      logLevel: 'silent',
      ssr: { noExternal: true },
      build: {
        ssr: entry,
        outDir: join(dir, 'out'),
        minify: false,
        rollupOptions: { output: { entryFileNames: 'owner.mjs' } },
      },
    });
    const owner = spawn(process.execPath, [join(dir, 'out/owner.mjs')], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const exited = once(owner, 'exit');
    let tracked: { supervisor: number; tool: number } | undefined;
    const running = async (pid: number) => {
      try {
        // Zombies have exited; the host's init is responsible for reaping them.
        return (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1]![0] !== 'Z';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    };
    try {
      await expect
        .poll(
          async () => {
            try {
              tracked = JSON.parse(await readFile(pids, 'utf8'));
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 5000 },
        )
        .toBe(true);
      expect(await running(tracked!.tool)).toBe(true);
      if (action === 'owner-kill') {
        owner.kill('SIGKILL');
        await exited;
      } else {
        process.kill(tracked!.supervisor, 'SIGTERM');
      }
      await expect
        .poll(
          async () => ({
            supervisor: await running(tracked!.supervisor),
            tool: await running(tracked!.tool),
          }),
          { timeout: 3000 },
        )
        .toEqual({ supervisor: false, tool: false });
    } finally {
      owner.kill('SIGKILL');
      await exited;
      if (tracked) {
        try {
          process.kill(-tracked.tool, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
        try {
          process.kill(tracked.supervisor, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
  15000,
);

it.skipIf(process.platform !== 'linux')(
  'delivers native output without EAGAIN or truncation when its reader is slow',
  async () => {
    const { spawnOwnedTool } = await import('../src/services/latex/tools');
    const child = spawnOwnedTool('/usr/bin/head', ['-c', '2097152', '/dev/zero']);
    const closed = once(child, 'close');
    let bytes = 0;
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    try {
      // Fill the supervisor's output pipe before the owner starts consuming it.
      await new Promise((resolve) => setTimeout(resolve, 150));
      child.stdout.on('data', (chunk: Buffer) => (bytes += chunk.length));
      const [code] = await closed;
      expect({ code, stderr, bytes }).toEqual({ code: 0, stderr: '', bytes: 2097152 });
    } finally {
      child.kill('SIGKILL');
      await closed;
    }
  },
  5000,
);
