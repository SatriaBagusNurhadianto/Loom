export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly disposition: 'rejected' | 'unknown',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentRequestError';
  }
}

export function agentRequestError(harness: string, error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  const status =
    cause && typeof cause === 'object' && 'status' in cause && typeof cause.status === 'number'
      ? cause.status
      : null;
  const disposition = status !== null && status >= 400 && status < 500 ? 'rejected' : 'unknown';
  const rejectionAdvice =
    status === 413
      ? 'The request is too large. Use a smaller image or shorten the prompt, then retry.'
      : status === 401
        ? 'Check provider sign-in, then retry.'
        : status === 403
          ? 'Check provider/model access, then retry.'
          : 'Check provider access or request details, then retry.';
  const message =
    status !== null
      ? disposition === 'rejected'
        ? `${harness} rejected the request (HTTP ${status}). ${rejectionAdvice}`
        : `${harness} returned HTTP ${status}. The request outcome is uncertain; check the conversation before retrying.`
      : `${harness} could not complete the request. The outcome is uncertain; reconnect and inspect the conversation before retrying.`;
  return new AgentRequestError(message, status, disposition, { cause: error });
}
