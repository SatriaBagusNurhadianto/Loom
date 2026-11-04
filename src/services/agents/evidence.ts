const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Normalize only native shell activity; a model's narrative is never execution evidence. */
export function executionEvidence(command: unknown, output: unknown, exitCode: unknown) {
  if (typeof command !== 'string' || !command) return undefined;
  const result = typeof output === 'string' ? output : null;
  return {
    command: command.slice(0, 8000),
    output: result === null ? null : result.slice(0, 20000),
    exitCode: typeof exitCode === 'number' && Number.isSafeInteger(exitCode) ? exitCode : null,
    truncated: command.length > 8000 || (result !== null && result.length > 20000),
  };
}
export function openCodeExecution(name: string, raw: Record<string, unknown>, classic: boolean) {
  if (!['bash', 'shell'].includes(name.toLowerCase())) return undefined;
  const input = record(raw.input);
  let content = '';
  if (Array.isArray(raw.content))
    for (const part of raw.content) {
      const value = record(part);
      if (value.type !== 'text' || typeof value.text !== 'string' || !value.text) continue;
      content += (content ? '\n' : '') + value.text.slice(0, 20001 - content.length);
      if (content.length > 20000) break;
    }
  const output = classic ? (raw.output ?? raw.error) : content || undefined;
  return executionEvidence(input.command, output, null);
}
