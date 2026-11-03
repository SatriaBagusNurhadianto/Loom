import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
let app: ElectronApplication,
  page: Page,
  directory: string,
  root: string,
  server: Server,
  endpoint: string;
const source = '\\documentclass{article}\n\\begin{document}\nOriginal sentence.\n\\end{document}\n';
let sessions: Record<
  string,
  {
    id: string;
    time: { created: number; updated: number; idle?: number };
    outcome?: string;
    messages: unknown[];
    permissions: unknown[];
    forms: unknown[];
    active: boolean;
  }
>;
let modelsAvailable = true;
let requests: string[], streams: ServerResponse[], pendingTimers: ReturnType<typeof setTimeout>[];
async function dimensions(width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setMaximumSize(0, 0);
      const [ow, oh] = w.getSize(),
        [cw, ch] = w.getContentSize();
      w.setMinimumSize(size.width + ow - cw, size.height + oh - ch);
      w.setMaximumSize(size.width + ow - cw, size.height + oh - ch);
      w.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await expect
    .poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width, height });
}
function later(action: () => void, ms: number) {
  pendingTimers.push(setTimeout(action, ms));
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'loom-agent-e2e-'));
  root = join(directory, 'paper');
  await mkdir(root);
  await writeFile(join(root, 'main.tex'), source);
  await writeFile(join(root, 'references.bib'), '@article{synthetic,title={Synthetic study}}\n');
  sessions = {};
  modelsAvailable = true;
  requests = [];
  streams = [];
  pendingTimers = [];
  server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://127.0.0.1').pathname;
    requests.push(`${req.method} ${path}`);
    if (
      req.headers.authorization !==
      'Basic ' + Buffer.from('opencode:fixture-password').toString('base64')
    ) {
      res.writeHead(401).end();
      return;
    }
    if (path === '/api/event') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ type: 'server.connected', data: {} }) + '\n\n');
      streams.push(res);
      return;
    }
    let body: Record<string, unknown> = {};
    if (req.method !== 'GET') {
      let text = '';
      for await (const bytes of req) text += bytes.toString();
      body = text ? JSON.parse(text) : {};
    }
    let value: unknown = {};
    const ids = path.split('/'),
      id = ids[3],
      s = sessions[id];
    if (path === '/api/info') value = { version: '2.2.1' };
    else if (path === '/api/model')
      value = {
        data: modelsAvailable
          ? [
              {
                id: 'fixture',
                providerID: 'synthetic',
                name: 'Synthetic research model',
                enabled: true,
                type: 'chat',
                capabilities: { tools: true, input: ['text'] },
              },
            ]
          : [],
      };
    else if (path === '/api/session/active')
      value = {
        data: Object.fromEntries(
          Object.values(sessions)
            .filter((s) => s.active)
            .map((s) => [s.id, { sessionID: s.id }]),
        ),
      };
    else if (path === '/api/session' && req.method === 'POST') {
      const id = 'session-' + Object.keys(sessions).length;
      const now = Date.now();
      sessions[id] = {
        id,
        time: { created: now, updated: now },
        messages: [],
        permissions: [],
        forms: [],
        active: false,
      };
      value = { data: { id, location: { directory: root } } };
    } else if (s) {
      const native = () => ({
        id: s.id,
        location: { directory: root },
        time: s.time,
        outcome: s.outcome,
      });
      if (ids.length === 4) value = { data: native() };
      else if (path.endsWith('/message')) value = { data: [...s.messages].reverse() };
      else if (path.endsWith('/permission')) value = { data: s.permissions };
      else if (path.endsWith('/form')) value = { data: s.forms };
      else if (path.endsWith('/prompt')) {
        s.active = true;
        delete s.time.idle;
        delete s.outcome;
        s.messages.push({
          id: 'user-' + s.messages.length,
          type: 'user',
          text: body.text,
          metadata: body.metadata,
        });
        if (String(body.text).includes('partial operation')) {
          await writeFile(
            join(root, 'main.tex'),
            source.replace('Original sentence.', 'Partial agent sentence.'),
          );
          await writeFile(join(root, 'second.tex'), 'Partial second file.');
          s.messages.push({
            id: 'partial',
            type: 'assistant',
            content: [{ type: 'text', text: 'First file updated; continuing…' }],
          });
        } else {
          s.permissions = [{ id: 'permission-1', action: 'edit', resources: ['main.tex'] }];
        }
        value = { data: { id: 'input' } };
      } else if (path.endsWith('/permission/permission-1/reply')) {
        s.permissions = [];
        if (body.decision === 'once')
          s.forms = [
            {
              id: 'question-1',
              title: 'Which audience should this sentence address?',
              fields: [{ key: 'audience', title: 'Audience', type: 'string', required: true }],
            },
          ];
        else {
          s.active = false;
          s.outcome = 'failed';
          s.time.idle = Date.now();
        }
        value = {};
      } else if (path.endsWith('/form/question-1/reply')) {
        s.forms = [];
        s.messages.push({
          id: 'assistant-1',
          type: 'assistant',
          content: [{ type: 'text', text: 'Inspecting the source…' }],
        });
        later(() => {
          void (async () => {
            await writeFile(
              join(root, 'main.tex'),
              source.replace('Original sentence.', 'Agent revision for researchers.'),
            );
            s.messages.push({
              id: 'assistant-2',
              type: 'assistant',
              content: [
                { type: 'tool', id: 'edit', name: 'edit', state: { status: 'completed' } },
                { type: 'text', text: 'Updated main.tex for your selected audience.' },
              ],
            });
            s.active = false;
            s.outcome = 'succeeded';
            s.time.idle = Date.now();
            s.messages.push({ id: 'idle-' + Date.now(), type: 'idle', outcome: 'succeeded' });
          })();
        }, 500);
        value = {};
      } else if (path.endsWith('/interrupt')) {
        s.active = false;
        s.outcome = 'interrupted';
        s.permissions = [];
        s.forms = [];
        s.time.idle = Date.now();
        s.messages.push({ id: 'cancel-' + Date.now(), type: 'idle', outcome: 'interrupted' });
        value = {};
      }
    } else {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address');
  endpoint = `http://127.0.0.1:${address.port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  app = await _electron.launch({
    chromiumSandbox: true,
    ...(process.env.LOOM_AGENT_PACKAGED === '1'
      ? { executablePath: resolve('release/linux-unpacked/loom') }
      : {}),
    args: [
      ...(process.env.LOOM_AGENT_PACKAGED === '1' ? [] : [resolve('out/main/index.js')]),
      `--user-data-dir=${join(directory, 'data')}`,
    ],
    env,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dimensions(1440, 900);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, root);
  await page.getByRole('button', { name: 'Open or create project', exact: true }).click();
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
});
test.afterEach(async () => {
  pendingTimers.forEach(clearTimeout);
  streams.forEach((s) => s.end());
  if (app) {
    // Conflict fixtures intentionally refuse ordinary close; force test-owned windows down.
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
      .catch(() => {});
    await app.close();
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
async function connect(requireModel = true) {
  await page.locator('.agent-harness-button').click();
  const dialog = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await expect(dialog).toBeVisible();
  if (await dialog.getByText('Connected to this paper', { exact: true }).isVisible()) {
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    return;
  }
  if (!(await dialog.locator('details').evaluate((el) => (el as HTMLDetailsElement).open)))
    await dialog.getByText('Connection details', { exact: true }).click();
  await dialog.getByLabel('Use an existing local OpenCode server').check();
  await dialog.getByLabel('Server address').fill(endpoint);
  await dialog.getByLabel('Server password', { exact: true }).fill('fixture-password');
  await dialog.getByRole('button', { name: 'Connect OpenCode', exact: true }).click();
  await expect(dialog.getByText('Connected to this paper', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  if (requireModel) await expect(page.getByRole('combobox', { name: 'Agent model' })).toBeVisible();
}
test('real Electron agent flow: context, permissions, retained questions, streaming, safe review and newer writing', async () => {
  await connect();
  await page.getByRole('button', { name: 'Attach text or project files' }).click();
  const attach = page.getByRole('dialog', { name: 'Attach context' });
  await attach.getByLabel('Project text file').selectOption('main.tex');
  await attach.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove attached file main.tex' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Revise the sentence for researchers.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await expect(page.getByText('Permission needed: edit', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  const audience = page.getByLabel('Audience', { exact: true });
  await audience.fill('Researchers outside physics');
  await page.waitForTimeout(1700);
  await expect(audience).toHaveValue('Researchers outside physics');
  await expect(audience).toBeFocused();
  await page.screenshot({
    path: resolve('artifacts/phase-4-question.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(
    page.getByText('Updated main.tex for your selected audience.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to agent', exact: true })).toBeVisible();
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('Agent revision');
  // A later compatible author edit must survive revert of the observed request.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('% New author note.\n');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('New author note');
  await page.getByRole('button', { name: 'Review 1 change', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review file changes' });
  await review.locator('summary').filter({ hasText: 'main.tex' }).click();
  await expect(review.locator('.agent-diff')).toContainText('Original sentence.');
  await page.screenshot({ path: resolve('artifacts/phase-4-review.png'), animations: 'disabled' });
  await review.getByRole('button', { name: 'Revert change…', exact: true }).click();
  await review.getByRole('button', { name: 'Revert this file', exact: true }).click();
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('Original sentence.');
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('New author note');
  await expect(review.locator('summary')).toContainText('reverted');
  await review.getByRole('button', { name: 'Close dialog' }).click();
  expect(requests.some((p) => p.includes('/mcp/'))).toBe(false);
  await page.screenshot({
    path: resolve('artifacts/phase-4-conversation.png'),
    animations: 'disabled',
  });
});
test('partial cancellation, retained draft and project chat continuation after renderer reload', async () => {
  await connect();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Perform a partial operation.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await expect(page.getByText('First file updated; continuing…', { exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Keep this next draft across reconnect.');
  await page.getByRole('button', { name: 'Stop agent request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send to agent', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review 2 changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review file changes' })).toContainText(
    'cancelled request',
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toHaveValue(
    'Keep this next draft across reconnect.',
  );
  await connect();
  if (!(await page.locator('.agent-conversation').isVisible()))
    await page.getByRole('button', { name: 'Show conversation', exact: true }).click();
  await expect(page.getByText('First file updated; continuing…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(page.getByRole('button', { name: /Perform a partial operation/ })).toBeVisible();
});
test('provider settings, source and composer remain usable at 720 by 540 with keyboard access', async () => {
  await connect();
  await dimensions(720, 540);
  await page.getByRole('button', { name: 'OpenCode', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Codex/ }).click();
  await expect(dialog.getByRole('button', { name: 'Connect Codex', exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/phase-4-small-providers.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  const models = page.getByRole('combobox', { name: 'Agent model' });
  await models.focus();
  await models.press('Alt+ArrowDown');
  await models.press('ArrowDown');
  await models.press('Enter');
  await expect(models).toHaveValue('synthetic:fixture');
  await page.getByRole('textbox', { name: 'Ask about your paper' }).focus();
  await page.keyboard.type('A question at a smaller window.');
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toHaveValue(
    'A question at a smaller window.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const composer = await page.locator('.agent-composer').boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(540);
  await page.screenshot({
    path: resolve('artifacts/phase-4-small-workspace.png'),
    animations: 'disabled',
  });
});

test('utility interruption preserves partial external writes and reconnects before another request', async () => {
  await connect();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Perform a partial operation.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await expect(page.getByText('First file updated; continuing…', { exact: true })).toBeVisible();
  const status = await page.evaluate(() => window.loom!.getStatus());
  if (!status.ok || !status.value.pid) throw new Error('Missing utility process.');
  process.kill(status.value.pid, 'SIGKILL');
  await expect(
    page.getByRole('button', { name: 'Local service unavailable', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Local service unavailable', exact: true }).click();
  const service = page.getByRole('dialog', { name: 'Desktop service', exact: true });
  await service.getByRole('button', { name: 'Restart service', exact: true }).click();
  await service.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Local service ready', exact: true }),
  ).toBeVisible();
  await connect();
  if (!(await page.locator('.agent-conversation').isVisible()))
    await page.getByRole('button', { name: 'Show conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Review 2 changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review file changes' })).toContainText(
    'interrupted request',
  );
  expect(Object.values(sessions)[0].active).toBe(false);
});
test('overlapping author and native writes preserve both versions in a conflict', async () => {
  await connect();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Perform a partial operation.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await expect(page.getByText('First file updated; continuing…', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('Partial agent sentence.');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(source.replace('Original sentence.', 'Newer author sentence.'));
  await writeFile(
    join(root, 'main.tex'),
    source.replace('Original sentence.', 'Overlapping native sentence.'),
  );
  await expect(page.getByText('External changes need review', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('Newer author sentence.');
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('Overlapping native sentence.');
  await page.getByRole('button', { name: 'Stop agent request', exact: true }).click();
  await page.screenshot({ path: resolve('artifacts/phase-4-overlap.png'), animations: 'disabled' });
});

test('a connected agent with no models explains setup and preserves the prompt', async () => {
  modelsAvailable = false;
  await connect(false);
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Keep my question while I set up a model.');
  await expect(page.getByRole('button', { name: 'Send to agent', exact: true })).toBeDisabled();
  await expect(
    page.getByText('No models available. Configure a model in your agent, then reconnect.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Agent setup', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Agent connections' })).toContainText(
    'No models available. Use the setup guide',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toHaveValue(
    'Keep my question while I set up a model.',
  );
});

test('authorized live Big Pickle revision compiles and is reviewable in the actual desktop', async () => {
  test.skip(
    process.env.LOOM_AGENT_DESKTOP_LIVE !== '1',
    'Requires authorized OpenCode and local TeX.',
  );
  test.setTimeout(180_000);
  await page.locator('.agent-harness-button').click();
  const dialog = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await dialog.getByRole('button', { name: 'Connect OpenCode', exact: true }).click();
  await expect(dialog.getByText('Connected to this paper', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  const models = page.getByRole('combobox', { name: 'Agent model' });
  const model = await models
    .locator('option')
    .evaluateAll((options) =>
      options
        .find((option) => /big[ -]?pickle/i.test(option.textContent ?? ''))
        ?.getAttribute('value'),
    );
  expect(model).toBeTruthy();
  await models.selectOption(model!);
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill(
      'Edit main.tex now using your file editing tool. Replace exactly "Original sentence." with "Clear writing supports reproducible research." Keep all LaTeX commands unchanged. Do not execute shell commands or compile. After editing, respond briefly.',
    );
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  const limit = Date.now() + 110_000;
  while (Date.now() < limit) {
    const permission = page.getByRole('button', { name: 'Allow once', exact: true });
    if (await permission.isVisible()) await permission.click();
    if (
      (await readFile(join(root, 'main.tex'), 'utf8')).includes('reproducible research') &&
      (await page.getByRole('button', { name: 'Send to agent', exact: true }).isVisible())
    )
      break;
    await page.waitForTimeout(500);
  }
  await expect
    .poll(() => readFile(join(root, 'main.tex'), 'utf8'))
    .toContain('reproducible research');
  await expect(page.getByRole('button', { name: 'Send to agent', exact: true })).toBeVisible();
  await page
    .getByRole('main', { name: 'Source workspace' })
    .getByRole('button', { name: 'Create PDF', exact: true })
    .click();
  await expect(page.locator('.pdf-sheet canvas')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.pdf-sheet')).toContainText(
    'Clear writing supports reproducible research.',
  );
  await page.getByRole('button', { name: 'Review 1 change', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review file changes' });
  await review.locator('summary').filter({ hasText: 'main.tex' }).click();
  await expect(review.locator('.agent-diff')).toContainText(
    'Clear writing supports reproducible research.',
  );
  await page.screenshot({
    path: resolve('artifacts/phase-4-live-revision-pdf.png'),
    animations: 'disabled',
  });
  await review.getByRole('button', { name: 'Revert change…', exact: true }).click();
  await review.getByRole('button', { name: 'Revert this file', exact: true }).click();
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toBe(source);
});
