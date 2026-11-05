import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const cache = join(root, '.cache');
await mkdir(cache, { recursive: true });
const demo = await mkdtemp(join(cache, 'phase-7-demo-'));
const remote = join(demo, 'remote.git');
const authorOne = join(demo, 'author-one');
const authorTwo = join(demo, 'author-two');
const runFile = promisify(execFile);

async function git(cwd, args) {
  const result = await runFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return result.stdout.trimEnd();
}

async function configureAuthor(path, name) {
  await git(path, ['config', 'user.name', name]);
  await git(path, [
    'config',
    'user.email',
    `${name.toLowerCase().replaceAll(' ', '.')}@example.invalid`,
  ]);
}

const source = String.raw`\documentclass{article}
\usepackage{graphicx}
\graphicspath{{figures/}}
\title{Loom Phase 7 Demo}
\author{Synthetic authors}
\begin{document}
\maketitle
\section{Results}
\label{sec:results}
This sentence will be edited by both authors.

The figure is \ref{fig:plot}; this synthetic citation is \cite{demo2025}.
\begin{figure}[h]
  \centering
  \includegraphics[width=.25\linewidth]{plot}
  \caption{A synthetic figure found through graphicspath.}
  \label{fig:plot}
\end{figure}
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;

try {
  await git(demo, ['init', '--bare', '--initial-branch=main', remote]);
  await git(demo, ['init', '--initial-branch=main', authorOne]);
  await configureAuthor(authorOne, 'Demo Author One');
  await mkdir(join(authorOne, 'figures'));
  await writeFile(join(authorOne, 'main.tex'), source);
  await writeFile(
    join(authorOne, 'refs.bib'),
    '@article{demo2025, title={A Synthetic Result}, author={Demo, A.}, journal={Demo Journal}, year={2025}}\n',
  );
  await writeFile(
    join(authorOne, 'figures', 'plot.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS5kAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await git(authorOne, ['add', 'main.tex', 'refs.bib', 'figures/plot.png']);
  await git(authorOne, ['commit', '-m', 'Synthetic baseline']);
  await git(authorOne, ['remote', 'add', 'origin', remote]);
  await git(authorOne, ['push', '-u', 'origin', 'main']);

  await git(demo, ['clone', remote, authorTwo]);
  await configureAuthor(authorTwo, 'Demo Author Two');
  await writeFile(
    join(authorTwo, 'main.tex'),
    source.replace(
      'This sentence will be edited by both authors.',
      'The remote author revised this sentence.',
    ),
  );
  await git(authorTwo, ['add', 'main.tex']);
  await git(authorTwo, ['commit', '-m', 'Remote author revision']);
  await git(authorTwo, ['push']);

  await writeFile(
    join(authorOne, 'main.tex'),
    source.replace(
      'This sentence will be edited by both authors.',
      'The local author revised this sentence.',
    ),
  );
  await writeFile(join(authorOne, '.env'), 'TOKEN=synthetic-demo-only\n');
  await writeFile(join(authorOne, 'main.aux'), '\\relax\n');
} catch (error) {
  console.error(`Could not prepare the Phase 7 demo at ${demo}:`, error.message);
  process.exitCode = 1;
  process.exit();
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;

console.log(`Phase 7 demo created at: ${demo}`);
console.log(`Open this project in Loom: ${authorOne}`);
console.log(`Second author clone: ${authorTwo}`);
console.log(`Disposable local remote: ${pathToFileURL(remote).href}`);
console.log(`Tryout guide: ${join(root, 'docs', 'phase-7-testing.md')}`);
console.log('The demo uses synthetic source, a local bare remote, and an isolated Loom profile.');
console.log('No GitHub remote or credentials are used. Stop Loom with Ctrl C.');

if (process.argv.includes('--prepare-only')) process.exit(0);

const built = await run('npm', ['run', 'build']);
if (built) process.exitCode = built;
else
  process.exitCode = await run(createRequire(import.meta.url)('electron'), [
    join(root, 'out', 'main', 'index.js'),
    `--user-data-dir=${join(demo, 'loom-profile')}`,
  ]);

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
