import { expect, it } from 'vitest';
import { openCodeServerEndpoint } from '../src/services/agents/startup';
import { harnessExecutable } from '../src/services/agents/runtime';
import { codexTurnPolicy } from '../src/services/agents/codex';

it('waits for a complete native announcement when a port is split across stdout chunks', () => {
  expect(openCodeServerEndpoint('Tool connecting http://127.0.0.1:1234\n')).toBeUndefined();
  expect(openCodeServerEndpoint('opencode server listening on http://127.0.0.1:4')).toBeUndefined();
  expect(openCodeServerEndpoint('opencode server listening on http://127.0.0.1:4096\n')).toBe(
    'http://127.0.0.1:4096',
  );
});
it('validates explicit executable paths and maps permission choices to native Codex policies', async () => {
  await expect(harnessExecutable('codex', './codex')).rejects.toThrow('absolute path');
  expect(codexTurnPolicy({ permissionMode: 'supervised', reasoning: '' })).toMatchObject({
    approvalPolicy: 'untrusted',
    sandboxPolicy: { type: 'readOnly' },
  });
  expect(codexTurnPolicy({ permissionMode: 'auto-accept-edits', reasoning: '' })).toMatchObject({
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: { type: 'workspaceWrite' },
  });
  expect(codexTurnPolicy({ permissionMode: 'auto', reasoning: '' }).approvalsReviewer).toBe(
    'auto_review',
  );
  expect(codexTurnPolicy({ permissionMode: 'full-access', reasoning: '' })).toMatchObject({
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
  });
});
