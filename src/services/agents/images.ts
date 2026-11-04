import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { imageMime } from '../../domain/images';

export function imageBytesMatch(mime: string, head: Uint8Array): boolean {
  const bytes = Buffer.from(head);
  if (bytes.length < 12) return false;
  return mime === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mime === 'image/gif'
        ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
        : mime === 'image/webp' &&
          bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP';
}

/** Validate bytes before the native harness is given a paper-relative image. */
export async function validateImage(root: string, path: string) {
  const mime = imageMime(path);
  if (!mime) throw new Error('Unsupported image format.');
  const actualRoot = await realpath(root);
  const actual = await realpath(resolve(actualRoot, path));
  const rel = relative(actualRoot, actual);
  if (
    !rel ||
    rel === '..' ||
    rel.startsWith('..' + sep) ||
    isAbsolute(rel) ||
    actual !== resolve(actualRoot, path)
  )
    throw new Error('Image must be a regular file inside this paper, without symlinks.');
  const file = await open(actual, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024 || stat.size < 12)
      throw new Error('Image must be a regular file no larger than 10 MiB.');
    const head = Buffer.alloc(12);
    await file.read(head, 0, head.length, 0);
    if (!imageBytesMatch(mime, head))
      throw new Error('The image contents do not match its file type.');
  } finally {
    await file.close();
  }
}
