import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { CodexAdapter } from '../src/services/agents/codex';

type Internals = {
  sessions: Map<string, unknown>;
  earlyEvents: Map<string, unknown[]>;
  pendingRPC: Map<number, unknown>;
  child: EventEmitter & {
    stdin: { write: (s: string) => void; end: () => void };
    exitCode: number | null;
    signalCode: string | null;
  };
  receive: (value: unknown) => void;
  rpc: (method: string, params: unknown) => Promise<unknown>;
  ended: boolean;
};
function fixture() {
  const adapter = Object.create(CodexAdapter.prototype) as Pick<CodexAdapter, keyof CodexAdapter> &
    Internals;
  adapter.sessions = new Map();
  adapter.earlyEvents = new Map();
  adapter.pendingRPC = new Map();
  adapter.ended = false;
  const child = new EventEmitter() as Internals['child'];
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.exitCode = null;
  child.signalCode = null;
  adapter.child = child;
  return { adapter, child };
}

describe('Codex adapter protocol boundaries', () => {
  it('replays early turn, stream and approval events and sends native decisions', async () => {
    const { adapter, child } = fixture();
    adapter.rpc = vi.fn(async () => ({ thread: { id: 'thread' } }));
    adapter.receive({
      method: 'turn/started',
      params: { threadId: 'thread', turn: { id: 'turn' } },
    });
    adapter.receive({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread', itemId: 'item', delta: 'Hello' },
    });
    adapter.receive({
      id: 99,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread', command: 'inspect', availableDecisions: ['accept', 'decline'] },
    });
    expect(await adapter.create('/paper')).toBe('thread');
    expect(await adapter.active('thread')).toBe(true);
    expect(await adapter.messages('thread')).toMatchObject([{ text: 'Hello' }]);
    expect((await adapter.pending('thread')).permissions[0].id).toBe('99');
    await adapter.permission('thread', '99', 'reject');
    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ id: 99, result: { decision: 'decline' } }) + '\n',
    );
    await adapter.interrupt('thread');
    expect(adapter.rpc).toHaveBeenCalledWith('turn/interrupt', {
      threadId: 'thread',
      turnId: 'turn',
    });
    expect(await adapter.active('thread')).toBe(true);
    adapter.receive({
      method: 'turn/completed',
      params: { threadId: 'thread', turn: { id: 'turn', status: 'interrupted' } },
    });
    expect(await adapter.active('thread')).toBe(false);
    expect((await adapter.session('thread')).outcome).toBe('interrupted');
  });
  it('retains an existing live session and restores active resumed turns and history', async () => {
    const { adapter } = fixture();
    adapter.rpc = vi.fn(async () => ({
      thread: {
        cwd: '/paper',
        status: { type: 'active' },
        turns: [
          {
            id: 'turn',
            status: 'inProgress',
            items: [{ id: 'old', type: 'agentMessage', text: 'Earlier' }],
          },
        ],
      },
    }));
    await adapter.resume('thread', '/paper');
    expect(await adapter.active('thread')).toBe(true);
    expect(await adapter.messages('thread')).toMatchObject([{ text: 'Earlier' }]);
    await adapter.resume('thread', '/paper');
    expect(adapter.rpc).toHaveBeenCalledTimes(1);
    await expect(adapter.resume('thread', '/other')).rejects.toThrow('another paper');
  });
  it('waits for the supervised child to exit before close resolves', async () => {
    const { adapter, child } = fixture();
    let settled = false;
    const closing = adapter.close().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.stdin.end).toHaveBeenCalled();
    child.emit('close');
    await closing;
    expect(settled).toBe(true);
  });
});
