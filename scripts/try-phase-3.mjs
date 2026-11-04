import { access, cp, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '..');
const destination = join(root, '.cache', 'phase-3-examples');
await mkdir(destination, { recursive: true });
for (const entry of await readdir(join(root, 'examples', 'phase-3'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const target = join(destination, entry.name);
  try {
    await access(target);
  } catch {
    await cp(join(root, 'examples', 'phase-3', entry.name), target, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
console.log('Using installed PDF tools from PATH or the persistent user-local Loom toolchain.');
console.log(
  `In Loom, choose Try a sample paper (in Projects if a project is already open).\nEdit a sentence, choose Update PDF, then Download PDF.\nOptional developer sample folders: ${destination}. Existing copies are preserved.\nThis run uses a separate profile in .cache/phase-3-profile.\nStop with Ctrl C.`,
);
function run(executable, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit' });
    const interrupt = () => child.kill('SIGINT');
    process.once('SIGINT', interrupt);
    child.once('error', (error) => {
      process.removeListener('SIGINT', interrupt);
      reject(error);
    });
    child.once('exit', (code) => {
      process.removeListener('SIGINT', interrupt);
      resolveRun(code ?? 1);
    });
  });
}
const built = await run('npm', ['run', 'build']);
if (built) process.exitCode = built;
else
  process.exitCode = await run(createRequire(import.meta.url)('electron'), [
    join(root, 'out/main/index.js'),
    `--user-data-dir=${join(root, '.cache', 'phase-3-profile')}`,
  ]);
