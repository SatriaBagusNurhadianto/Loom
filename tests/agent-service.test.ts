import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '../src/contracts/agent';
import { AgentService } from '../src/services/agents/service';

type Internals = {
  adapter: unknown;
  state: unknown;
  changes: unknown;
  projects: unknown;
  generation: number;
  refreshBusy: boolean;
  refresh: () => Promise<void>;
  disconnect: () => Promise<void>;
  tools: unknown;
};
function fixture(adapter: object) {
  const service = Object.create(AgentService.prototype) as Internals;
  const turn = { view: { startedAt: '2026-11-04T00:00:00.000Z' } };
  const changes = {
    running: () => turn,
    unsettledExternal: () => undefined,
    observe: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    views: () => [],
  };
  const state = {
    projectId: 'paper',
    sessionId: 'session',
    running: true,
    connection: 'connected',
    permissions: [],
    questions: [],
    turns: [],
    error: '',
  };
  Object.assign(service, {
    adapter,
    changes,
    state,
    generation: 0,
    refreshBusy: false,
    tools: null,
    projects: { run: async (f: () => Promise<void>) => f() },
  });
  return { service, state, changes };
}
const start = Date.parse('2026-11-04T00:00:00.000Z');
function native(idle: number, outcome = 'succeeded') {
  return {
    ownership: 'external',
    messages: vi.fn(async (): Promise<AgentMessage[]> => []),
    pending: vi.fn(async () => ({ permissions: [], questions: [] })),
    active: vi.fn(async () => false),
    session: vi.fn(async () => ({ time: { created: start - 2000, updated: idle, idle }, outcome })),
    interrupt: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}
describe('Agent service native execution boundaries', () => {
  it('ignores an earlier idle record until the current native request finishes', async () => {
    const adapter = native(start - 1);
    const { service, state, changes } = fixture(adapter);
    await service.refresh();
    expect(state.running).toBe(true);
    expect(changes.finish).not.toHaveBeenCalled();
    adapter.session.mockResolvedValue({
      time: { created: start - 2000, updated: start + 1, idle: start + 1 },
      outcome: 'succeeded',
    });
    await service.refresh();
    expect(state.running).toBe(false);
    expect(changes.finish).toHaveBeenCalledWith('succeeded');
  });
  it('shows the original author request, including newlines, instead of the native context wrapper', async () => {
    const adapter = native(start - 1);
    const prompt = 'Question\nwith a second line';
    adapter.messages.mockResolvedValue([
      {
        id: 'message',
        role: 'user',
        text: `You are helping with the research paper “Paper”. Context.\n\nLoom author request (${prompt.length} characters):\n${prompt}\n\nAuthor-selected passage: private`,
        state: '',
      },
    ]);
    const { service, state } = fixture(adapter);
    await service.refresh();
    expect(state).toMatchObject({ messages: [{ text: prompt }] });
  });
  it('observes only after the owned process has closed when disconnecting', async () => {
    const events: string[] = [];
    const adapter = {
      ...native(start - 1),
      ownership: 'loom',
      active: vi.fn(async () => {
        throw new Error('lost');
      }),
      close: vi.fn(async () => {
        events.push('closed');
      }),
    };
    const { service, changes } = fixture(adapter);
    changes.finish.mockImplementation(async () => {
      events.push('observed');
    });
    await service.disconnect();
    expect(events).toEqual(['closed', 'observed']);
  });
  it('keeps a failed external stop unresolved and does not take a final checkpoint', async () => {
    const adapter = {
      ...native(start - 1),
      active: vi.fn(async () => {
        throw new Error('lost');
      }),
    };
    const { service, state, changes } = fixture(adapter);
    await expect(service.disconnect()).rejects.toThrow('has not confirmed');
    expect(state.running).toBe(true);
    expect(changes.finish).not.toHaveBeenCalled();
    expect(adapter.close).not.toHaveBeenCalled();
  });
});

it('does not finalize native work from an interrupted transport or a synthetic local status', async () => {
  const adapter = native(start + 1);
  const { service, state, changes } = fixture(adapter);
  state.connection = 'interrupted';
  await service.refresh();
  expect(changes.finish).not.toHaveBeenCalled();
  expect(adapter.active).not.toHaveBeenCalled();
  expect(state.running).toBe(true);
});
