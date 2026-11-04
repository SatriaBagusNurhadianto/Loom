import { constants, promises as fs } from 'node:fs';
import { isAbsolute } from 'node:path';
import { findExecutable } from '../latex/tools';

export async function harnessExecutable(name: string, override?: string): Promise<string | null> {
  if (!override) return findExecutable(name);
  if (!isAbsolute(override))
    throw new Error(
      'Use the full absolute path to the agent executable, or leave it empty for automatic detection.',
    );
  try {
    await fs.access(override, constants.X_OK);
    if ((await fs.stat(override)).isFile()) return override;
  } catch {
    /* Report one actionable error without exposing native command output. */
  }
  throw new Error(
    'The agent executable is not accessible. Check the binary path in Runtime settings.',
  );
}
