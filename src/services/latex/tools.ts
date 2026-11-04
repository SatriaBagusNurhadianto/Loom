import { spawn } from 'node:child_process';
import { promises as fs, constants } from 'node:fs';
import { delimiter, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { toolNames, type BuildState } from '../../contracts/latex';

export type Tool = BuildState['tools'][number] & { executable: string | null };
// The small supervisor owns the entire native process group. A separate, always
// drained ownership pipe detects owner death even when tool stdin is backpressured.
const supervisor = `
const {spawn}=require('node:child_process');
const {Socket}=require('node:net');
const child=spawn(process.argv[1],process.argv.slice(2),{stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
let ending=false;
function kill(signal){try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal)}catch{}}
function stop(){if(ending)return;ending=true;kill('SIGTERM');setTimeout(()=>kill('SIGKILL'),500).unref()}
const owner=new Socket({fd:3,readable:true,writable:false});
owner.on('end',stop);owner.on('error',stop);owner.resume();
child.stdin.on('error',stop);
process.stdout.on('error',stop);process.stderr.on('error',stop);
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
process.stdin.pipe(child.stdin);process.stdin.on('end',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('error',e=>{process.stderr.write(e.message);process.exit(127)});
child.on('close',code=>{kill('SIGKILL');process.exitCode=code===null?130:code;owner.destroy();process.stdin.destroy()});
`;
export function spawnOwnedTool(
  executable: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
) {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1' };
  environment.PATH = (environment.PATH ?? '').split(delimiter).filter(isAbsolute).join(delimiter);
  return spawn(process.execPath, ['-e', supervisor, executable, ...args], {
    cwd,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
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
    maxOutputBytes?: number;
    env?: NodeJS.ProcessEnv;
    onOutput?: (chunk: string) => void;
  } = {},
): Promise<{ code: number; output: string; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Operation cancelled.'));
      return;
    }
    const child = spawnOwnedTool(executable, args, options.cwd, options.env);
    let output = '',
      stdout = '',
      stderr = '',
      timedOut = false;
    const append = (stream: 'stdout' | 'stderr') => (bytes: Buffer) => {
      const text = bytes.toString('utf8');
      output = (output + text).slice(-(options.maxOutputBytes ?? 140000));
      if (stream === 'stdout') stdout = (stdout + text).slice(-(options.maxOutputBytes ?? 140000));
      else stderr = (stderr + text).slice(-(options.maxOutputBytes ?? 140000));
      options.onOutput?.(text);
    };
    child.stdout.on('data', append('stdout'));
    child.stderr.on('data', append('stderr'));
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
      else resolve({ code: code ?? 130, output, stdout, stderr });
    });
  });
}
async function executableIn(name: string, directories: string[]): Promise<string | null> {
  for (const directory of directories) {
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
export async function findExecutable(name: string): Promise<string | null> {
  return executableIn(name, (process.env.PATH ?? '').split(delimiter));
}
type LatexEnvironmentOptions = { home?: string; path?: string; override?: string };
function latexDirectories(options: LatexEnvironmentOptions = {}) {
  const home = options.home ?? homedir();
  const override = options.override ?? process.env.LOOM_TEX_PATH;
  const fallback =
    process.platform === 'linux' && process.arch === 'x64'
      ? [join(home, '.TinyTeX/bin/x86_64-linux'), join(home, '.local/share/loom/bin')]
      : [];
  return [
    ...new Set(
      (override !== undefined
        ? override.split(delimiter)
        : [...(options.path ?? process.env.PATH ?? '').split(delimiter), ...fallback]
      ).filter(isAbsolute),
    ),
  ];
}
/** Machine-owned tools only: project-relative PATH entries are never executable. */
export function findLatexExecutable(
  name: (typeof toolNames)[number],
  options?: LatexEnvironmentOptions,
) {
  return executableIn(name, latexDirectories(options));
}
export function latexEnvironment(options: LatexEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const home = options.home ?? homedir();
  return {
    PATH: latexDirectories(options).join(delimiter),
    ...(process.platform === 'linux'
      ? {
          LD_LIBRARY_PATH: [
            join(home, '.local/share/loom/lib'),
            ...(process.env.LD_LIBRARY_PATH ?? '').split(delimiter),
          ]
            .filter(isAbsolute)
            .join(delimiter),
        }
      : {}),
  };
}
export async function detectTools(): Promise<Tool[]> {
  return Promise.all(
    toolNames.map(async (name) => {
      const executable = await findLatexExecutable(name);
      if (!executable)
        return {
          name,
          available: false,
          version: 'Not found in configured tool directories',
          executable: null,
        };
      try {
        const result = await runTool(
          executable,
          [name === 'latexmk' ? '-v' : name === 'synctex' ? 'help' : '--version'],
          {
            timeoutMs: 5000,
            env: latexEnvironment(),
          },
        );
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
