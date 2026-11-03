import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAdapter } from '../src/services/agents/opencode';
import { CodexAdapter } from '../src/services/agents/codex';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { BuildService } from '../src/services/latex/builds';
import { AgentService } from '../src/services/agents/service';
const live = process.env.LOOM_AGENT_LIVE === '1';
it.skipIf(!live)(
  'connects actual owned OpenCode and Codex processes, catalogs and project-bound sessions without inference',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-harness-live-'));
    let open: OpenCodeAdapter | undefined, codex: CodexAdapter | undefined;
    try {
      await writeFile(join(dir, 'main.tex'), 'Synthetic paper.');
      open = await OpenCodeAdapter.owned(dir);
      expect(open.version).toBe('2.2.1');
      expect((await open.models(dir)).length).toBeGreaterThan(0);
      const id = await open.create(dir);
      expect((await open.session(id)).location).toMatchObject({ directory: dir });
      expect(await open.pending(id)).toEqual({ permissions: [], questions: [] });
      expect(await open.messages(id)).toEqual([]);
      expect(await open.active(id)).toBe(false);
      await open.stream();
      codex = await CodexAdapter.owned(dir);
      expect(codex.version).toMatch(/^0\.159\./);
      expect((await codex.models(dir)).length).toBeGreaterThan(0);
      const thread = await codex.create(dir);
      expect((await codex.session(thread)).location).toMatchObject({ directory: dir });
      await codex.resume(thread, dir);
      expect(await codex.active(thread)).toBe(false);
    } finally {
      await open?.close();
      await codex?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  40000,
);
it.skipIf(!live)(
  'connects actual OpenCode through AgentService with supported runtime MCP registration',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-agent-service-'));
    const root = join(dir, 'paper');
    await mkdir(root);
    await writeFile(join(root, 'main.tex'), 'Synthetic paper.');
    const store = new MetadataStore(join(dir, 'data'));
    const projects = new ProjectService(store);
    await projects.open(root);
    const builds = new BuildService(projects, join(dir, 'builds'));
    const agents = new AgentService(projects, builds, join(dir, 'data'));
    try {
      const id = projects.snapshot().id;
      const state = await agents.command({ type: 'connect', projectId: id, harness: 'opencode' });
      expect(state).toMatchObject({ connection: 'connected', toolsAvailable: true });
      const chat = await agents.command({ type: 'session', projectId: id });
      expect(chat.sessionId).toBeTruthy();
      expect(chat.sessions[0].harness).toBe('opencode');
      expect((await agents.command({ type: 'status', projectId: id })).connection).toBe(
        'connected',
      );
    } finally {
      await agents.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  40000,
);
