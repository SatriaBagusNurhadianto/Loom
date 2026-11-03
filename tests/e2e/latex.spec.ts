import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
let app: ElectronApplication, page: Page, directory: string, root: string;
async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  app = await _electron.launch({
    ...(process.env.LOOM_E2E_EXECUTABLE ? { executablePath: process.env.LOOM_E2E_EXECUTABLE } : {}),
    args: [
      ...(process.env.LOOM_E2E_EXECUTABLE ? [] : [resolve('out/main/index.js')]),
      `--user-data-dir=${join(directory, 'data')}`,
    ],
    env,
    chromiumSandbox: true,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const result = await window.loom!.getStatus();
        return result.ok && result.value.state;
      }),
    )
    .toBe('ready');
}
async function openExample(name = 'multi-file') {
  root = join(directory, name + ' 论文');
  await cp(resolve(`examples/phase-3/${name}`), root, { recursive: true });
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, root);
  await page.getByRole('button', { name: 'Open or create project', exact: true }).click();
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Projects', exact: true })
    .getByRole('button', { name: 'Close dialog' })
    .click();
}
async function waitPdf() {
  await expect(page.locator('.build-status')).toHaveText('Compiled', { timeout: 25000 });
  await expect
    .poll(() =>
      page.locator('.pdf-sheet canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width),
    )
    .toBeGreaterThan(0);
  await expect(page.locator('.pdf-load-status')).toContainText('Select text', { timeout: 15000 });
  await expect(page.locator('.textLayer span').first()).toBeAttached();
}
async function dimensions(width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      const [ow, oh] = window.getSize(),
        [cw, ch] = window.getContentSize();
      window.setMaximumSize(0, 0);
      window.setMinimumSize(size.width + ow - cw, size.height + oh - ch);
      window.setMaximumSize(size.width + ow - cw, size.height + oh - ch);
      window.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'loom-latex-e2e-'));
  await launch();
});
test.afterEach(async () => {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
      })
      .catch(() => {});
    await app.close();
  }
  await rm(directory, { recursive: true, force: true });
});

test('missing-tool build setup remains honest and source stays editable', async () => {
  test.skip(
    process.env.LOOM_TEST_TEX === '1',
    'This case exercises the machine without the optional live toolchain.',
  );
  await dimensions(1440, 960);
  await app.evaluate(() => {
    process.env.PATH = '/loom-acceptance-empty-tool-path';
  });
  await page.evaluate(() => window.loom!.restartService());
  await openExample();
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.locator('.build-status')).toHaveText('Build failed');
  await page.locator('.build-status').click();
  const modal = page.getByRole('dialog', { name: 'Build and LaTeX' });
  await expect(modal).toBeVisible();
  await modal.getByText('Raw build log', { exact: true }).click();
  await expect(modal.locator('pre').filter({ hasText: 'Missing tools:' })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'TeX installation guide' })).toBeVisible();
  await modal.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('.cm-content').press('Control+End');
  await page.locator('.cm-content').pressSequentially('% still editable');
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('% still editable');
});

test.describe('live Phase 3 Electron workflow', () => {
  test.skip(
    process.env.LOOM_TEST_TEX !== '1',
    'Requires the explicit authorized local TeX/TexLab setup.',
  );
  test('renders a real PDF with text, pages, zoom, snapshot mapping and native export', async () => {
    await dimensions(1600, 1000);
    await openExample();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: 'Compile', exact: true }).click();
    await waitPdf();
    expect(await page.locator('.pdf-sheet canvas').count()).toBe(1);
    await page.getByRole('button', { name: 'Next PDF page' }).click();
    await expect(page.getByRole('spinbutton', { name: 'PDF page number' })).toHaveValue('2');
    await expect(page.locator('.pdf-load-status')).toContainText('Select text');
    await expect(page.locator('.textLayer')).toContainText('Results');
    await page.getByRole('combobox', { name: 'PDF zoom' }).selectOption('1.5');
    await expect(page.locator('.pdf-load-status')).toContainText('Select text');
    // PDF.js text selection is native DOM selection, not a screenshot of a paper.
    const selected = await page.locator('.textLayer').evaluate((layer) => {
      const range = document.createRange();
      range.selectNodeContents(layer);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
    expect(selected).toContain('Results');
    await page.getByRole('combobox', { name: 'PDF zoom' }).selectOption('1');
    await page.getByRole('spinbutton', { name: 'PDF page number' }).fill('1');
    await page.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
    await expect(page.locator('.pdf-load-status')).toContainText('Select text');
    // The mapped passage comes from a real text-layer glyph position.
    const passage = page
      .locator('.textLayer span')
      .filter({ hasText: 'synthetic manuscript' })
      .first();
    await expect(passage).toBeVisible();
    await passage.dblclick();
    await expect(page.locator('.document-tabs button[aria-pressed="true"]')).toContainText(
      'introduction.tex',
    );
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Show in PDF', exact: true }).click();
    await expect(page.locator('.pdf-source-marker')).toBeAttached();
    const destination = join(directory, 'export.pdf');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, destination);
    await page.getByRole('button', { name: 'Export compiled PDF' }).click();
    await expect
      .poll(() =>
        readFile(destination)
          .then((bytes) => bytes.subarray(0, 5).toString())
          .catch(() => ''),
      )
      .toBe('%PDF-');
    await page.screenshot({ path: 'artifacts/phase-3-workspace.png' });
    expect(errors).toEqual([]);
  });
  test('retains last successful PDF after failure, marks unsaved/external inputs stale and restores after restart', async () => {
    await dimensions(1440, 960);
    await openExample();
    await page.getByRole('button', { name: 'Compile', exact: true }).click();
    await waitPdf();
    await page.getByRole('button', { name: 'Next PDF page' }).click();
    await expect(page.getByRole('spinbutton', { name: 'PDF page number' })).toHaveValue('2');
    const content = page.locator('.cm-content');
    await content.press('Control+Home');
    await content.pressSequentially('\\LoomUndefinedCommand');
    await content.press('Enter');
    await expect(page.locator('.build-status')).toHaveText('PDF out of date');
    await expect(page.getByRole('button', { name: 'Show source', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Compile', exact: true }).click();
    await expect(page.locator('.build-status')).toHaveText('Build failed');
    await expect(page.locator('.pdf-sheet canvas')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'PDF page number' })).toHaveValue('2');
    await page.locator('.build-status').click();
    const modal = page.getByRole('dialog', { name: 'Build and LaTeX' });
    await modal.getByText('Raw build log', { exact: true }).click();
    await expect(
      modal.locator('pre').filter({ hasText: 'Undefined control sequence' }),
    ).toBeVisible();
    await modal.getByRole('button', { name: 'Close dialog' }).click();
    await page.evaluate(() => window.loom!.restartService());
    await expect(page.locator('.pdf-sheet canvas')).toBeVisible();
    await expect(page.locator('.build-status')).toHaveText('Build failed');
    await page.screenshot({ path: 'artifacts/phase-3-failed-build.png' });
  });
  test('TexLab completion, definition, diagnostics and project structure work through the live editor', async () => {
    await dimensions(1440, 960);
    await openExample();
    await page
      .locator('.project-panel')
      .getByRole('button', { name: 'sections/introduction.tex', exact: true })
      .click();
    const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.pressSequentially('\\ref{sec:i');
    await editor.press('Control+Space');
    const option = page.getByRole('option').filter({ hasText: 'sec:introduction' }).first();
    await expect(option).toBeVisible();
    await option.click();
    await editor.pressSequentially('}');
    await expect
      .poll(() => readFile(join(root, 'sections/introduction.tex'), 'utf8'))
      .toContain('\\ref{sec:introduction}');
    await editor.press('ArrowLeft');
    await editor.press('F12');
    await expect(page.locator('.cm-activeLine')).toContainText('Introduction');
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.pressSequentially('\\begin{unclosed');
    await expect(
      page.locator('.cm-lintRange-error, .cm-lintPoint-error, .cm-lint-marker-error').first(),
    ).toBeAttached({ timeout: 15000 });
    await page.getByText('Project structure', { exact: true }).click();
    await page
      .locator('.project-structure')
      .getByRole('button')
      .filter({ hasText: 'sec:results' })
      .click();
    await expect(page.locator('.document-tabs button[aria-pressed="true"]')).toContainText(
      'results.tex',
    );
  });
  test('portable settings retain edits during polling, auto-build coalesces and narrow keyboard navigation works', async () => {
    await dimensions(1440, 960);
    await openExample();
    await page.locator('.build-status').click();
    const modal = page.getByRole('dialog', { name: 'Build and LaTeX' });
    await modal.getByLabel('TeX engine', { exact: true }).selectOption('xelatex');
    await page.waitForTimeout(1500);
    await expect(modal.getByLabel('TeX engine', { exact: true })).toHaveValue('xelatex');
    await modal.getByLabel('Compile after editing settles').check();
    await modal.getByRole('button', { name: 'Save build settings', exact: true }).click();
    await expect(modal.getByText('Settings saved', { exact: true })).toBeVisible();
    expect(JSON.parse(await readFile(join(root, 'loom.build.json'), 'utf8')).settings.engine).toBe(
      'xelatex',
    );
    await modal.getByRole('button', { name: 'Close dialog' }).click();
    await waitPdf();
    await page.locator('.cm-content').press('Control+End');
    await page.locator('.cm-content').pressSequentially('\n% automatic build boundary');
    await expect(page.locator('.build-status')).toHaveText('PDF out of date');
    await waitPdf();
    await dimensions(900, 700);
    await page.getByRole('button', { name: 'Show PDF preview', exact: true }).click();
    await expect(page.locator('.pdf-viewer')).toBeVisible();
    await expect(page.locator('.source-column')).not.toBeVisible();
    await page.getByRole('combobox', { name: 'PDF zoom' }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.pdf-load-status')).toContainText('Select text');
    await page.screenshot({ path: 'artifacts/phase-3-small.png' });
    await page.getByRole('button', { name: 'Hide PDF panel', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Build and LaTeX', exact: true }).click();
    await expect(modal).toBeVisible();
  });
});
