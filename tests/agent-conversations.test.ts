import { describe, expect, it } from 'vitest';
import {
  mergeConversation,
  nativeSessionKey,
  readConversations,
  type ConversationRef,
} from '../src/services/agents/conversations';
import type { AgentMessage } from '../src/contracts/agent';
const message = (id: string, text = id): AgentMessage => ({
  id,
  role: 'assistant',
  text,
  state: '',
});
describe('Loom conversations', () => {
  it('migrates a legacy native reference without changing its identity or settings', () => {
    const settings = { permissionMode: 'supervised', reasoning: 'low' };
    const result = readConversations({
      version: 1,
      sessionId: 'native',
      sessions: [{ id: 'native', harness: 'opencode', title: 'Paper', settings }],
    });
    expect(result.sessions[0]).toMatchObject({
      id: 'native',
      nativeSessions: { opencode: 'native' },
      nativeSettings: { opencode: settings },
      history: [],
    });
    expect(() => readConversations({ ...result, version: 3 })).toThrow();
  });
  it('keeps colliding provider IDs separate and updates streaming output in place', () => {
    const ref: ConversationRef = { id: 'loom', title: 'Paper', harness: 'opencode' };
    mergeConversation(ref, 'opencode', 'same', [message('same', 'Partial')]);
    mergeConversation(ref, 'codex', 'same', [message('same', 'Codex')]);
    mergeConversation(ref, 'opencode', 'same', [message('same', 'Complete')]);
    expect(ref.history?.map((m) => m.text)).toEqual(['Complete', 'Codex']);
    expect(new Set(ref.history?.map((m) => m.id)).size).toBe(2);
    expect(nativeSessionKey('codex', 'same')).not.toBe(nativeSessionKey('opencode', 'same'));
  });
  it('does not replay evicted native history after switching providers or restarting', () => {
    let ref: ConversationRef = {
      id: 'loom',
      title: 'Paper',
      harness: 'opencode',
      nativeSessions: { opencode: 'o', codex: 'c' },
    };
    const older = Array.from({ length: 200 }, (_, i) => message(String(i)));
    mergeConversation(ref, 'opencode', 'o', older);
    mergeConversation(ref, 'codex', 'c', [message('c1', 'Newer Codex response')]);
    ref = readConversations(JSON.parse(JSON.stringify({ version: 2, sessions: [ref] })))
      .sessions[0];
    mergeConversation(ref, 'opencode', 'o', older);
    expect(ref.history).toHaveLength(200);
    expect(ref.history?.at(-1)?.text).toBe('Newer Codex response');
    expect(ref.history?.some((m) => m.text === '0')).toBe(false);
    mergeConversation(ref, 'opencode', 'o', [message('new', 'Newest response')]);
    expect(ref.history?.at(-1)?.text).toBe('Newest response');
  });
});

it('deletes the selected conversation persistently while preserving paper and recovery metadata', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { MetadataStore } = await import('../src/services/project/store');
  const { ProjectService } = await import('../src/services/project/projects');
  const { BuildService } = await import('../src/services/latex/builds');
  const { AgentService } = await import('../src/services/agents/service');
  const dir = await mkdtemp(join(tmpdir(), 'loom-delete-chat-'));
  await mkdir(join(dir, 'paper'));
  const path = join(dir, 'paper', 'main.tex');
  await writeFile(path, 'Author manuscript');
  const store = new MetadataStore(join(dir, 'data'));
  const projects = new ProjectService(store);
  const project = await projects.open(join(dir, 'paper'));
  store.set(
    `agent-sessions:${project.id}`,
    JSON.stringify({
      version: 2,
      sessionId: 'one',
      sessions: [
        {
          id: 'one',
          harness: 'opencode',
          title: 'First',
          nativeSessions: { opencode: 'native-one' },
        },
        { id: 'two', harness: 'codex', title: 'Second', nativeSessions: { codex: 'native-two' } },
      ],
    }),
  );
  store.set('recovery-sentinel', 'protected');
  const builds = new BuildService(projects, join(dir, 'builds'));
  let agents = new AgentService(projects, builds, join(dir, 'data'));
  try {
    await agents.initialize();
    const internal = agents as unknown as { state: { running: boolean } };
    internal.state.running = true;
    await expect(
      agents.command({ type: 'delete-session', projectId: project.id, sessionId: 'one' }),
    ).rejects.toThrow('Stop or recover');
    internal.state.running = false;
    const deleted = await agents.command({
      type: 'delete-session',
      projectId: project.id,
      sessionId: 'one',
    });
    expect(deleted.sessionId).toBeNull();
    expect(deleted.messages).toEqual([]);
    expect(deleted.sessions.map((ref) => ref.id)).toEqual(['two']);
    expect(await readFile(path, 'utf8')).toBe('Author manuscript');
    expect(store.get('recovery-sentinel')).toBe('protected');
    await agents.close();
    agents = new AgentService(projects, builds, join(dir, 'data'));
    await agents.initialize();
    const restarted = await agents.command({ type: 'status', projectId: project.id });
    expect(restarted.sessions.map((ref) => ref.id)).toEqual(['two']);
    await expect(
      agents.command({ type: 'delete-session', projectId: project.id, sessionId: 'one' }),
    ).rejects.toThrow('no longer available');
  } finally {
    await agents.close();
    builds.dispose();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it('renames local chats durably without changing native sessions, history or the manuscript', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { MetadataStore } = await import('../src/services/project/store');
  const { ProjectService } = await import('../src/services/project/projects');
  const { BuildService } = await import('../src/services/latex/builds');
  const { AgentService } = await import('../src/services/agents/service');
  const dir = await mkdtemp(join(tmpdir(), 'loom-rename-chat-'));
  await mkdir(join(dir, 'paper'));
  const path = join(dir, 'paper', 'main.tex');
  await writeFile(path, 'Author manuscript');
  const store = new MetadataStore(join(dir, 'data'));
  const projects = new ProjectService(store);
  const project = await projects.open(join(dir, 'paper'));
  const original = {
    id: 'one',
    harness: 'opencode',
    title: 'First',
    nativeSessions: { opencode: 'native-one' },
    history: [message('m1', 'Original exchange')],
  };
  const key = `agent-sessions:${project.id}`;
  store.set(key, JSON.stringify({ version: 2, sessionId: 'one', sessions: [original] }));
  const builds = new BuildService(projects, join(dir, 'builds'));
  let agents = new AgentService(projects, builds, join(dir, 'data'));
  try {
    await agents.initialize();
    const internal = agents as unknown as { state: { running: boolean } };
    internal.state.running = true;
    await expect(
      agents.command({
        type: 'rename-session',
        projectId: project.id,
        sessionId: 'one',
        title: 'Changed',
      }),
    ).rejects.toThrow('Stop or recover');
    internal.state.running = false;
    for (const title of ['', '   ', 'x'.repeat(301)]) {
      await expect(
        agents.command({ type: 'rename-session', projectId: project.id, sessionId: 'one', title }),
      ).rejects.toThrow('1 and 300');
    }
    await expect(
      agents.command({
        type: 'rename-session',
        projectId: project.id,
        sessionId: 'gone',
        title: 'Changed',
      }),
    ).rejects.toThrow('no longer available');
    const renamed = await agents.command({
      type: 'rename-session',
      projectId: project.id,
      sessionId: 'one',
      title: '  Literature review  ',
    });
    expect(renamed.sessions[0].title).toBe('Literature review');
    expect(renamed.sessionId).toBe('one');
    expect(JSON.parse(store.get(key)!).sessions[0]).toMatchObject({
      ...original,
      title: 'Literature review',
      titleEdited: true,
    });
    expect(await readFile(path, 'utf8')).toBe('Author manuscript');
    await agents.close();
    agents = new AgentService(projects, builds, join(dir, 'data'));
    await agents.initialize();
    expect(
      (await agents.command({ type: 'status', projectId: project.id })).sessions[0].title,
    ).toBe('Literature review');
    // A failed metadata write must leave the saved and published name intact.
    const set = store.set;
    store.set = () => {
      throw new Error('Synthetic storage failure');
    };
    try {
      await expect(
        agents.command({
          type: 'rename-session',
          projectId: project.id,
          sessionId: 'one',
          title: 'Unsaved',
        }),
      ).rejects.toThrow('Synthetic storage failure');
    } finally {
      store.set = set;
    }
    expect(
      (await agents.command({ type: 'status', projectId: project.id })).sessions[0].title,
    ).toBe('Literature review');
    expect(JSON.parse(store.get(key)!).sessions[0].title).toBe('Literature review');
  } finally {
    await agents.close();
    builds.dispose();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
