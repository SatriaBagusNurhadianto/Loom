import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
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
let closeNextEventStream = false;
let promptFailure: 'image413' | 'beforeAdmission503' | 'afterAdmission503' | null = null;
let failStatusReads = false;
let includeSecondaryModel = false;
let imageModel = false;
let requestBodies: { path: string; method: string; body: Record<string, unknown> }[];
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
async function launchElectron() {
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
}
async function stubNativeOpenDialog(paths: string[]) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected });
  }, paths);
}
async function openProjectIfNeeded() {
  if (
    await page
      .locator('.cm-editor')
      .isVisible()
      .catch(() => false)
  )
    return;
  await stubNativeOpenDialog([root]);
  await page.getByRole('button', { name: 'Open or create project', exact: true }).click();
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
}
async function restartElectron() {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app.close();
  await launchElectron();
  await openProjectIfNeeded();
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
  closeNextEventStream = false;
  promptFailure = null;
  failStatusReads = false;
  includeSecondaryModel = false;
  imageModel = false;
  requests = [];
  requestBodies = [];
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
      if (closeNextEventStream) {
        closeNextEventStream = false;
        setImmediate(() => res.destroy());
      }
      return;
    }
    let body: Record<string, unknown> = {};
    if (req.method !== 'GET') {
      let text = '';
      for await (const bytes of req) text += bytes.toString();
      body = text ? JSON.parse(text) : {};
    }
    requestBodies.push({ path, method: req.method!, body });
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
                capabilities: { tools: true, input: imageModel ? ['text', 'image'] : ['text'] },
                variants: [{ id: 'low' }, { id: 'high' }],
              },
              ...(includeSecondaryModel
                ? [
                    {
                      id: 'fixture-second',
                      providerID: 'synthetic',
                      name: 'Synthetic second model',
                      enabled: true,
                      type: 'chat',
                      capabilities: { tools: true, input: ['text'] },
                    },
                  ]
                : []),
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
      else if (path.endsWith('/message') && failStatusReads) {
        res
          .writeHead(503, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ name: 'Service Unavailable', data: {} }));
        return;
      } else if (path.endsWith('/message')) value = { data: [...s.messages].reverse() };
      else if (path.endsWith('/permission')) value = { data: s.permissions };
      else if (path.endsWith('/form')) value = { data: s.forms };
      else if (path.endsWith('/prompt')) {
        if (
          promptFailure === 'image413' &&
          Array.isArray(body.files) &&
          body.files.some((file) => String((file as { uri?: string }).uri).endsWith('.png'))
        ) {
          promptFailure = null;
          res.writeHead(413, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              name: 'Payload Too Large',
              data: { message: 'Image input too large.' },
            }),
          );
          return;
        }
        if (promptFailure === 'beforeAdmission503') {
          promptFailure = null;
          res
            .writeHead(503, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ name: 'Service Unavailable', data: {} }));
          return;
        }
        if (promptFailure === 'afterAdmission503') {
          promptFailure = null;
          s.active = true;
          delete s.time.idle;
          delete s.outcome;
          s.messages.push({
            id: 'user-' + s.messages.length,
            type: 'user',
            text: body.text,
            metadata: body.metadata,
          });
          res
            .writeHead(503, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ name: 'Service Unavailable', data: {} }));
          return;
        }
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
            String(body.text).includes('multiple changes')
              ? '% Agent header\n' +
                  source.replace('Original sentence.', 'Partial agent sentence.') +
                  '% Agent footer\n'
              : source.replace('Original sentence.', 'Partial agent sentence.'),
          );
          await writeFile(join(root, 'second.tex'), 'Partial second file.');
          s.messages.push({
            id: 'partial',
            type: 'assistant',
            content: [{ type: 'text', text: 'First file updated; continuing…' }],
          });
        } else if (String(body.text).includes('numeric question')) {
          s.forms = [
            {
              id: 'question-1',
              title: 'Synthetic numeric question',
              fields: [
                { key: 'confirmed', title: 'Confirmed', type: 'boolean', required: true },
                { key: 'amount', title: 'Amount', type: 'number', required: true },
                { key: 'count', title: 'Count', type: 'integer', required: true },
              ],
            },
          ];
        } else if (String(body.text).includes('native computation')) {
          s.messages.push({
            id: 'computation',
            type: 'assistant',
            content: [
              {
                type: 'tool',
                id: 'calc',
                name: 'bash',
                state: {
                  status: 'completed',
                  input: { command: 'python -c "print(2 + 2)"' },
                  content: [{ type: 'text', text: '4\n' }],
                },
              },
              { type: 'text', text: 'The result is 4.' },
            ],
          });
          s.active = false;
          s.outcome = 'succeeded';
          s.time.idle = Date.now();
          s.messages.push({ id: 'computation-idle', type: 'idle', outcome: 'succeeded' });
        } else if (String(body.text).includes('markdown rendering')) {
          s.messages.push({
            id: 'markdown-response',
            type: 'assistant',
            content: [
              {
                type: 'text',
                text: [
                  '## Research update',
                  'Updated **main.tex** and reviewed `references.bib`.',
                  '',
                  '- Preserved the manuscript structure',
                  '- Kept the source available for review',
                  '',
                  '> Revisions stay available for your review.',
                  '',
                  '```tex',
                  String.raw`\input{sections/methods.tex}`,
                  '```',
                  '',
                  '<script>window.__loomMarkdownProbe = true</script>',
                ].join('\n'),
              },
            ],
          });
          s.active = false;
          s.outcome = 'succeeded';
          s.time.idle = Date.now();
          s.messages.push({ id: 'markdown-idle', type: 'idle', outcome: 'succeeded' });
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
  await launchElectron();
  await stubNativeOpenDialog([root]);
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
  await page.getByRole('button', { name: 'Agent connections', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await expect(dialog).toBeVisible();
  if (await dialog.getByText('Connected to this paper', { exact: true }).isVisible()) {
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    return;
  }
  await dialog.getByRole('tab', { name: 'Runtime', exact: true }).click();
  await dialog.getByLabel('Use an existing server').check();
  await dialog.getByLabel('Server address').fill(endpoint);
  await dialog.getByLabel('Server password', { exact: true }).fill('fixture-password');
  await dialog.getByRole('button', { name: 'Connect OpenCode', exact: true }).click();
  await expect(dialog.getByText('Connected to this paper', { exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.screenshot({
    path: resolve('artifacts/phase-4-connections-redesign.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  if (requireModel)
    await expect(
      page.getByRole('button', { name: 'Choose agent model', exact: true }),
    ).toBeVisible();
}
test('real Electron agent flow: context, permissions, retained questions, streaming, safe review and newer writing', async () => {
  await connect();
  await stubNativeOpenDialog([join(root, 'main.tex')]);
  await page.getByRole('button', { name: 'Attach paper files or images' }).click();
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
  const panel = page.locator('.agent-workspace-panel');
  const initialHeight = (await panel.boundingBox())!.height;
  await page.getByRole('button', { name: 'Resize conversation', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(initialHeight);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('Agent revision');
  // Wait for the filesystem bridge before authoring a compatible edit to the revised source.
  await expect(page.locator('.cm-content')).toContainText('Agent revision for researchers.');
  // A later compatible author edit must survive revert of the observed request.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('% New author note.\n');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('New author note');
  await page.getByRole('button', { name: 'Review main.tex', exact: true }).click();
  const review = page.getByRole('region', { name: 'Changes in main.tex', exact: true });
  await expect(review.locator('.diff-removed')).toContainText('Original sentence.');
  await expect(review.locator('.diff-added')).toContainText('Agent revision for researchers.');
  await expect(review.locator('.diff-removed .diff-line-number')).toHaveText(['3', '']);
  await expect(review.locator('.diff-added .diff-line-number')).toHaveText(['', '3']);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.screenshot({ path: resolve('artifacts/phase-4-review.png'), animations: 'disabled' });
  await review.getByRole('button', { name: 'Undo file changes', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Undo agent changes' })
    .getByRole('button', { name: 'Undo changes', exact: true })
    .click();
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('Original sentence.');
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toContain('New author note');
  await expect(page.getByRole('region', { name: 'Merge Changes', exact: true })).not.toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(requests.some((p) => p.includes('/mcp/'))).toBe(false);
  await page.screenshot({
    path: resolve('artifacts/phase-4-conversation.png'),
    animations: 'disabled',
  });
});
for (const action of ['keep', 'undo'] as const) {
  test(`inline merge card ${action}s all observed files and keeps narrow diff controls usable`, async () => {
    await connect();
    await page
      .getByRole('textbox', { name: 'Ask about your paper' })
      .fill('Perform a partial operation with multiple changes.');
    await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
    await expect(page.getByText('First file updated; continuing…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop agent request', exact: true }).click();
    const card = page.getByRole('region', { name: 'Merge Changes', exact: true });
    await expect(card.locator('.agent-merge-file')).toHaveCount(2);
    await dimensions(720, 540);
    await card.getByRole('button', { name: 'Review main.tex', exact: true }).click();
    const diff = page.getByRole('region', { name: 'Changes in main.tex', exact: true });
    await expect(diff).toBeFocused();
    await expect(
      diff.locator('.diff-added').filter({ hasText: 'Partial agent sentence.' }),
    ).toBeVisible();
    await diff.getByRole('button', { name: 'Next change', exact: true }).click();
    await expect(diff.locator('.agent-diff-toolbar [aria-live]')).toHaveText('2/3');
    await page.waitForTimeout(1700); // Cross several native-state polls without resetting navigation.
    await expect(diff.locator('.agent-diff-toolbar [aria-live]')).toHaveText('2/3');
    await expect(
      diff.getByRole('button', { name: 'Keep file changes', exact: true }),
    ).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: resolve(`artifacts/phase-4-inline-${action}-small.png`),
      animations: 'disabled',
    });
    await diff.press('Escape');
    await expect(page.locator('.cm-content')).toBeFocused();
    if (action === 'undo') {
      await card.getByRole('button', { name: 'Undo all', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: 'Undo agent changes' });
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(card.getByRole('button', { name: 'Undo all', exact: true })).toBeFocused();
      await card.getByRole('button', { name: 'Undo all', exact: true }).click();
      await confirmation.getByRole('button', { name: 'Undo changes', exact: true }).click();
      await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toBe(source);
      await expect
        .poll(() => readFile(join(root, 'second.tex'), 'utf8').catch(() => 'removed'))
        .toBe('removed');
    } else {
      await card.getByRole('button', { name: 'Keep all', exact: true }).click();
      await expect
        .poll(() => readFile(join(root, 'main.tex'), 'utf8'))
        .toContain('Partial agent sentence.');
      expect(await readFile(join(root, 'second.tex'), 'utf8')).toBe('Partial second file.');
    }
    await expect(card).not.toBeVisible();
  });
}

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
  await page.getByRole('button', { name: 'Review main.tex', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Merge Changes', exact: true })).toContainText(
    'cancelled request',
  );
  await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
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
  await expect(
    page.locator('.agent-chat-row').filter({ hasText: 'Perform a partial operation' }),
  ).toBeVisible();
});
test('provider settings, source and composer remain usable at 720 by 540 with keyboard access', async () => {
  includeSecondaryModel = true;
  await connect();
  await dimensions(720, 540);
  await page.getByRole('button', { name: 'Agent connections', exact: true }).click();
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
  await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reasoning', exact: true })
    .getByRole('button', { name: 'High', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toHaveText('High');
  await page.getByRole('button', { name: 'Choose agent model', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose agent model', exact: true });
  await expect(picker.getByRole('textbox', { name: 'Search models' })).toBeFocused();
  const pickerBounds = await picker.boundingBox();
  expect(pickerBounds!.x).toBeGreaterThanOrEqual(0);
  expect(pickerBounds!.y).toBeGreaterThanOrEqual(0);
  expect(pickerBounds!.x + pickerBounds!.width).toBeLessThanOrEqual(720);
  expect(pickerBounds!.y + pickerBounds!.height).toBeLessThanOrEqual(540);
  await page.screenshot({
    path: resolve('artifacts/phase-4-provider-logos-model-picker.png'),
    animations: 'disabled',
  });
  await picker.getByRole('textbox', { name: 'Search models' }).press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(picker).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose agent model', exact: true })).toContainText(
    'Synthetic second model',
  );
  await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toHaveText('Default');
  await expect(page.getByRole('button', { name: 'Choose agent model', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Choose agent model', exact: true }).click();
  await picker.getByRole('textbox', { name: 'Search models' }).press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Choose agent model', exact: true })).toContainText(
    'Synthetic research model',
  );
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

test('native reasoning and permission controls persist with the chat and reach the harness', async () => {
  await connect();
  await page.getByRole('button', { name: 'Agent connections', exact: true }).click();
  const connections = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await connections.getByRole('tab', { name: 'Models', exact: true }).click();
  await expect(connections).toContainText('Synthetic research model');
  await page.screenshot({
    path: resolve('artifacts/phase-4-provider-models.png'),
    animations: 'disabled',
  });
  await connections.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
  const reasoning = page.getByRole('dialog', { name: 'Reasoning', exact: true });
  await reasoning.getByRole('button', { name: 'High', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toHaveText('High');
  await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Permissions', exact: true }).click();
  await page.screenshot({
    path: resolve('artifacts/phase-4-permission-menu.png'),
    animations: 'disabled',
  });
  await page
    .getByRole('dialog', { name: 'Permissions', exact: true })
    .getByRole('button', { name: /^Full access/ })
    .click();
  await expect(page.getByRole('button', { name: 'Permissions', exact: true })).toBeFocused();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Perform a partial operation.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await expect(page.getByText('First file updated; continuing…', { exact: true })).toBeVisible();
  expect(
    requestBodies.some(
      (r) =>
        r.method === 'PATCH' &&
        Array.isArray(r.body.permissions) &&
        JSON.stringify(r.body.permissions) ===
          JSON.stringify([{ action: '*', resource: '*', effect: 'allow' }]),
    ),
  ).toBe(true);
  expect(
    requestBodies.some(
      (r) =>
        r.path.endsWith('/model') &&
        (r.body.model as { variant?: string } | undefined)?.variant === 'high',
    ),
  ).toBe(true);
  expect(requestBodies.some((r) => r.path.endsWith('/agent') && r.body.agent === 'build')).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Permissions', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop agent request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send to agent', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await connect();
  await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toHaveText('High');
  await expect(page.getByRole('button', { name: 'Permissions', exact: true })).toHaveText(
    'Full access',
  );
  await dimensions(720, 540);
  await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
  await page.screenshot({
    path: resolve('artifacts/phase-4-reasoning-menu.png'),
    animations: 'disabled',
  });
  const bounds = await page.getByRole('dialog', { name: 'Reasoning', exact: true }).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(720);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(540);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Permissions', exact: true }).click();
  const permissions = page.getByRole('dialog', { name: 'Permissions', exact: true });
  await expect(permissions).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/phase-4-permission-menu-small.png'),
    animations: 'disabled',
  });
  const permissionBounds = await permissions.boundingBox();
  expect(permissionBounds!.x).toBeGreaterThanOrEqual(0);
  expect(permissionBounds!.y).toBeGreaterThanOrEqual(0);
  expect(permissionBounds!.x + permissionBounds!.width).toBeLessThanOrEqual(720);
  expect(permissionBounds!.y + permissionBounds!.height).toBeLessThanOrEqual(540);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Permissions', exact: true })).toBeFocused();
});

test('native questions preserve decimal input, validate blank and integer answers, and accept false', async () => {
  await connect();
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Ask a numeric question.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  const amount = page.getByRole('textbox', { name: 'Amount', exact: true });
  const count = page.getByRole('textbox', { name: 'Count', exact: true });
  await expect(amount).toBeVisible();
  await amount.fill('1.');
  await expect(amount).toHaveValue('1.');
  await amount.fill('');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue('');
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('checkbox', { name: 'Confirmed', exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await amount.fill('1.5');
  await count.fill('2.5');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(count).toBeFocused();
  await expect(page.getByRole('alert').filter({ hasText: 'whole number' })).toBeVisible();
  await count.fill('2');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect
    .poll(() => requestBodies.find((r) => r.path.endsWith('/form/question-1/reply'))?.body.answer)
    .toEqual({ confirmed: false, amount: 1.5, count: 2 });
});

test('native attachment picker preserves cancellation, rejects outside-paper files and retains source selections', async () => {
  const plus = page.getByRole('button', { name: 'Attach paper files or images', exact: true });
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Keep this draft');
  await stubNativeOpenDialog([join(root, 'main.tex')]);
  await plus.click();
  const attached = page.getByRole('button', { name: 'Remove attached file main.tex', exact: true });
  await expect(attached).toBeVisible();
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await plus.click();
  await expect(attached).toBeVisible();
  await stubNativeOpenDialog([join(directory, 'outside.tex')]);
  await plus.click();
  await expect(page.getByRole('alert')).toContainText('inside this paper folder');
  await expect(attached).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toHaveValue(
    'Keep this draft',
  );
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Attach selected text', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove selected passage main.tex' }),
  ).toBeVisible();
});

test('picker copies outside images and retains project files in a mixed selection', async () => {
  const bytes = await readFile(resolve('tests/fixtures/whiteboard-equation.png'));
  const external = join(directory, 'outside.png');
  await writeFile(external, bytes);
  await dimensions(720, 540);
  await stubNativeOpenDialog([join(root, 'main.tex'), external]);
  await page.getByRole('button', { name: 'Attach paper files or images' }).click();
  await expect(page.getByRole('button', { name: 'Remove attached file main.tex' })).toBeVisible();
  const chip = page.getByRole('button', { name: /Remove attached file loom-import-.*\.png/ });
  await expect(chip).toBeVisible();
  const tray = page.getByRole('group', { name: 'Attachments to send' });
  await expect(tray.locator('img')).toBeVisible();
  await expect(tray.locator('.agent-attachment-file')).toContainText('main.tex');
  const name = (await chip.getAttribute('aria-label'))!.replace('Remove attached file ', '');
  expect(await readFile(join(root, name))).toEqual(bytes);
  expect(await readFile(external)).toEqual(bytes);
  await expect(page.getByText('1 image copied into this paper.')).toBeVisible();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tools', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach paper files or images' })).toBeInViewport();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.waitForTimeout(400);
  await page.screenshot({
    path: resolve('artifacts/phase-6-import-image-small.png'),
    animations: 'disabled',
  });
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(chip).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toBeFocused();
  expect(await readFile(join(root, name))).toEqual(bytes);
});

test('picker reports a partial import without attaching an unimported file', async () => {
  const bytes = await readFile(resolve('tests/fixtures/whiteboard-equation.png'));
  const first = join(directory, 'first.png'),
    invalid = join(directory, 'invalid.png');
  await writeFile(first, bytes);
  await writeFile(invalid, 'not an image');
  await stubNativeOpenDialog([first, invalid]);
  await page.getByRole('button', { name: 'Attach paper files or images' }).click();
  await expect(page.getByRole('alert')).toContainText('Already copied: loom-import-');
  await expect(page.getByRole('button', { name: /Remove attached file loom-import/ })).toHaveCount(
    0,
  );
  const imports = (await readdir(root)).filter((name) => name.startsWith('loom-import-'));
  expect(imports).toHaveLength(1);
  expect(await readFile(join(root, imports[0]))).toEqual(bytes);
  expect(await readFile(invalid, 'utf8')).toBe('not an image');
});

test('a pending attachment picker blocks a project switch until selection completes', async () => {
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () =>
      new Promise((resolve) => {
        (
          globalThis as unknown as {
            finishPicker: (result: { canceled: boolean; filePaths: string[] }) => void;
          }
        ).finishPicker = resolve;
      });
  });
  await page.getByRole('button', { name: 'Attach paper files or images' }).click();
  await expect
    .poll(() =>
      app.evaluate(() => typeof (globalThis as unknown as { finishPicker?: unknown }).finishPicker),
    )
    .toBe('function');
  const switched = await page.evaluate(() => window.loom!.chooseProject('sample'));
  expect(switched).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  await app.evaluate(
    (_electron, file) => {
      (
        globalThis as unknown as {
          finishPicker: (result: { canceled: boolean; filePaths: string[] }) => void;
        }
      ).finishPicker({ canceled: false, filePaths: [file] });
    },
    join(root, 'main.tex'),
  );
  await expect(page.getByRole('button', { name: 'Remove attached file main.tex' })).toBeVisible();
});

test('image attachment explains unsupported model and preserves the draft at a small size', async () => {
  await writeFile(
    join(root, 'board.png'),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  );
  await connect();
  await dimensions(720, 540);
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Transcribe this');
  await stubNativeOpenDialog([join(root, 'board.png')]);
  await page.getByRole('button', { name: 'Attach paper files or images' }).click();
  await expect(page.getByText(/This model does not report image support/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to agent' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Ask about your paper' }).press('Control+Enter');
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toHaveValue(
    'Transcribe this',
  );
  await expect(page.getByRole('button', { name: 'Remove attached file board.png' })).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/phase-6-image-unsupported-small.png'),
    animations: 'disabled',
  });
});

test('pasting an image saves an ordinary project asset and keeps clipboard text', async () => {
  await connect();
  await dimensions(720, 540);
  const imageBytes = await readFile(resolve('tests/fixtures/whiteboard-equation.png'));
  const input = page.getByRole('textbox', { name: 'Ask about your paper' });
  await input.fill('Draft ');
  const allowsTextPaste = await input.evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(bytes)], 'board.png', {
        type: 'image/png',
      }),
    );
    transfer.setData('text/plain', 'caption');
    return element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, Array.from(imageBytes));
  expect(allowsTextPaste).toBe(true);
  const attachment = page.getByRole('button', { name: /Remove attached file loom-paste-.*\.png/ });
  await expect(attachment).toBeVisible();
  const name = (await attachment.getAttribute('aria-label'))!.replace('Remove attached file ', '');
  expect(await readFile(join(root, name))).toEqual(imageBytes);
  await expect(input).toHaveValue('Draft ');
  await page.getByRole('button', { name: `View image ${name}` }).click();
  const image = page.getByRole('img', { name: `Current project image: ${name}` });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(720);
  await expect(
    page.getByText('Current project file; it may have changed since it was sent.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show conversation' }).click();
  await expect(input).toBeVisible();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to agent' })).toBeVisible();
  await expect(page.getByText(/This model does not report image support/)).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/phase-6-image-preview-small.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Close image' }).click();
  await expect(image).toHaveCount(0);
  const thumbnail = page.getByRole('button', { name: `View image ${name}` }).locator('img');
  const originalThumbnail = await thumbnail.getAttribute('src');
  await writeFile(
    join(root, name),
    await readFile(resolve('tests/fixtures/whiteboard-diagram.png')),
  );
  await expect.poll(() => thumbnail.getAttribute('src')).not.toBe(originalThumbnail);
  await expect(thumbnail).toBeVisible();
});

test('submitted image snapshot stays available after the project file changes and after restart', async () => {
  imageModel = true;
  const bytes = await readFile(resolve('tests/fixtures/whiteboard-equation.png'));
  await writeFile(join(root, 'board.png'), bytes);
  await connect();
  await stubNativeOpenDialog([join(root, 'board.png'), join(root, 'main.tex')]);
  await page.getByRole('button', { name: 'Attach paper files or images' }).click();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Show markdown rendering.');
  await page.getByRole('button', { name: 'Send to agent' }).click();
  const sentImage = page.getByRole('button', { name: 'View submitted image board.png' });
  await expect(sentImage).toBeVisible();
  await sentImage.scrollIntoViewIfNeeded();
  await expect(sentImage.locator('img')).toBeVisible();
  await expect(page.locator('.agent-message-user .agent-attachment-file')).toContainText(
    'main.tex',
  );
  const fileCard = page.locator('.agent-message-user .agent-attachment-card:not(.is-image)');
  expect((await fileCard.boundingBox())!.height).toBeLessThan(
    (await sentImage.boundingBox())!.height,
  );
  await expect(page.locator('.composer-area [aria-label="Submitted images"]')).toHaveCount(0);
  await page.screenshot({
    path: resolve('artifacts/phase-6-sent-image-message-small.png'),
    animations: 'disabled',
  });
  const payload = requestBodies.find((entry) => entry.path.endsWith('/prompt'))!.body;
  expect(payload.text).toContain('project-relative files, in attachment order: board.png');
  const files = payload.files as Array<{ uri: string }>;
  const snapshotPath = fileURLToPath(files[0].uri);
  expect(snapshotPath).not.toBe(join(root, 'board.png'));
  expect(await readFile(snapshotPath)).toEqual(bytes);
  await writeFile(join(root, 'board.png'), Buffer.from('changed'));
  await dimensions(720, 540);
  await sentImage.click();
  await expect(page.getByRole('img', { name: 'Submitted image: board.png' })).toBeVisible();
  const preview = page.getByRole('region', { name: 'Project image preview' });
  const image = preview.getByRole('img', { name: 'Submitted image: board.png' });
  const originalWidth = (await image.boundingBox())!.width;
  await preview.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.press('Enter');
  await expect(preview.getByText('150%')).toBeVisible();
  expect((await image.boundingBox())!.width).toBeGreaterThan(originalWidth);
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toBeVisible();
  await preview.getByRole('button', { name: 'Expand' }).click();
  const dialog = page.getByRole('dialog', { name: 'Inspect image' });
  await expect(dialog.getByRole('img', { name: 'Submitted image: board.png' })).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/phase-6-image-inspection-small.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(preview.getByRole('button', { name: 'Expand' })).toBeFocused();
  await restartElectron();
  await page.getByRole('button', { name: 'Show conversation' }).click();
  const restoredImage = page.getByRole('button', { name: 'View submitted image board.png' });
  await expect(restoredImage).toBeVisible();
  await restoredImage.scrollIntoViewIfNeeded();
  await expect(restoredImage.locator('img')).toBeVisible();
  await expect(page.locator('.agent-message-user .agent-attachment-file')).toContainText(
    'main.tex',
  );
  await restoredImage.click();
  await expect(page.getByRole('img', { name: 'Submitted image: board.png' })).toBeVisible();
});

test('older image records use conversation thumbnails instead of rows below the composer', async () => {
  imageModel = true;
  await writeFile(
    join(root, 'board.png'),
    await readFile(resolve('tests/fixtures/whiteboard-equation.png')),
  );
  await connect();
  await stubNativeOpenDialog([join(root, 'board.png')]);
  await page.getByRole('button', { name: 'Attach paper files or images' }).click();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Show markdown rendering.');
  await page.getByRole('button', { name: 'Send to agent' }).click();
  await expect(page.getByRole('button', { name: 'View submitted image board.png' })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app.close();
  // Reproduce a pre-association recovery record, without changing its saved image bytes.
  const db = new DatabaseSync(join(directory, 'data', 'metadata.sqlite'));
  try {
    const row = db
      .prepare("SELECT key,value FROM preferences WHERE key LIKE 'agent-turns:%'")
      .get() as { key: string; value: string };
    const record = JSON.parse(row.value);
    for (const turn of record.turns) {
      delete turn.knownMessageIds;
      delete turn.view.messageId;
      delete turn.view.messageAssociationResolved;
      delete turn.view.attachments;
    }
    db.prepare('UPDATE preferences SET value=? WHERE key=?').run(JSON.stringify(record), row.key);
  } finally {
    db.close();
  }
  await launchElectron();
  await openProjectIfNeeded();
  await dimensions(720, 540);
  await page.getByRole('button', { name: 'Show conversation' }).click();
  const earlier = page.getByRole('region', { name: 'Earlier request attachments' });
  const thumbnail = earlier.getByRole('button', { name: 'View submitted image board.png' });
  await thumbnail.scrollIntoViewIfNeeded();
  await expect(thumbnail.locator('img')).toBeVisible();
  await expect(page.locator('.composer-area [aria-label="Submitted images"]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toBeInViewport();
  await page.screenshot({
    path: resolve('artifacts/phase-6-legacy-attachment-cards-small.png'),
    animations: 'disabled',
  });
  await thumbnail.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: 'Submitted image: board.png' })).toBeVisible();
});

test('a rejected image request keeps the session connected and retains the draft and attachment', async () => {
  imageModel = true;
  await writeFile(
    join(root, 'board.png'),
    await readFile(resolve('tests/fixtures/whiteboard-equation.png')),
  );
  await connect();
  await stubNativeOpenDialog([join(root, 'board.png')]);
  await page.getByRole('button', { name: 'Attach paper files or images' }).click();
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Transcribe this image.');
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to agent' })).toBeEnabled();
  promptFailure = 'image413';
  await page.getByRole('button', { name: 'Send to agent' }).click();
  await expect.poll(() => requests.filter((request) => request.endsWith('/prompt')).length).toBe(1);
  await expect(page.getByRole('alert')).toContainText('HTTP 413');
  await expect(page.getByRole('alert')).toContainText('Use a smaller image');
  await dimensions(720, 540);
  await page.screenshot({
    path: resolve('artifacts/phase-6-image-rejection-small.png'),
    animations: 'disabled',
  });
  await expect(page.getByRole('alert')).toBeInViewport();
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agent interrupted', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toHaveValue(
    'Transcribe this image.',
  );
  await expect(page.getByRole('button', { name: 'Remove attached file board.png' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove attached file board.png' }).click();
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Continue without image.');
  await page.getByRole('button', { name: 'Send to agent' }).click();
  await expect(page.getByText('Permission needed: edit', { exact: true })).toBeVisible();
  await expect(page.locator('.agent-message-user .agent-attachment-card.is-image')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /View submitted image board\.png/ })).toHaveCount(
    0,
  );
  expect(
    requests.filter((request) => request === 'POST /api/session/session-0/prompt'),
  ).toHaveLength(2);
});

test('an ambiguous 503 before admission is shown honestly and never retried automatically', async () => {
  await connect();
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Try this request once.');
  promptFailure = 'beforeAdmission503';
  await page.getByRole('button', { name: 'Send to agent' }).click();

  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  await expect(page.locator('.agent-composer-status [role="status"]')).toHaveText(
    'Request status uncertain',
  );
  await dimensions(720, 540);
  await expect(page.getByRole('alert')).toBeInViewport();
  await page.screenshot({
    path: resolve('artifacts/phase-6-uncertain-request-small.png'),
    animations: 'disabled',
  });
  await expect(page.getByRole('button', { name: 'Stop agent request' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toHaveValue(
    'Try this request once.',
  );
  expect(
    requests.filter((request) => request === 'POST /api/session/session-0/prompt'),
  ).toHaveLength(1);
});

test('polling resolves an ambiguous 503 when the server confirms the turn was admitted', async () => {
  await connect();
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Continue this request.');
  promptFailure = 'afterAdmission503';
  await page.getByRole('button', { name: 'Send to agent' }).click();

  await expect(page.locator('.agent-composer-status [role="status"]')).toHaveText('Agent working');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Continue this request.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent request' })).toBeEnabled();
  expect(
    requests.filter((request) => request === 'POST /api/session/session-0/prompt'),
  ).toHaveLength(1);
});

test('a transient status-read failure keeps the connection and reports unavailable status', async () => {
  await connect();
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Keep this request safe.');
  await page.getByRole('button', { name: 'Send to agent' }).click();
  await expect
    .poll(
      () => requests.filter((request) => request === 'POST /api/session/session-0/prompt').length,
    )
    .toBe(1);
  failStatusReads = true;

  await expect(page.getByRole('alert')).toContainText('Could not refresh agent status');
  await expect(page.locator('.agent-composer-status [role="status"]')).toHaveText(
    'Agent status unavailable',
  );
  await expect(page.getByRole('button', { name: 'Stop agent request' })).toBeEnabled();
  failStatusReads = false;
  await expect(page.locator('.agent-composer-status [role="status"]')).toHaveText(
    'Needs your permission',
  );
  await expect(page.getByText('Permission needed: edit', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agent interrupted', exact: true })).toHaveCount(0);
  expect(
    requests.filter((request) => request === 'POST /api/session/session-0/prompt'),
  ).toHaveLength(1);
});

test('native computation activity exposes the reported command and result', async () => {
  await connect();
  await dimensions(720, 540);
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill('Run native computation.');
  await page.getByRole('button', { name: 'Send to agent' }).click();
  const details = page.locator('.agent-execution');
  await expect(details).toBeVisible();
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toContainText('python -c "print(2 + 2)"');
  await expect(details).toContainText('4');
  await expect(details).toContainText('Files read by this command may not be shown');
  await expect(details.locator('pre').last()).toBeInViewport();
  await page.screenshot({
    path: resolve('artifacts/phase-6-computation-small.png'),
    animations: 'disabled',
  });
  await details.locator('summary').scrollIntoViewIfNeeded();
  await expect(details.locator('summary')).toBeInViewport();
  await page.getByText('Tool activity · completed').scrollIntoViewIfNeeded();
  await expect(page.getByText('Tool activity · completed')).toBeInViewport();
});

test('scientific request templates preserve the draft and selected source', async () => {
  await dimensions(720, 540);
  const input = page.getByRole('textbox', { name: 'Ask about your paper' });
  await input.fill('My existing note.');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace tools' });
  await expect(dialog.getByRole('heading', { name: 'Scientific content' })).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/phase-6-scientific-tools-small.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Convert image' }).focus();
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue(/My existing note\.[\s\S]*Convert the attached image/);
  await expect(
    page.getByRole('button', { name: 'Remove selected passage main.tex' }),
  ).toBeVisible();
  await expect(input).toBeFocused();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await dialog.getByRole('button', { name: 'Revise notation' }).click();
  await expect(page.getByText(/previously attached passage was retained/)).toBeVisible();
  await expect(input).toHaveValue(
    /My existing note\.[\s\S]*Convert the attached image[\s\S]*Help revise the equation/,
  );
});

test('agent messages render supported Markdown as safe native elements', async () => {
  await connect();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Show markdown rendering.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  const markdown = page.locator('.agent-message-harness .agent-markdown');
  await expect(markdown.locator('h4')).toHaveText('Research update');
  await expect(markdown.locator('strong')).toHaveText('main.tex');
  await expect(markdown.locator('p code')).toHaveText('references.bib');
  await expect(markdown.locator('ul li')).toHaveText([
    'Preserved the manuscript structure',
    'Kept the source available for review',
  ]);
  await expect(markdown.locator('blockquote')).toContainText(
    'Revisions stay available for your review.',
  );
  await expect(markdown.locator('.agent-code-block pre')).toContainText(
    '\\input{sections/methods.tex}',
  );
  await expect(markdown.locator('script')).toHaveCount(0);
  await expect(markdown).toContainText('<script>window.__loomMarkdownProbe = true</script>');
  await markdown.evaluate((element) => {
    const scroller = element.closest('.agent-messages');
    if (scroller) scroller.scrollTop = 0;
  });
  await expect(page.locator('.agent-message-harness > small')).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/phase-4-agent-markdown.png'),
    animations: 'disabled',
  });
});

test('message copy reports clipboard failures and confirms successful copies', async () => {
  await connect();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Show markdown rendering.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();

  const assistantMessage = page.locator('.agent-message-harness').last();
  const copyButton = assistantMessage.getByRole('button', { name: 'Copy message' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  await copyButton.click();
  await expect(page.getByRole('alert')).toContainText(/could not copy/i);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard write rejected.');
        },
      },
    });
  });
  await assistantMessage.getByRole('button', { name: 'Copy message' }).click();
  await expect(page.getByRole('alert')).toContainText(/could not copy/i);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).__loomCopiedText = value;
        },
      },
    });
  });
  await assistantMessage.getByRole('button', { name: 'Copy message' }).click();
  await expect(assistantMessage.getByRole('button', { name: 'Message copied' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__loomCopiedText)).toContain('Research update');
});

test('Chats deletion can be cancelled and remains deleted after an Electron restart', async () => {
  const title = 'A conversation for deletion.';
  await connect();
  await page.getByRole('textbox', { name: 'Ask about your paper' }).fill(title);
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await expect(page.getByText('Permission needed: edit', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await page.getByLabel('Audience', { exact: true }).fill('Researchers');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(
    page.getByText('Updated main.tex for your selected audience.', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  const conversation = page.locator('.agent-chat-row').filter({ hasText: title });
  await expect(conversation).toBeVisible();
  const deleteButton = page.getByRole('button', {
    name: `Delete conversation ${title}`,
    exact: true,
  });
  await deleteButton.click();
  const confirmation = page.getByRole('dialog', { name: 'Delete conversation', exact: true });
  await expect(confirmation).toContainText('Paper files and change-recovery records stay intact.');
  await page.screenshot({
    path: resolve('artifacts/phase-4-delete-conversation.png'),
    animations: 'disabled',
  });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(conversation).toBeVisible();

  await deleteButton.click();
  await confirmation.getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await expect(conversation).not.toBeVisible();
  await expect(page.getByText('No conversations yet', { exact: true })).toBeVisible();
  await expect(
    page.locator('.chat-empty').getByRole('button', { name: 'New conversation', exact: true }),
  ).toBeFocused();

  await restartElectron();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(page.getByText('No conversations yet', { exact: true })).toBeVisible();
  await expect(page.locator('.agent-chat-row').filter({ hasText: title })).toHaveCount(0);
});

test('a replacement binary path remains connectable after the saved path disappears', async () => {
  // Seed private runtime preference through the public connection boundary, using the synthetic attached server.
  await page.evaluate(
    async ({ endpoint }) => {
      const project = await window.loom!.project({ type: 'current' });
      if (!project.ok || !project.value) throw new Error('No project');
      const projectId = project.value.id;
      const connected = await window.loom!.agent({
        type: 'connect',
        projectId,
        harness: 'opencode',
        endpoint,
        password: 'fixture-password',
        executable: '/missing-loom-test-binary',
      });
      if (!connected.ok) throw new Error(connected.error.message);
      await window.loom!.agent({ type: 'disconnect', projectId });
    },
    { endpoint },
  );
  await page.getByRole('button', { name: 'Agent connections', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await expect(dialog.getByRole('button', { name: 'Set up OpenCode', exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Runtime', exact: true }).click();
  await dialog.getByLabel('Binary path', { exact: true }).fill('');
  await expect(dialog.getByRole('button', { name: 'Connect OpenCode', exact: true })).toBeVisible();
  await dialog.getByLabel('Binary path', { exact: true }).fill('/replacement-loom-test-binary');
  await expect(dialog.getByRole('button', { name: 'Connect OpenCode', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Connect OpenCode', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
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
  await page.getByRole('button', { name: 'Review main.tex', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Merge Changes', exact: true })).toContainText(
    'interrupted request',
  );
  expect(Object.values(sessions)[0].active).toBe(false);
});
test('agent stream interruption offers a safe reconnect path and preserves partial work', async () => {
  await connect();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill('Perform a partial operation.');
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await expect(page.getByText('First file updated; continuing…', { exact: true })).toBeVisible();
  streams[0].destroy();
  await expect(page.getByRole('alert')).toContainText(
    'Agent connection interrupted. Partial work is retained.',
  );
  await expect(page.getByText('Agent interrupted', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent request', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Agent interrupted', exact: true })).toBeDisabled();
  await dimensions(720, 540);
  await expect(page.getByRole('alert')).toBeInViewport();
  await page.screenshot({
    path: resolve('artifacts/phase-6-connection-interrupted-small.png'),
    animations: 'disabled',
  });
  await expect(page.getByRole('button', { name: 'Reconnect OpenCode', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Connection details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await dialog.getByRole('tab', { name: 'Runtime', exact: true }).click();
  await expect(dialog.getByLabel('Use an existing server')).toBeChecked();
  await expect(dialog.getByText(/does not retain its address or password/i)).toBeVisible();
  await dialog.getByLabel('Server address').fill(endpoint);
  await dialog.getByLabel('Server password', { exact: true }).fill('fixture-password');
  await dialog.getByRole('button', { name: 'Reconnect OpenCode', exact: true }).click();
  await expect(dialog.getByText('Connected to this paper', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Merge Changes' })).toContainText(
    'interrupted request',
  );
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('Partial agent sentence.');
});

test('a stream that closes during initial connection is reported as interrupted', async () => {
  closeNextEventStream = true;
  await page.getByRole('button', { name: 'Agent connections', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await dialog.getByRole('tab', { name: 'Runtime', exact: true }).click();
  await dialog.getByLabel('Use an existing server').check();
  await dialog.getByLabel('Server address').fill(endpoint);
  await dialog.getByLabel('Server password', { exact: true }).fill('fixture-password');
  await dialog.getByRole('button', { name: 'Connect OpenCode', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Agent connection interrupted. Reconnect');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('Agent interrupted', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent request', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Connection details', exact: true }).click();
  const recovery = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  await recovery.getByRole('tab', { name: 'Runtime', exact: true }).click();
  await expect(recovery.getByLabel('Use an existing server')).toBeChecked();
  await expect(recovery.getByText(/does not retain its address or password/i)).toBeVisible();
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
  await page
    .getByRole('region', { name: 'Merge Changes', exact: true })
    .getByRole('button', { name: 'Undo all', exact: true })
    .click();
  const undo = page.getByRole('dialog', { name: 'Undo agent changes' });
  await undo.getByRole('button', { name: 'Undo changes', exact: true }).click();
  await expect(undo.getByRole('alert')).toContainText('Stopped here');
  await undo.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Newer author sentence.');
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('Overlapping native sentence.');
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
    'No models were reported.',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Ask about your paper' })).toHaveValue(
    'Keep my question while I set up a model.',
  );
});

test('authorized live native agent creates LaTeX files, compiles and safely reverts in the desktop', async () => {
  test.skip(
    process.env.LOOM_AGENT_DESKTOP_LIVE !== '1',
    'Requires authorized OpenCode and local TeX.',
  );
  test.setTimeout(180_000);
  await page.getByRole('button', { name: 'Agent connections', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent connections', exact: true });
  const codex = process.env.LOOM_AGENT_DESKTOP_HARNESS === 'codex';
  if (codex) await dialog.getByRole('button', { name: /Codex/ }).click();
  if (!codex && process.env.LOOM_CLASSIC_EXECUTABLE) {
    await dialog.getByRole('tab', { name: 'Runtime', exact: true }).click();
    await dialog
      .getByLabel('Binary path', { exact: true })
      .fill(process.env.LOOM_CLASSIC_EXECUTABLE);
  }
  await dialog
    .getByRole('button', { name: codex ? 'Connect Codex' : 'Connect OpenCode', exact: true })
    .click();
  await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Choose agent model', exact: true }).click();
  const models = page.getByRole('dialog', { name: 'Choose agent model', exact: true });
  await models
    .getByRole('textbox', { name: 'Search models' })
    .fill(codex ? 'gpt-6.1-sol' : 'Big Pickle');
  await models
    .locator('[data-choice]')
    .filter({ hasText: codex ? /gpt-6.1-sol/i : 'Big Pickle' })
    .first()
    .click();
  await page
    .getByRole('textbox', { name: 'Ask about your paper' })
    .fill(
      'Use your native filesystem tools to create sections/notes.tex containing the sentence "Clear writing supports reproducible research." Then edit main.tex to include that file immediately before the end of the document using a LaTeX input command. Preserve Original sentence. and every existing LaTeX command. Make both file changes now. Do not use browser tools or compile. After editing, respond briefly.',
    );
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  const limit = Date.now() + 110_000;
  while (Date.now() < limit) {
    const permission = page.getByRole('button', { name: 'Allow once', exact: true });
    if (await permission.isVisible()) await permission.click();
    if (
      (await readFile(join(root, 'sections/notes.tex'), 'utf8').catch(() => '')).includes(
        'reproducible research',
      ) &&
      (await page.getByRole('button', { name: 'Send to agent', exact: true }).isVisible())
    )
      break;
    await page.waitForTimeout(500);
  }
  await expect
    .poll(() => readFile(join(root, 'sections/notes.tex'), 'utf8'))
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
  await page.getByRole('button', { name: 'Review sections/notes.tex', exact: true }).click();
  const review = page.getByRole('region', { name: 'Changes in sections/notes.tex', exact: true });
  await expect(review.locator('.agent-diff-lines')).toContainText(
    'Clear writing supports reproducible research.',
  );
  await page.screenshot({
    path: resolve(
      `artifacts/phase-4-live-${codex ? 'codex' : process.env.LOOM_CLASSIC_EXECUTABLE ? 'classic' : 'next'}-creation-pdf.png`,
    ),
    animations: 'disabled',
  });
  await review.getByRole('button', { name: 'Undo file changes', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Undo agent changes' })
    .getByRole('button', { name: 'Undo changes', exact: true })
    .click();
  await expect
    .poll(() => readFile(join(root, 'sections/notes.tex'), 'utf8').catch(() => 'removed'))
    .toBe('removed');
  await page.getByRole('button', { name: 'Review main.tex', exact: true }).click();
  await page.getByRole('button', { name: 'Undo file changes', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Undo agent changes' })
    .getByRole('button', { name: 'Undo changes', exact: true })
    .click();
  await expect.poll(() => readFile(join(root, 'main.tex'), 'utf8')).toBe(source);
});
