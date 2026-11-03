import { spawn } from 'node:child_process';
import { promises as fs, constants } from 'node:fs';
import { delimiter, join, isAbsolute } from 'node:path';
import { toolNames, type BuildState } from '../../contracts/latex';

export type Tool = BuildState['tools'][number] & { executable: string | null };
// The small supervisor owns the entire native process group. EOF on its stdin also
// cancels it when Electron's utility process is killed, including SIGKILL.
const supervisor = `
const {spawn}=require('node:child_process');
const child=spawn(process.argv[1],process.argv.slice(2),{stdio:['pipe','inherit','inherit'],detached:process.platform!=='win32'});
let ending=false;
function kill(signal){try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal)}catch{}}
function stop(){if(ending)return;ending=true;kill('SIGTERM');setTimeout(()=>kill('SIGKILL'),500).unref()}
process.stdin.pipe(child.stdin);process.stdin.on('end',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('error',e=>{process.stderr.write(e.message);process.exit(127)});
child.on('close',code=>{kill('SIGKILL');process.exit(code===null?130:code)});
`;
export function spawnOwnedTool(
  executable: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
) {
  return spawn(process.execPath, ['-e', supervisor, executable, ...args], {
    cwd,
    env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}
export function runTool(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onOutput?: (chunk: string) => void;
  } = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Operation cancelled.'));
      return;
    }
    const child = spawnOwnedTool(executable, args, options.cwd, options.env);
    let output = '',
      timedOut = false;
    const append = (bytes: Buffer) => {
      const text = bytes.toString('utf8');
      output = (output + text).slice(-140000);
      options.onOutput?.(text);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const cancel = () => child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, options.timeoutMs ?? 120000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    };
    child.once('error', (e) => {
      cleanup();
      reject(e);
    });
    child.once('close', (code) => {
      cleanup();
      if (timedOut)
        reject(new Error('Tool timed out. Check the build log and local tool installation.'));
      else resolve({ code: code ?? 130, output });
    });
  });
}
export async function findExecutable(name: string): Promise<string | null> {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue; // Never execute a project-local program via PATH=.
    const candidate = join(directory, process.platform === 'win32' ? name + '.exe' : name);
    try {
      await fs.access(candidate, constants.X_OK);
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      /* Continue detection. */
    }
  }
  return null;
}
export async function detectTools(): Promise<Tool[]> {
  return Promise.all(
    toolNames.map(async (name) => {
      const executable = await findExecutable(name);
      if (!executable)
        return { name, available: false, version: 'Not found on PATH', executable: null };
      try {
        const result = await runTool(executable, [name === 'latexmk' ? '-v' : '--version'], {
          timeoutMs: 5000,
        });
        return {
          name,
          available: result.code === 0,
          version: result.output.trim().slice(0, 500),
          executable,
        };
      } catch {
        return { name, available: false, version: 'Version check failed or timed out', executable };
      }
    }),
  );
}
