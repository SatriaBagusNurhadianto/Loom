import { afterEach, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { createAgentWorkspace } from '../src/renderer/agent/workspace';
import type { ProjectWorkspace } from '../src/renderer/editor/documents';
import type { AgentCommand, AgentResult } from '../src/contracts/agent';
import type { ProjectSnapshot } from '../src/contracts/project';
vi.mock('solid-js', () => vi.importActual<typeof import('solid-js')>('solid-js/dist/solid.js'));
let dispose: () => void;
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
});

it('starts restoration for the next paper even while the previous status request is pending', async () => {
  const pending: Array<{ command: AgentCommand; resolve: (value: AgentResult) => void }> = [];
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => {} },
    loom: {
      onServiceEvent: () => () => {},
      agent: (command: AgentCommand) =>
        new Promise<AgentResult>((resolve) => pending.push({ command, resolve })),
    },
  });
  const { agent, setProject } = createRoot((cleanup) => {
    dispose = cleanup;
    const [project, setProject] = createSignal({ id: 'first-paper' } as ProjectSnapshot);
    const agent = createAgentWorkspace({ project } as ProjectWorkspace, () => {});
    return { agent, setProject };
  });
  expect(pending.map(({ command }) => command.projectId)).toEqual(['first-paper']);
  expect(agent.initializing()).toBe(true);
  setProject({ id: 'second-paper' } as ProjectSnapshot);
  expect(pending.map(({ command }) => command.projectId)).toEqual(['first-paper', 'second-paper']);
  pending[0].resolve({
    ok: false,
    error: { code: 'synthetic', message: 'Old status', retryable: true },
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(agent.initializing()).toBe(true);
  await agent.refresh();
  expect(pending).toHaveLength(2);
  pending[1].resolve({
    ok: false,
    error: { code: 'synthetic', message: 'New status', retryable: true },
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(agent.initializing()).toBe(false);
});
