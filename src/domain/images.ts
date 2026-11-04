/** Image formats accepted by the native agent adapters. */
export function imageMime(path: string): string | null {
  const extension = path.toLowerCase().split('.').pop();
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
      } as Record<string, string>
    )[extension ?? ''] ?? null
  );
}
