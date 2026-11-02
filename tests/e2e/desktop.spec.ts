import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'loom-desktop-e2e-'));
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
  if (desktop) await desktop.close();
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
    api: ['getStatus', 'onServiceEvent', 'restartService'],
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
