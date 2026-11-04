import { basename, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import type { GitCommand } from '../../contracts/git';
import { findExecutable, runTool } from '../latex/tools';

const outputLimit = 200_000;
const fileLimit = 5000;
type GitContext = { root: string; projectId: string; paths: string[] };

function parseStatus(raw: string) {
  const fields = raw.split('\0');
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0,
    behind = 0,
    detached = false;
  const files: {
    path: string;
    index: ' ' | 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?' | '!';
    worktree: ' ' | 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?' | '!';
    originalPath: string | null;
  }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const row = fields[i]!;
    if (!row) continue;
    if (row.startsWith('## ')) {
      const header = row.slice(3);
      detached = header.startsWith('HEAD ');
      const match = /^(.+?)(?:\.\.\.(.+?))?(?: \[(.*)\])?$/.exec(header);
      branch = detached ? null : (match?.[1] ?? null);
      upstream = match?.[2] ?? null;
      const counts = /ahead (\d+)|behind (\d+)/g;
      for (const count of header.matchAll(counts)) {
        if (count[1]) ahead = Number(count[1]);
        if (count[2]) behind = Number(count[2]);
      }
      continue;
    }
    const x = row[0] ?? ' ',
      y = row[1] ?? ' ';
    if (row.startsWith('?? ') || row.startsWith('!! ')) {
      files.push({
        path: row.slice(3),
        index: row[0] === '?' ? '?' : '!',
        worktree: row[0] === '?' ? '?' : '!',
        originalPath: null,
      });
      continue;
    }
    const path = row.slice(3);
    let originalPath: string | null = null;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') originalPath = fields[++i] || null;
    files.push({ path, index: x as never, worktree: y as never, originalPath });
  }
  return { branch, upstream, ahead, behind, detached, files, truncated: files.length > fileLimit };
}

export class GitService {
  constructor(private readonly contextFor: (projectId: string) => GitContext) {}

  async command(command: GitCommand) {
    const context = this.contextFor(command.projectId);
    const executable = await findExecutable('git');
    if (!executable) {
      if (command.type === 'status')
        return {
          kind: 'status' as const,
          repository: false,
          rootName: null,
          branch: null,
          upstream: null,
          detached: false,
          mergeInProgress: false,
          ahead: 0,
          behind: 0,
          files: [],
          truncated: false,
          gitAvailable: false,
        };
      throw new Error('Git is unavailable. Install Git and reopen Loom.');
    }
    if (command.type === 'status') {
      const root = await runTool(executable, ['rev-parse', '--show-toplevel'], {
        cwd: context.root,
        timeoutMs: 10_000,
      });
      if (root.code !== 0)
        return {
          kind: 'status' as const,
          repository: false,
          rootName: null,
          branch: null,
          upstream: null,
          detached: false,
          mergeInProgress: false,
          ahead: 0,
          behind: 0,
          files: [],
          truncated: false,
          gitAvailable: true,
        };
      const status = await runTool(
        executable,
        ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--renames'],
        { cwd: context.root, timeoutMs: 15_000 },
      );
      if (status.code !== 0) throw new Error(status.output.slice(-1000) || 'Git status failed.');
      const parsed = parseStatus(status.output);
      const merge = await fs.access(resolve(context.root, '.git', 'MERGE_HEAD')).then(
        () => true,
        () => false,
      );
      const allPaths = context.paths;
      return {
        kind: 'status' as const,
        repository: true,
        rootName: basename(root.output.trim()),
        branch: parsed.branch,
        upstream: parsed.upstream,
        detached: parsed.detached,
        mergeInProgress: merge,
        ahead: parsed.ahead,
        behind: parsed.behind,
        files: parsed.files.slice(0, fileLimit),
        truncated: parsed.truncated,
        gitAvailable: true,
        knownProjectInputs: allPaths.length,
      };
    }
    const tracked = context.paths.includes(command.path);
    if (!tracked) throw new Error('Choose a file in the open project.');
    const args =
      command.area === 'index'
        ? ['diff', '--cached', '--no-ext-diff', '--', command.path]
        : ['diff', '--no-ext-diff', '--', command.path];
    const diff = await runTool(executable, args, { cwd: context.root, timeoutMs: 15_000 });
    if (diff.code !== 0) throw new Error(diff.output.slice(-1000) || 'Git diff failed.');
    const text = diff.output.slice(0, outputLimit);
    return {
      kind: 'diff' as const,
      path: command.path,
      area: command.area,
      text,
      binary: text.includes('Binary files ') || text.includes('GIT binary patch'),
      truncated: diff.output.length > outputLimit,
    };
  }
}
