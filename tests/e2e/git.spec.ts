import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import {
  findExecutable,
  findLatexExecutable,
  latexEnvironment,
  runTool,
} from '../../src/services/latex/tools';

let app: ElectronApplication;
let page: Page;
let dir: string;
let root: string;
let partner: string;
let git: string;

async function gitAt(cwd: string, ...args: string[]) {
  const result = await runTool(git, ['-C', cwd, ...args]);
  if (result.code !== 0) throw new Error(result.output);
  return result.output.trimEnd();
}

async function gitRun(...args: string[]) {
  const result = await runTool(git, ['-C', root, ...args]);
  if (result.code !== 0) throw new Error(result.output);
  return result.output.trimEnd();
}

async function setContentSize(width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      const [outerWidth, outerHeight] = window.getSize();
      const [contentWidth, contentHeight] = window.getContentSize();
      window.setMaximumSize(0, 0);
      window.setMinimumSize(
        size.width + outerWidth - contentWidth,
        size.height + outerHeight - contentHeight,
      );
      window.setMaximumSize(
        size.width + outerWidth - contentWidth,
        size.height + outerHeight - contentHeight,
      );
      window.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}

test.beforeEach(async ({}, testInfo) => {
  git = (await findExecutable('git')) ?? '';
  test.skip(!git, 'Git is required for this local integration test.');
  dir = await mkdtemp(join(tmpdir(), 'loom-git-e2e-'));
  const seed = join(dir, 'seed');
  const remote = join(dir, 'remote.git');
  root = join(dir, 'author-one');
  partner = join(dir, 'author-two');
  await mkdir(seed);
  await writeFile(
    join(seed, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}Baseline\\end{document}\n',
  );
  await writeFile(join(seed, 'refs.bib'), '@article{local, title={Local}}\n');
  await writeFile(join(seed, '.env'), 'TOKEN=synthetic-only\n');
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'Loom Local Test'],
    ['config', 'user.email', 'loom@example.invalid'],
    ['add', '--', 'main.tex', 'refs.bib', '.env'],
    ['commit', '-qm', 'baseline'],
  ])
    await gitAt(seed, ...args);
  await gitAt(dir, 'init', '--bare', '-q', remote);
  await gitAt(seed, 'remote', 'add', 'origin', remote);
  await gitAt(seed, 'push', '-qu', 'origin', 'HEAD');
  await gitAt(dir, 'clone', '--', remote, root);
  await gitAt(dir, 'clone', '--', remote, partner);
  for (const clone of [root, partner]) {
    await gitAt(clone, 'config', 'user.name', 'Loom Local Test');
    await gitAt(clone, 'config', 'user.email', 'loom@example.invalid');
    await gitAt(clone, 'config', 'branch.autoSetupMerge', 'false');
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  app = await _electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${join(dir, 'data')}`],
    env,
    chromiumSandbox: true,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, root);
  if (testInfo.title.includes('initial project chooser')) return;
  await page.getByRole('button', { name: 'Open or create project', exact: true }).click();
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
});

test.afterEach(async () => {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await app.close();
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('review, selective stage, commit, branch, and export a portable source ZIP in real Electron', async () => {
  await writeFile(
    join(root, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}Revision\\ref{missing}\\end{document}\n',
  );
  await writeFile(join(root, 'new notes.txt'), 'unstaged note\n');
  await page.getByRole('button', { name: 'Git · check status', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Git · repository review', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('main.tex');
  await expect(dialog).toContainText('new notes.txt');
  await expect(dialog.locator('.git-diff')).toContainText('Choose a staged or working tree diff');

  const mainFile = dialog.locator('.git-file').filter({ hasText: 'main.tex' });
  await mainFile.getByRole('button', { name: 'Stage', exact: true }).click();
  await expect(mainFile).toContainText('Staged · M');
  await dialog.getByRole('button', { name: /Review staged commit/ }).click();
  await mainFile.getByRole('button', { name: /Review staged changes/ }).click();
  await expect(dialog.locator('.git-diff')).toContainText('Revision');
  await expect(dialog.locator('.git-commit-review')).toContainText('main.tex · M · reviewed');
  const review = dialog.getByLabel('Commit message', { exact: true });
  await review.fill('reviewed manuscript update');
  await dialog.getByRole('button', { name: 'Commit reviewed changes', exact: true }).click();
  await expect(dialog.getByLabel('Commit message', { exact: true })).toHaveCount(0);
  await expect.poll(() => gitRun('log', '-1', '--format=%s')).toBe('reviewed manuscript update');
  await expect.poll(() => gitRun('status', '--porcelain')).toContain('?? "new notes.txt"');

  const notesFile = dialog.locator('.git-file').filter({ hasText: 'new notes.txt' });
  await notesFile.getByRole('button', { name: 'Stage', exact: true }).click();
  await dialog.getByRole('button', { name: /Review staged commit/ }).click();
  await notesFile.getByRole('button', { name: /Review staged changes/ }).click();
  await expect(dialog.locator('.git-diff')).toContainText('unstaged note');
  await expect(dialog.locator('.git-commit-review')).toContainText('new notes.txt · A · reviewed');
  await expect(dialog.locator('.git-commit-review li')).toHaveCount(1);
  await dialog.getByLabel('Commit message', { exact: true }).fill('reviewed notes');
  const commitButton = dialog.getByRole('button', { name: 'Commit reviewed changes', exact: true });
  await expect(commitButton).toBeEnabled();
  await commitButton.click();
  await expect.poll(() => gitRun('log', '-1', '--format=%s')).toBe('reviewed notes');

  await dialog.getByLabel('New branch', { exact: true }).fill('codex/e2e-review');
  await dialog.getByRole('button', { name: 'Create and switch', exact: true }).click();
  await expect(dialog.locator('.git-toolbar')).toContainText('codex/e2e-review');
  await expect(dialog.getByRole('button', { name: 'Publish branch', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish branch', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Push committed revisions', exact: true }),
  ).toBeEnabled();

  await dialog.getByRole('button', { name: 'Run preflight', exact: true }).click();
  await expect(dialog.getByText('Included files', { exact: true })).toBeVisible();
  await expect(dialog.locator('.git-preflight-warnings')).toContainText('Unresolved labels');
  await expect(dialog.locator('.git-preflight-warnings')).toContainText(
    'Review the included file list for secrets',
  );
  await dialog.getByText('Included files', { exact: true }).click();
  await expect(dialog.locator('.git-publication')).toContainText('main.tex');
  await dialog.getByText('Excluded files', { exact: true }).click();
  await expect(dialog.locator('.git-publication')).toContainText('.env');
  const zip = join(dir, 'paper-source.zip');
  await app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  }, zip);
  await dialog.getByRole('button', { name: 'Export source ZIP', exact: true }).click();
  await expect(dialog.getByText(/Source ZIP exported/)).toBeVisible();
  const entries = unzipSync(await readFile(zip));
  expect(Object.keys(entries).sort()).toEqual(['main.tex', 'new notes.txt', 'refs.bib'].sort());
  expect(entries['.env']).toBeUndefined();
  const exported = join(dir, 'extracted-source');
  await mkdir(exported);
  for (const [path, bytes] of Object.entries(entries)) {
    const destination = join(exported, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const latexmk = await findLatexExecutable('latexmk', { home: homedir() });
  if (latexmk) {
    const compiled = await runTool(
      latexmk,
      [
        '-norc',
        '-pdf',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-no-shell-escape',
        'main.tex',
      ],
      { cwd: exported, timeoutMs: 120_000, env: latexEnvironment({ home: homedir() }) },
    );
    expect(compiled.code, compiled.output).toBe(0);
    expect((await readFile(join(exported, 'main.pdf'))).byteLength).toBeGreaterThan(100);
  }

  await setContentSize(720, 540);
  await page.screenshot({
    path: resolve('artifacts/phase-7-git-publication-small.png'),
    animations: 'disabled',
  });
  await expect
    .poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width: 720, height: 540 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.workspace-statusbar button').last()).toBeFocused();
});

test('two local authors exchange commits, surface a conflict, and publish its explicit resolution', async () => {
  await writeFile(
    join(partner, 'main.tex'),
    '\\documentclass{article}\\begin{document}Exchange one\\end{document}\\n',
  );
  await gitAt(partner, 'add', '--', 'main.tex');
  await gitAt(partner, 'commit', '-m', 'author two update');
  await gitAt(partner, 'push');

  await page.getByRole('button', { name: /^Git ·/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Git · repository review', exact: true });
  await dialog.getByRole('button', { name: 'Fetch', exact: true }).click();
  await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Exchange one');

  await writeFile(
    join(root, 'main.tex'),
    '\\documentclass{article}\\begin{document}Author one revision\\end{document}\\n',
  );
  await gitRun('add', '--', 'main.tex');
  await gitRun('commit', '-m', 'author one revision');
  await writeFile(
    join(partner, 'main.tex'),
    '\\documentclass{article}\\begin{document}Author two revision\\end{document}\\n',
  );
  await gitAt(partner, 'add', '--', 'main.tex');
  await gitAt(partner, 'commit', '-m', 'author two revision');
  await gitAt(partner, 'push');

  await dialog.getByRole('button', { name: 'Fetch', exact: true }).click();
  await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
  await expect(dialog).toContainText('A merge is in progress');
  const conflict = dialog.locator('.git-file').filter({ hasText: 'main.tex' });
  await expect(conflict).toContainText('Staged · U');
  await conflict.getByRole('button', { name: 'Review ours', exact: true }).click();
  await expect(dialog.locator('.git-diff')).toContainText('Author one revision');
  await conflict.getByRole('button', { name: 'Review theirs', exact: true }).click();
  await expect(dialog.locator('.git-diff')).toContainText('Author two revision');
  await conflict.getByRole('button', { name: 'Resolve using theirs', exact: true }).click();
  await expect
    .poll(() => readFile(join(root, 'main.tex'), 'utf8'))
    .toContain('Author two revision');
  await expect(page.locator('.cm-content')).toContainText('Author two revision');

  await dialog.getByRole('button', { name: /Review staged commit/ }).click();
  await conflict.getByRole('button', { name: /Review staged changes/ }).click();
  await dialog.getByLabel('Commit message', { exact: true }).fill('resolve author conflict');
  await dialog.getByRole('button', { name: 'Commit reviewed changes', exact: true }).click();
  await expect.poll(() => gitRun('log', '-1', '--format=%s')).toBe('resolve author conflict');
  await dialog.getByRole('button', { name: 'Push committed revisions', exact: true }).click();
  await gitAt(partner, 'pull', '--ff-only');
  await expect
    .poll(() => readFile(join(partner, 'main.tex'), 'utf8'))
    .toContain('Author two revision');
});

test('clone through the native destination picker and open the completed project', async () => {
  const destinationParent = join(dir, 'clone-destination');
  await mkdir(destinationParent);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, destinationParent);
  await page.getByRole('button', { name: /^Git ·/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Git · repository review', exact: true });
  await dialog
    .getByLabel('Clone an existing repository', { exact: true })
    .fill(pathToFileURL(join(dir, 'remote.git')).href);
  await dialog.getByRole('button', { name: 'Choose location and clone', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('Baseline');
  await expect
    .poll(() => gitAt(join(destinationParent, 'remote'), 'rev-parse', '--is-inside-work-tree'))
    .toBe('true');
  await expect(page.getByRole('button', { name: /^Git ·/ })).toContainText('master');
});

test('clone is available from the initial project chooser before any project is open', async () => {
  const destinationParent = join(dir, 'initial-clone');
  await mkdir(destinationParent);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, destinationParent);
  await page.getByRole('button', { name: 'Open or create project', exact: true }).click();
  const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
  await projects
    .getByLabel('Repository URL to clone', { exact: true })
    .fill(pathToFileURL(join(dir, 'remote.git')).href);
  await projects.getByRole('button', { name: 'Clone repository', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Baseline');
  await expect
    .poll(() => gitAt(join(destinationParent, 'remote'), 'rev-parse', '--is-inside-work-tree'))
    .toBe('true');
  await expect(projects).toBeHidden();
});
