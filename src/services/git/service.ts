import { basename, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import type { GitCommand, GitValue } from '../../contracts/git';
import { findExecutable, runTool } from '../latex/tools';

const outputLimit = 200_000;
const fileLimit = 5000;
type GitContext = { root: string; projectId: string; paths: string[] };

export async function cloneRepository(url: string, destination: string): Promise<void> {
  const executable = await findExecutable('git');
  if (!executable) throw new Error('Git is unavailable. Install Git and reopen Loom.');
  const parent = await fs.realpath(resolve(destination, '..'));
  if (parent !== resolve(destination, '..'))
    throw new Error('Choose a regular destination folder.');
  try {
    await fs.lstat(destination);
    throw new Error('The clone destination already exists. Choose a new folder.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const result = await runTool(executable, ['clone', '--', url, destination], {
    cwd: parent,
    timeoutMs: 240_000,
  });
  if (result.code !== 0)
    throw new Error(
      'Git clone failed. Check the network, remote access, and your existing Git credential helper or SSH setup. Any partial destination was left in place for inspection.',
    );
}
const privatePath = (path: string) =>
  /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519|\.loom|\.codex|\.opencode|userData|recovery|conversations|metadata\.sqlite|node_modules|\.cache|\.DS_Store|\.ssh|credentials|secrets)(?:\/|$)/i.test(
    path,
  ) ||
  /(^|\/)(?:out|release|artifacts|coverage|dist|\.turbo)(\/|$)/i.test(path) ||
  /\.(?:log|sqlite|sqlite3|db-wal|db-shm)$/i.test(path);
const safeGitOutput = (text: string) =>
  text
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[credentials hidden]@')
    .replace(/(ssh:\/\/)[^/@\s]+@/gi, '$1[credentials hidden]@');

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

  async command(command: GitCommand): Promise<GitValue> {
    const context = this.contextFor(command.projectId);
    if (command.type === 'preflight' || command.type === 'archive')
      throw new Error('Source exports must use the snapshot export service.');
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
          indexTree: null,
          branches: [],
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
          indexTree: null,
          branches: [],
        };
      const status = await runTool(
        executable,
        ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--renames'],
        { cwd: context.root, timeoutMs: 15_000, maxOutputBytes: 8 * 1024 * 1024 },
      );
      if (status.code !== 0) throw new Error(status.output.slice(-1000) || 'Git status failed.');
      const parsed = parseStatus(status.stdout);
      const gitPath = await runTool(executable, ['rev-parse', '--git-path', 'MERGE_HEAD'], {
        cwd: context.root,
        timeoutMs: 10_000,
      });
      const mergeHead =
        gitPath.code === 0
          ? resolve(context.root, gitPath.stdout.trim())
          : resolve(context.root, '.git', 'MERGE_HEAD');
      const merge = await fs.access(mergeHead).then(
        () => true,
        () => false,
      );
      const treeResult = await runTool(executable, ['write-tree'], {
        cwd: context.root,
        timeoutMs: 10_000,
      });
      const indexTree = treeResult.code === 0 ? treeResult.stdout.trim() : null;
      const branchResult = await runTool(executable, ['branch', '--format=%(refname:short)'], {
        cwd: context.root,
        timeoutMs: 10_000,
      });
      return {
        kind: 'status' as const,
        repository: true,
        rootName: basename(root.stdout.trim()),
        branch: parsed.branch,
        upstream: parsed.upstream,
        detached: parsed.detached,
        mergeInProgress: merge,
        ahead: parsed.ahead,
        behind: parsed.behind,
        files: parsed.files.slice(0, fileLimit),
        truncated: parsed.truncated || status.stdout.length >= 8 * 1024 * 1024,
        gitAvailable: true,
        indexTree,
        branches:
          branchResult.code === 0
            ? branchResult.stdout.split(/\r?\n/).filter(Boolean).slice(0, 500)
            : [],
      };
    }
    if (
      command.type === 'diff' ||
      command.type === 'stage' ||
      command.type === 'unstage' ||
      command.type === 'resolve'
    ) {
      const tracked = context.paths.includes(command.path);
      if (!tracked) throw new Error('Choose a file in the open project.');
      if (command.type === 'diff') {
        const conflictStage = { base: '1', ours: '2', theirs: '3' } as const;
        let args: string[];
        if (command.area in conflictStage)
          args = [
            'show',
            `:${conflictStage[command.area as keyof typeof conflictStage]}:${command.path}`,
          ];
        else if (command.area === 'worktree') {
          const tracked = await runTool(
            executable,
            ['ls-files', '--error-unmatch', '--', command.path],
            { cwd: context.root, timeoutMs: 10_000 },
          );
          args =
            tracked.code === 0
              ? ['diff', '--no-ext-diff', '--no-color', '--', command.path]
              : [
                  'diff',
                  '--no-index',
                  '--no-ext-diff',
                  '--no-color',
                  '--',
                  process.platform === 'win32' ? 'NUL' : '/dev/null',
                  command.path,
                ];
        } else args = ['diff', '--cached', '--no-ext-diff', '--no-color', '--', command.path];
        const diff = await runTool(executable, args, {
          cwd: context.root,
          timeoutMs: 15_000,
          maxOutputBytes: outputLimit + 1,
        });
        if (diff.code !== 0 && !(command.area === 'worktree' && diff.code === 1))
          throw new Error('Git could not read this diff. Refresh status and retry.');
        const text = diff.stdout.slice(0, outputLimit);
        return {
          kind: 'diff' as const,
          path: command.path,
          area: command.area,
          text,
          binary:
            text.includes('\0') ||
            text.includes('Binary files ') ||
            text.includes('GIT binary patch'),
          truncated: diff.stdout.length > outputLimit,
        };
      }
      if (command.type === 'resolve') {
        const unmerged = await runTool(executable, ['ls-files', '-u', '-z', '--', command.path], {
          cwd: context.root,
          timeoutMs: 10_000,
        });
        if (unmerged.code !== 0 || !unmerged.stdout)
          throw new Error(
            'This path is no longer an unresolved merge conflict. Refresh repository status.',
          );
        if (command.choice === 'working') {
          const content = await fs.readFile(resolve(context.root, command.path));
          if (content.includes(0))
            throw new Error(
              'This is a binary conflict. Choose Use ours or Use theirs to resolve it.',
            );
          const text = content.toString('utf8');
          if (/^(?:<<<<<<< |=======\s*$|>>>>>>> )/m.test(text))
            throw new Error(
              'Conflict markers remain. Edit the file in the source pane, save it, then mark the edited file resolved.',
            );
        } else {
          const checkout = await runTool(
            executable,
            ['checkout', command.choice === 'ours' ? '--ours' : '--theirs', '--', command.path],
            { cwd: context.root, timeoutMs: 15_000 },
          );
          if (checkout.code !== 0)
            throw new Error(`Git could not select ${command.choice} for this conflict.`);
        }
        const add = await runTool(executable, ['add', '--', command.path], {
          cwd: context.root,
          timeoutMs: 30_000,
        });
        if (add.code !== 0)
          throw new Error(
            'The resolved file could not be added to the Git index. Review the file and retry.',
          );
        return this.command({ type: 'status', projectId: command.projectId });
      }
      if (command.type === 'stage' && privatePath(command.path))
        throw new Error(
          'This path may contain private or generated data. Review and move it outside the project before staging.',
        );
      const result = await runTool(
        executable,
        command.type === 'stage'
          ? ['add', '--', command.path]
          : ['restore', '--staged', '--', command.path],
        { cwd: context.root, timeoutMs: 30_000 },
      );
      if (result.code !== 0)
        throw new Error(result.output.slice(-1000) || `Could not ${command.type} this path.`);
      return this.command({ type: 'status', projectId: command.projectId });
    }
    if (command.type === 'commit') {
      const tree = await runTool(executable, ['write-tree'], {
        cwd: context.root,
        timeoutMs: 10_000,
      });
      if (tree.code !== 0)
        throw new Error('The Git index is empty or invalid. Stage the files you reviewed first.');
      if (tree.stdout.trim() !== command.expectedIndexTree)
        throw new Error(
          'The staged files changed after review. Refresh and review the current staged diff before committing.',
        );
      const names = await runTool(executable, ['diff', '--cached', '--name-only', '-z'], {
        cwd: context.root,
        timeoutMs: 10_000,
      });
      if (names.code !== 0) throw new Error('Could not inspect the staged file list.');
      const paths = names.stdout.split('\0').filter(Boolean);
      if (!paths.length) throw new Error('There are no staged changes to commit.');
      const unsafe = paths.filter(privatePath);
      if (unsafe.length)
        throw new Error(
          `The existing Git index contains paths that may be private or generated: ${unsafe.slice(0, 5).join(', ')}. Unstage them explicitly, then review again.`,
        );
      const confirmTree = await runTool(executable, ['write-tree'], {
        cwd: context.root,
        timeoutMs: 10_000,
      });
      if (confirmTree.code !== 0 || confirmTree.stdout.trim() !== command.expectedIndexTree)
        throw new Error(
          'The Git index changed during commit review. Refresh the staged diff and retry.',
        );
      const result = await runTool(executable, ['commit', '-m', command.message], {
        cwd: context.root,
        timeoutMs: 120_000,
      });
      if (result.code !== 0)
        throw new Error(
          safeGitOutput(result.output.slice(-1500)) ||
            'Commit failed. Check Git identity, hooks and the staged diff.',
        );
      return this.command({ type: 'status', projectId: command.projectId });
    }
    if (command.type === 'fetch' || command.type === 'pull' || command.type === 'push') {
      if (command.type === 'pull' || command.type === 'push') {
        const state = await this.command({ type: 'status', projectId: command.projectId });
        if (state.kind !== 'status' || !state.repository || state.detached)
          throw new Error('This operation needs an attached branch in a Git repository.');
        if (command.type === 'pull' && state.files.length)
          throw new Error(
            'Save or commit the working-tree changes before pull. Loom will not stash or discard them.',
          );
        if (command.type === 'push' && !state.upstream)
          throw new Error(
            'No upstream is configured. Push this branch with an upstream using Git, then refresh.',
          );
        if (command.type === 'pull' && !state.upstream)
          throw new Error(
            'No upstream is configured. Configure a tracking branch using Git, then refresh.',
          );
      }
      const args = command.type === 'pull' ? ['pull', '--no-rebase'] : [command.type];
      const result = await runTool(executable, args, { cwd: context.root, timeoutMs: 180_000 });
      if (result.code !== 0)
        throw new Error(
          safeGitOutput(result.output.slice(-1800)) ||
            `${command.type} failed. Check network, credentials and repository state.`,
        );
      return this.command({ type: 'status', projectId: command.projectId });
    }
    if (command.type === 'branch') {
      const state = await this.command({ type: 'status', projectId: command.projectId });
      if (state.kind !== 'status' || !state.repository || state.files.length)
        throw new Error('Commit or safely recover all changes before changing branches.');
      const checked = await runTool(executable, ['check-ref-format', '--branch', command.name], {
        cwd: context.root,
        timeoutMs: 10_000,
      });
      if (checked.code !== 0) throw new Error('Enter a valid branch name.');
      const args =
        command.action === 'switch' ? ['switch', command.name] : ['switch', '-c', command.name];
      const result = await runTool(executable, args, { cwd: context.root, timeoutMs: 30_000 });
      if (result.code !== 0)
        throw new Error(safeGitOutput(result.output.slice(-1000)) || 'Branch change failed.');
      return this.command({ type: 'status', projectId: command.projectId });
    }
    throw new Error('Unsupported Git operation.');
  }
}
