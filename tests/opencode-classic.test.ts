import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  OpenCodeClassicAdapter,
  supportedClassicVersion,
} from '../src/services/agents/opencode-classic';

it('uses the classic API for directory-bound turns, permissions, questions and terminal outcomes', async () => {
  const operations: Array<{
    method: string;
    path: string;
    directory: string | null;
    body: unknown;
  }> = [];
  let finish = 'tool-calls';
  let completed = Date.now() + 1000;
  let busy = false;
  let abortResult = true;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    let text = '';
    for await (const chunk of req) text += chunk.toString();
    const body = text ? JSON.parse(text) : undefined;
    operations.push({
      method: req.method!,
      path: url.pathname,
      directory: url.searchParams.get('directory'),
      body,
    });
    if (
      req.headers.authorization !==
      'Basic ' + Buffer.from('opencode:password').toString('base64')
    ) {
      res.writeHead(401).end();
      return;
    }
    const response: Record<string, unknown> = {
      '/global/health': { healthy: true, version: '1.19.0' },
      '/provider': {
        all: [
          {
            id: 'p',
            models: {
              m: {
                id: 'm',
                name: 'Model',
                capabilities: { input: { image: false }, toolcall: true },
                variants: { high: {} },
              },
            },
          },
          { id: 'offline', models: {} },
        ],
        connected: ['p'],
        default: { p: 'm' },
      },
      '/session': { id: 'ses_1', directory: '/paper' },
      '/session/ses_1': { id: 'ses_1', directory: '/paper', time: { created: 1 } },
      '/session/ses_1/message': [
        { info: { id: 'msg_1', role: 'user' }, parts: [{ type: 'text', text: 'Edit it' }] },
        {
          info: {
            id: 'msg_2',
            role: 'assistant',
            parentID: 'msg_1',
            time: { completed },
            finish,
          },
          parts: [
            { id: 'prt_1', type: 'tool', tool: 'edit', state: { status: 'completed' } },
            { type: 'text', text: 'Done' },
          ],
        },
      ],
      '/session/status': busy ? { ses_1: { type: 'busy' } } : {},
      '/session/ses_1/abort': abortResult,
      '/permission': [
        { id: 'per_1', sessionID: 'ses_1', permission: 'edit', patterns: ['paper.tex'] },
        { id: 'per_2', sessionID: 'other', permission: 'edit', patterns: [] },
      ],
      '/question': [
        {
          id: 'que_1',
          sessionID: 'ses_1',
          questions: [
            { header: 'Choice', question: 'Which?', options: [{ label: 'A' }], multiple: false },
          ],
        },
      ],
    };
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(response[url.pathname] ?? true));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address');
  const adapter = new OpenCodeClassicAdapter(`http://127.0.0.1:${address.port}`, 'password');
  try {
    expect(supportedClassicVersion('1.19.0')).toBe(true);
    expect(supportedClassicVersion('1.20.0')).toBe(false);
    await adapter.verify();
    const models = await adapter.models('/paper');
    expect(models).toEqual([
      {
        id: 'm',
        providerId: 'p',
        name: 'Model',
        images: false,
        tools: true,
        reasoningEfforts: ['high'],
      },
    ]);
    expect(await adapter.create('/paper')).toBe('ses_1');
    await adapter.submit('ses_1', 'Edit it', models[0], ['/paper/paper.tex'], {
      permissionMode: 'auto-accept-edits',
      reasoning: 'high',
    });
    const patch = operations.find((o) => o.method === 'PATCH');
    expect(patch?.body).toEqual({
      permission: [
        { permission: '*', pattern: '*', action: 'ask' },
        ...['read', 'glob', 'grep', 'list', 'question'].map((permission) => ({
          permission,
          pattern: '*',
          action: 'allow',
        })),
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' },
      ],
    });
    await adapter.submit('ses_1', 'Inspect', models[0], [], {
      permissionMode: 'supervised',
      reasoning: '',
    });
    const supervised = operations.filter((o) => o.method === 'PATCH').at(-1)!.body as {
      permission: Array<{ permission: string; action: string }>;
    };
    expect(supervised.permission.map((rule) => rule.permission)).toEqual([
      '*',
      'read',
      'glob',
      'grep',
      'list',
      'question',
    ]);
    const prompt = operations.find((o) => o.path.endsWith('/prompt_async'))!;
    expect(prompt.directory).toBe('/paper');
    expect(prompt.body).toMatchObject({
      agent: 'build',
      model: { providerID: 'p', modelID: 'm' },
      variant: 'high',
      parts: [
        { type: 'text', text: 'Edit it' },
        { type: 'file', url: 'file:///paper/paper.tex' },
      ],
    });
    expect((await adapter.pending('ses_1')).permissions).toEqual([
      { id: 'per_1', action: 'edit', resources: ['paper.tex'] },
    ]);
    await adapter.permission('ses_1', 'per_1', 'once');
    await adapter.answer('ses_1', 'que_1', { '0': 'A' });
    expect(operations.find((o) => o.path === '/question/que_1/reply')?.body).toEqual({
      answers: [['A']],
    });
    expect(await adapter.active('ses_1')).toBe(false);
    expect((await adapter.session('ses_1')).outcome).toBe('');
    finish = 'stop';
    expect(await adapter.session('ses_1')).toMatchObject({
      location: { directory: '/paper' },
      time: { idle: completed },
      outcome: 'succeeded',
    });
    expect(await adapter.messages('ses_1')).toContainEqual({
      id: 'msg_2:prt_1',
      role: 'tool',
      text: 'edit',
      state: 'completed',
    });
    // A previous successful message cannot settle a newly submitted turn.
    completed = 1;
    await adapter.submit('ses_1', 'Another edit', models[0], []);
    busy = true;
    await adapter.interrupt('ses_1');
    expect(await adapter.active('ses_1')).toBe(true);
    expect(await adapter.session('ses_1')).toMatchObject({ outcome: '', time: { idle: 0 } });
    // The daemon may write after accepting abort while still busy; release only after idle.
    const folder = await mkdtemp(join(tmpdir(), 'loom-abort-test-'));
    try {
      const paper = join(folder, 'paper.tex');
      await writeFile(paper, 'late native write');
      busy = false;
      expect(await adapter.active('ses_1')).toBe(false);
      expect(await adapter.session('ses_1')).toMatchObject({ outcome: 'interrupted' });
      expect(await readFile(paper, 'utf8')).toBe('late native write');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    // An idle server at abort time is not evidence that this request ever ran.
    await adapter.submit('ses_1', 'Early abort', models[0], []);
    await adapter.interrupt('ses_1');
    expect(await adapter.active('ses_1')).toBe(false);
    expect(await adapter.session('ses_1')).toMatchObject({ outcome: '', time: { idle: 0 } });
    abortResult = false;
    await expect(adapter.interrupt('ses_1')).rejects.toThrow('did not confirm');
    await expect(
      adapter.configureTools('/paper', 'http://127.0.0.1:1/mcp', 'token'),
    ).rejects.toThrow('attached');
  } finally {
    await adapter.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.skipIf(!process.env.LOOM_CLASSIC_PROBE)(
  'probes the installed classic server without inference',
  async () => {
    const { spawn } = await import('node:child_process');
    const { mkdtemp, rm, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const temp = await mkdtemp(join(tmpdir(), 'loom-classic-probe-'));
    const project = join(temp, 'paper');
    await mkdir(project);
    const child = spawn(
      process.env.LOOM_CLASSIC_PROBE!,
      ['serve', '--hostname', '127.0.0.1', '--port', '0'],
      {
        cwd: project,
        env: {
          ...process.env,
          OPENCODE_SERVER_PASSWORD: 'probe-password',
          OPENCODE_SERVER_USERNAME: 'opencode',
          XDG_CONFIG_HOME: join(temp, 'config'),
          XDG_DATA_HOME: join(temp, 'data'),
          XDG_CACHE_HOME: join(temp, 'cache'),
          XDG_STATE_HOME: join(temp, 'state'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let adapter: OpenCodeClassicAdapter | undefined;
    try {
      const endpoint = await new Promise<string>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(
          () => reject(new Error('server startup timeout: ' + output)),
          15000,
        );
        const read = (chunk: Buffer) => {
          output += chunk.toString();
          const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
          if (match) {
            clearTimeout(timer);
            resolve(match[0]);
          }
        };
        child.stdout.on('data', read);
        child.stderr.on('data', read);
        child.once('error', reject);
        child.once('exit', () => reject(new Error('server exited: ' + output)));
      });
      adapter = new OpenCodeClassicAdapter(endpoint, 'probe-password');
      await adapter.verify();
      expect(adapter.version).toMatch(/^1\.19\./);
      expect(Array.isArray(await adapter.models(project))).toBe(true);
      const id = await adapter.create(project);
      expect(await adapter.active(id)).toBe(false);
      expect(await adapter.session(id)).toMatchObject({
        location: { directory: project },
        outcome: '',
      });
      expect(await adapter.messages(id)).toEqual([]);
      expect(await adapter.pending(id)).toEqual({ permissions: [], questions: [] });
      await adapter.interrupt(id);
      expect(await adapter.active(id)).toBe(false);
    } finally {
      await adapter?.close();
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = new Promise<void>((resolve) => child.once('close', () => resolve()));
        child.kill('SIGTERM');
        await stopped;
      }
      await rm(temp, { recursive: true, force: true });
    }
  },
  30000,
);

it.skipIf(!process.env.LOOM_CLASSIC_PROBE)(
  'starts the real classic server through the owned factory without inference',
  async () => {
    const { OpenCodeAdapter } = await import('../src/services/agents/opencode');
    const dir = await mkdtemp(join(tmpdir(), 'loom-classic-owned-'));
    let adapter: Awaited<ReturnType<typeof OpenCodeAdapter.owned>> | undefined;
    try {
      adapter = await OpenCodeAdapter.owned(dir, process.env.LOOM_CLASSIC_PROBE);
      expect(adapter.version).toMatch(/^1\.19\./);
      const models = await adapter.models(dir);
      expect(Array.isArray(models)).toBe(true);
      const id = await adapter.create(dir);
      expect((await adapter.session(id)).location).toEqual({ directory: dir });
    } finally {
      await adapter?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  30000,
);

it.skipIf(!process.env.LOOM_CLASSIC_PROBE)(
  'connects the real classic server through AgentService without inference',
  async () => {
    const { AgentService } = await import('../src/services/agents/service');
    const { MetadataStore } = await import('../src/services/project/store');
    const { ProjectService } = await import('../src/services/project/projects');
    const { BuildService } = await import('../src/services/latex/builds');
    const dir = await mkdtemp(join(tmpdir(), 'loom-classic-service-'));
    const root = join(dir, 'paper');
    await (await import('node:fs/promises')).mkdir(root);
    await writeFile(
      join(root, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\nSynthetic.\n\\end{document}\n',
    );
    const store = new MetadataStore(join(dir, 'data'));
    const projects = new ProjectService(store);
    await projects.open(root);
    const agents = new AgentService(
      projects,
      new BuildService(projects, join(dir, 'builds')),
      join(dir, 'data'),
    );
    const projectId = projects.snapshot().id;
    try {
      const state = await agents.command({
        type: 'connect',
        projectId,
        harness: 'opencode',
        executable: process.env.LOOM_CLASSIC_PROBE,
      });
      expect(state.connection).toBe('connected');
      expect(state.version).toMatch(/^1\.19\./);
    } finally {
      await agents.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  30000,
);
