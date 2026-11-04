import { expect, it, vi } from 'vitest';
import { executionEvidence, openCodeExecution } from '../src/services/agents/evidence';
import { AgentService } from '../src/services/agents/service';

it('uses only native shell input and reported output, with bounded content', () => {
  expect(
    openCodeExecution(
      'bash',
      {
        status: 'completed',
        input: { command: 'python -c "print(2)"' },
        content: [{ type: 'text', text: '2\n' }],
      },
      false,
    ),
  ).toEqual({ command: 'python -c "print(2)"', output: '2\n', exitCode: null, truncated: false });
  expect(
    openCodeExecution(
      'bash',
      { status: 'error', input: { command: 'false' }, error: 'failed' },
      true,
    ),
  ).toMatchObject({ command: 'false', output: 'failed' });
  expect(
    openCodeExecution('edit', { input: { command: 'not a command event' } }, true),
  ).toBeUndefined();
  expect(executionEvidence('x', 'a'.repeat(20001), null)).toMatchObject({
    truncated: true,
    output: 'a'.repeat(20000),
  });
  expect(executionEvidence(undefined, 'unattributed output', 0)).toBeUndefined();
});

it('does not copy native command details into Loom conversation storage', () => {
  const set = vi.fn();
  const service = Object.create(AgentService.prototype) as { persist(): void };
  Object.assign(service, {
    projects: { store: { set } },
    projectId: 'paper',
    persisted: '',
    state: { sessionId: 'chat', harness: 'codex' },
    sessions: [
      {
        id: 'chat',
        harness: 'codex',
        title: 'Chat',
        history: [
          {
            id: 'tool',
            role: 'tool',
            text: 'Command',
            state: 'completed',
            execution: {
              command: 'private input',
              output: 'private result',
              exitCode: 0,
              truncated: false,
            },
          },
        ],
      },
    ],
  });
  service.persist();
  const serialized = String(set.mock.calls[0][1]);
  expect(serialized).not.toContain('private input');
  expect(serialized).not.toContain('private result');
  expect(serialized).toContain('Command');
});
