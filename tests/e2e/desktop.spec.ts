import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

let desktop: ElectronApplication;
let page: Page;
let userData: string;
let stoppedPid: number | undefined;

async function dimensions(width: number, height: number): Promise<void> {
  await desktop.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await expect
    .poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width, height });
}

async function readyPid(): Promise<number> {
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const result = await window.loom!.getStatus();
        return result.ok ? result.value.state : result.error.code;
      }),
    )
    .toBe('ready');
  const result = await page.evaluate(() => window.loom!.getStatus());
  if (!result.ok || !result.value.pid)
    throw new Error('The real utility process did not provide a PID.');
  return result.value.pid;
}

async function launchDesktop(): Promise<void> {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  desktop = await _electron.launch({
    chromiumSandbox: true,
    args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
    env,
    timeout: 20_000,
  });
  page = await desktop.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await readyPid();
}
test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'loom-desktop-e2e-'));
  await launchDesktop();
});

test.afterEach(async () => {
  if (stoppedPid) {
    try {
      process.kill(stoppedPid, 'SIGKILL');
    } catch {
      /* The timeout may have terminated it already. */
    }
    stoppedPid = undefined;
  }
  if (desktop) {
    if (test.info().status !== test.info().expectedStatus)
      await desktop
        .evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows()) win.destroy();
        })
        .catch(() => {});
    await desktop.close();
  }
  if (userData) await rm(userData, { recursive: true, force: true });
});

test('real isolated Electron boundary and a restartable utility process', async () => {
  const isolation = await desktop.evaluate(({ BrowserWindow }) => {
    // Electron 45 retains this diagnostic method at runtime but omits its TS declaration.
    const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as {
      getLastWebPreferences(): {
        sandbox: boolean;
        contextIsolation: boolean;
        nodeIntegration: boolean;
      };
    };
    const preferences = contents.getLastWebPreferences();
    return {
      sandbox: preferences.sandbox,
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration,
    };
  });
  expect(isolation).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  expect(
    await page.evaluate(() => ({
      api: Object.keys(window.loom!).sort(),
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    })),
  ).toEqual({
    api: [
      'chooseProject',
      'completeClose',
      'getStatus',
      'onCloseRequest',
      'onServiceEvent',
      'project',
      'restartService',
    ],
    require: 'undefined',
    process: 'undefined',
  });

  const before = await readyPid();
  await page.getByRole('button', { name: 'Service ready', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Electron desktop');
  await expect(page.getByRole('dialog')).toContainText(String(before));
  await page.getByRole('button', { name: 'Restart service', exact: true }).click();
  await expect.poll(() => readyPid()).not.toBe(before);
  await expect(page.getByRole('dialog').locator('.service-details dd').first()).toHaveText('ready');
  await page.keyboard.press('Escape');

  const originalUrl = page.url();
  await page.evaluate(() => {
    window.open('https://example.com');
  });
  expect(desktop.windows()).toHaveLength(1);
  await page.evaluate(() => {
    window.location.href = 'https://example.com';
  });
  // Electron cancels navigation before commit; CDP can retain a pending loader.
  // Inspect the live document URL and native WebContents instead of waiting for it.
  expect(await page.evaluate(() => location.href)).toBe(originalUrl);
  expect(
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getURL(),
    ),
  ).toBe(originalUrl);
  expect(
    await page.evaluate(() => {
      const heading = document.querySelector('main h2');
      return { text: heading?.textContent, visible: Boolean(heading?.getClientRects().length) };
    }),
  ).toEqual({ text: 'A place for your next paper', visible: true });
  await readyPid();
});

test('a killed utility process reports failure and recovers without losing the workspace', async () => {
  const pid = await readyPid();
  await page.getByRole('button', { name: 'View workspace example', exact: true }).last().click();
  process.kill(pid, 'SIGKILL');
  await expect(
    page.getByRole('button', { name: 'Service unavailable', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Read-only LaTeX example' })).toBeVisible();
  await page.getByRole('button', { name: 'Service unavailable', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('stopped');
  await page.getByRole('button', { name: 'Restart service', exact: true }).click();
  const recoveredPid = await readyPid();
  expect(recoveredPid).not.toBe(pid);
  await expect(page.getByRole('dialog').locator('.service-details dd').first()).toHaveText('ready');
});

test('an unresponsive utility process times out and can be restarted', async () => {
  test.skip(process.platform !== 'linux', 'SIGSTOP failure injection is validated on Linux.');
  stoppedPid = await readyPid();
  await page.getByRole('button', { name: 'Service ready', exact: true }).click();
  process.kill(stoppedPid, 'SIGSTOP');
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('did not respond', { timeout: 9_000 });
  await expect(page.getByRole('dialog').locator('.service-details dd').first()).toHaveText(
    'unavailable',
  );
  await page.getByRole('button', { name: 'Restart service', exact: true }).click();
  expect(await readyPid()).not.toBe(stoppedPid);
});

test('keyboard layout, saved preferences, focus modes, and reference screenshots', async () => {
  await dimensions(2048, 1096);
  await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'PDF preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View workspace example', exact: true }).last().click();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await mkdir(resolve('artifacts'), { recursive: true });
  await page.screenshot({
    path: resolve('artifacts/phase-1-electron-reference.png'),
    scale: 'css',
  });

  const divider = page.getByRole('separator', { name: 'Sidebar width' });
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '31');
  await page.reload();
  await expect(divider).toHaveAttribute('aria-valuenow', '31');
  await divider.focus();
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '30');
  await page.keyboard.press('Control+Alt+b');
  await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore sidebar', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toBeVisible();

  await page.getByRole('main', { name: 'Source workspace' }).focus();
  await page.keyboard.press('F6');
  await expect(page.getByRole('region', { name: 'PDF preview', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+F6');
  await expect(page.getByRole('main', { name: 'Source workspace' })).toBeFocused();
  await page.keyboard.press('Control+Alt+2');
  await expect(page.getByRole('main', { name: 'Source workspace' })).toHaveCount(0);
  const skipLink = page.getByRole('link', { name: 'Skip to source' });
  await skipLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main', { name: 'Source workspace' })).toBeFocused();
  await page.keyboard.press('Control+Alt+3');
  await expect(page.getByRole('main', { name: 'Source workspace' })).toBeVisible();

  await dimensions(900, 700);
  await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'PDF preview', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'View workspace example', exact: true }).last().click();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.screenshot({
    path: resolve('artifacts/phase-1-electron-small-source.png'),
    scale: 'css',
  });
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page.getByRole('region', { name: 'PDF preview', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Source workspace' })).toHaveCount(0);
  await page.screenshot({
    path: resolve('artifacts/phase-1-electron-small-pdf.png'),
    scale: 'css',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The keyboard skip link must also restore source when the narrow PDF view unmounts it.
  await skipLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main', { name: 'Source workspace' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Read-only LaTeX example' })).toBeVisible();
});

async function openSyntheticProject(): Promise<string> {
  await dimensions(1440, 960);
  const folder = join(userData, 'synthetic-project');
  await mkdir(folder);
  await writeFile(
    join(folder, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nOriginal text.\n\\end{document}\n',
  );
  await writeFile(join(folder, 'references.bib'), '@article{test, title={Synthetic}}\n');
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, folder);
  await page.getByRole('button', { name: 'Open or create project', exact: true }).click();
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Root: main.tex');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'LaTeX source editor' })).toContainText(
    'Original text.',
  );
  return folder;
}
test('real project editing, external reconciliation, restart, IndexedDB, tabs and small window', async () => {
  const folder = await openSyntheticProject();
  const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('% Human addition');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(join(folder, 'main.tex'), 'utf8')).toContain('% Human addition');
  await expect(page.locator('.readonly-label')).toHaveText('Saved to disk');
  await dimensions(1440, 960);
  await page.keyboard.press('Control+Alt+3');
  await page.getByRole('button', { name: 'references.bib', exact: true }).click();
  await expect(editor).toContainText('@article');
  await page.getByRole('button', { name: 'main.tex', exact: true }).last().click();
  await expect(editor).toContainText('% Human addition');
  const text = await readFile(join(folder, 'main.tex'), 'utf8');
  await writeFile(join(folder, 'main.tex'), text.replace('Original text.', 'External text.'));
  await expect(editor).toContainText('External text.');
  await expect(editor).toContainText('% Human addition');
  await editor.focus();
  await page.keyboard.press('Control+z');
  await expect(editor).toContainText('External text.');
  await expect(editor).not.toContainText('% Human addition');
  await editor.focus();
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toContainText('% Human addition');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.readonly-label')).toHaveText('Saved to disk');
  await page.reload();
  await expect(editor).toContainText('% Human addition');
  await expect(editor).toContainText('External text.');
  await page.evaluate(() => window.loom!.restartService());
  await expect(editor).toContainText('% Human addition');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' after restart');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(join(folder, 'main.tex'), 'utf8')).toContain('after restart');
  await mkdir(resolve('artifacts'), { recursive: true });
  await dimensions(2048, 1096);
  await page.screenshot({ path: resolve('artifacts/phase-2-electron-reference.png') });
  await dimensions(900, 700);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('references.bib');
  await page.screenshot({ path: resolve('artifacts/phase-2-electron-small.png') });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('unsent local edits and external overlaps remain reviewable', async () => {
  const folder = await openSyntheticProject();
  const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Human replacement');
  await writeFile(join(folder, 'main.tex'), 'External replacement');
  await expect(page.getByRole('region', { name: 'File conflict' })).toBeVisible();
  await expect(editor).toContainText('Human replacement');
  expect(await readFile(join(folder, 'main.tex'), 'utf8')).toBe('External replacement');
  await page.reload();
  await expect(page.getByRole('region', { name: 'File conflict' })).toBeVisible();
  await expect(editor).toContainText('Human replacement');
  await page.getByRole('button', { name: 'Keep local text' }).click();
  await expect.poll(() => readFile(join(folder, 'main.tex'), 'utf8')).toBe('Human replacement');
});

test('file operations, root choice, search locations, find/replace and caret restoration', async () => {
  const folder = await openSyntheticProject(),
    editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
  await editor.focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await dimensions(1440, 960);
  await page.keyboard.press('Control+Alt+3');
  await page.getByRole('button', { name: 'references.bib', exact: true }).click();
  await page.getByRole('button', { name: 'main.tex', exact: true }).last().click();
  await editor.focus();
  expect(await page.evaluate(() => getSelection()?.anchorOffset)).toBe(3);
  await page.getByRole('button', { name: 'Find / replace', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find', exact: true }).fill('Original');
  await page.getByRole('textbox', { name: 'Replace', exact: true }).fill('Updated');
  await page.getByRole('button', { name: 'replace all', exact: true }).click();
  await expect(editor).toContainText('Updated text.');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await editor.focus();
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(join(folder, 'main.tex'), 'utf8')).toContain('Updated text.');
  const query = page.getByRole('textbox', { name: 'Search project text' });
  await query.fill('Updated text.');
  const hit = page.getByRole('button', { name: /main.tex:4/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await page.getByRole('button', { name: 'Clear project search' }).click();
  await expect(query).toBeFocused();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project-relative path' }).fill('章节/结果.tex');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: '章节/结果.tex', exact: true }).click();
  await page.getByRole('button', { name: /Use 章节\/结果.tex as root/ }).click();
  await page.getByRole('button', { name: 'Rename / move', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project-relative path' }).fill('sections/results.tex');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'sections/results.tex', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Project sidebar' })
    .getByText('Recover deleted files', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Restore sections/results.tex' }).click();
  await expect
    .poll(async () => {
      try {
        return await readFile(join(folder, 'sections/results.tex'), 'utf8');
      } catch {
        return null;
      }
    })
    .toBe('');
});

test('IndexedDB-only edits survive renderer crash with disk divergence', async () => {
  const folder = await openSyntheticProject();
  const original = await readFile(join(folder, 'main.tex'), 'utf8');
  const pid = await readyPid();
  process.kill(pid, 'SIGSTOP');
  stoppedPid = pid;
  const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Recovered human text');
  // A readonly transaction queues after y-indexeddb writes and proves they committed.
  await page.evaluate(async () => {
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith('loom:')) continue;
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(info.name!);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('updates', 'readonly');
          tx.objectStore('updates').getAll();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    }
  });
  expect(await readFile(join(folder, 'main.tex'), 'utf8')).toBe(original);
  await writeFile(join(folder, 'main.tex'), 'External while stopped');
  process.kill(pid, 'SIGKILL');
  stoppedPid = undefined;
  const recoveredWindow = desktop.waitForEvent('window');
  await desktop.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    process.kill(contents.getOSProcessId(), 'SIGKILL');
  });
  page = await recoveredWindow;
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('region', { name: 'File conflict' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('textbox', { name: 'LaTeX source editor' })).toContainText(
    'Recovered human text',
  );
  await page.getByRole('button', { name: 'Keep local text' }).click();
  await expect.poll(() => readFile(join(folder, 'main.tex'), 'utf8')).toBe('Recovered human text');
});

test('native project creation and ZIP import preserve ordinary source and assets', async () => {
  const created = join(userData, 'created-project');
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, created);
  await page.getByRole('button', { name: 'Open or create project', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Root: main.tex');
  await page.keyboard.press('Escape');
  expect(await readFile(join(created, 'main.tex'), 'utf8')).toContain('\\documentclass{article}');
  const { zipSync, strToU8 } = await import('fflate');
  const archive = join(userData, 'source.zip'),
    destination = join(userData, 'imported-project');
  await writeFile(
    archive,
    zipSync({
      'paper.tex': strToU8('\\documentclass{article}\n\\begin{document}Imported\\end{document}'),
      'figures/pixel.bin': new Uint8Array([0, 255, 4]),
    }),
  );
  await desktop.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.archive] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.destination });
    },
    { archive, destination },
  );
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Import ZIP', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Root: paper.tex');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'LaTeX source editor' })).toContainText(
    'Imported',
  );
  expect(await readFile(join(destination, 'figures/pixel.bin'))).toEqual(Buffer.from([0, 255, 4]));
});

test('native close flushes pending text and working state before a full app reopen', async () => {
  const folder = await openSyntheticProject();
  const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
  await editor.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('% close must flush');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await desktop.close();
  expect(await readFile(join(folder, 'main.tex'), 'utf8')).toContain('% close must flush');
  await launchDesktop();
  const restored = page.getByRole('textbox', { name: 'LaTeX source editor' });
  await expect(restored).toContainText('% close must flush');
  await restored.focus();
  expect(await page.evaluate(() => getSelection()?.anchorOffset)).toBe(3);
});

test('failed working-state persistence keeps the native window open', async () => {
  await openSyntheticProject();
  const snapshot = await page.evaluate(() => window.loom!.project({ type: 'current' }));
  if (!snapshot.ok) throw new Error('Project did not load.');
  // Inject only the persistence result at main IPC; this is a simulated failure, not disk exhaustion.
  await desktop.evaluate(({ ipcMain }, snapshot) => {
    ipcMain.removeHandler('loom:project:command');
    ipcMain.handle('loom:project:command', (_event, command) =>
      command.type === 'preferences'
        ? {
            ok: false,
            error: {
              code: 'PROJECT_ERROR',
              message: 'Simulated preferences write failure',
              retryable: true,
            },
          }
        : snapshot,
    );
  }, snapshot);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByRole('alert')).toContainText('Simulated preferences write failure');
  expect(desktop.windows()).toHaveLength(1);
  await desktop.evaluate(({ ipcMain }, snapshot) => {
    ipcMain.removeHandler('loom:project:command');
    ipcMain.handle('loom:project:command', () => snapshot);
  }, snapshot);
});
