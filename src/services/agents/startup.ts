/** Accept only a complete native server announcement, never a partial port or unrelated log URL. */
export function openCodeServerEndpoint(output: string): string | undefined {
  return output.match(
    /(?:^|\n)[^\r\n]*server listening on (http:\/\/127\.0\.0\.1:\d+)\s*\r?\n/i,
  )?.[1];
}
