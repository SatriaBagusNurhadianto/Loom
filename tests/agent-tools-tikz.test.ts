import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { BuildService } from '../src/services/latex/builds';
import { AgentTools } from '../src/services/agents/tools';

it.skipIf(process.env.LOOM_LATEX_LIVE !== '1')(
  'builds an externally edited TikZ diagram through MCP with real TeX',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-tikz-'));
    const root = join(dir, 'paper');
    await mkdir(root);
    const path = join(root, 'main.tex');
    await writeFile(
      path,
      '\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\nBefore\n\\end{document}\n',
    );
    const store = new MetadataStore(join(dir, 'data'));
    const projects = new ProjectService(store);
    await projects.open(root);
    const id = projects.snapshot().id;
    const builds = new BuildService(projects, join(dir, 'builds'));
    const tools = await new AgentTools(projects, builds, id).start();
    try {
      const edited =
        '\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\\draw (0,0) -- (2,2);\\node at (1,1) {DIAGRAMMARKER};\\end{tikzpicture}\n\\end{document}\n';
      await writeFile(path, edited);
      const response = await fetch(tools.url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'build_pdf', arguments: {} },
        }),
      });
      const body = await response.text();
      expect(response.status, body).toBe(200);
      await builds.idle(id);
      const state = await builds.status(id);
      expect(state.current?.status, state.current?.log).toBe('succeeded');
      expect(
        await readFile(join(builds.artifact(id, state.successful!.id).source, 'main.tex'), 'utf8'),
      ).toBe(edited);
      expect(state.successful?.revision).toBe(projects.snapshot().sourceRevision);
      const pdf = builds.artifact(id, state.successful!.id).pdf;
      if (process.env.LOOM_TIKZ_RENDER)
        execFileSync('pdftoppm', [
          '-f',
          '1',
          '-singlefile',
          '-scale-to',
          '1000',
          '-png',
          pdf,
          process.env.LOOM_TIKZ_RENDER,
        ]);
      expect(execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' })).toContain(
        'DIAGRAMMARKER',
      );
    } finally {
      await tools.close();
      builds.dispose();
      await builds.idle(id);
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  60000,
);

it.skipIf(process.env.LOOM_AGENT_INFERENCE !== '1')(
  'actual managed OpenCode edits and builds a synthetic TikZ diagram through Loom MCP',
  async () => {
    const { AgentService } = await import('../src/services/agents/service');
    const dir = await mkdtemp(join(tmpdir(), 'loom-agent-tikz-'));
    const root = join(dir, 'paper');
    await mkdir(root);
    await writeFile(
      join(root, 'main.tex'),
      '\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\nInitial text.\n\\end{document}\n',
    );
    const store = new MetadataStore(join(dir, 'data'));
    const projects = new ProjectService(store);
    await projects.open(root);
    const builds = new BuildService(projects, join(dir, 'builds'));
    const agents = new AgentService(projects, builds, join(dir, 'data'));
    const id = projects.snapshot().id;
    try {
      let state = await agents.command({ type: 'connect', projectId: id, harness: 'opencode' });
      const server = (agents as unknown as { tools: { server: import('node:http').Server } }).tools
        .server;
      const calls: string[] = [];
      server.on('request', (req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.once('finish', () => {
          try {
            const call = JSON.parse(body);
            if (call.method === 'tools/call') calls.push(`${call.params.name}:${res.statusCode}`);
          } catch {
            /* Ignore transport notifications. */
          }
        });
      });
      const model = state.models.find(
        (m) => m.providerId === 'opencode' && m.id === 'big-pickle' && m.tools,
      );
      expect(model).toBeTruthy();
      state = await agents.command({
        type: 'settings',
        projectId: id,
        settings: { permissionMode: 'auto-accept-edits', reasoning: '' },
      });
      state = await agents.command({ type: 'session', projectId: id });
      state = await agents.command({
        type: 'send',
        projectId: id,
        sessionId: state.sessionId!,
        model: model!,
        attachments: ['main.tex'],
        selection: null,
        revision: projects.snapshot().sourceRevision!,
        prompt:
          'Edit main.tex: replace Initial text. with a TikZ diagram consisting of a visible drawn triangle and a node containing DIAGRAMMARKER. Preserve the preamble and document structure. Then invoke the Loom build_pdf MCP tool, and poll Loom pdf_status to confirm its result. Do not use shell compilation or browser tools. Report the result.',
      });
      const until = Date.now() + 120_000;
      while (state.running && Date.now() < until) {
        for (const p of state.permissions)
          await agents.command({
            type: 'permission',
            projectId: id,
            requestId: p.id,
            reply: 'once',
          });
        await new Promise((resolve) => setTimeout(resolve, 500));
        state = await agents.command({ type: 'status', projectId: id });
      }
      expect(
        state.running,
        JSON.stringify({ calls, messages: state.messages, error: state.error }),
      ).toBe(false);
      expect(calls, JSON.stringify(state.messages)).toContain('build_pdf:200');
      await builds.idle(id);
      const result = await builds.status(id);
      expect(
        result.current?.status,
        JSON.stringify({ calls, log: result.current?.log, messages: state.messages }),
      ).toBe('succeeded');
      expect(
        execFileSync('pdftotext', [builds.artifact(id, result.successful!.id).pdf, '-'], {
          encoding: 'utf8',
        }),
      ).toContain('DIAGRAMMARKER');
      if (process.env.LOOM_AGENT_TIKZ_RENDER)
        execFileSync('pdftoppm', [
          '-f',
          '1',
          '-singlefile',
          '-scale-to',
          '1000',
          '-png',
          builds.artifact(id, result.successful!.id).pdf,
          process.env.LOOM_AGENT_TIKZ_RENDER,
        ]);
      expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('tikzpicture');
    } finally {
      await agents.close();
      builds.dispose();
      await builds.idle(id);
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  150_000,
);
