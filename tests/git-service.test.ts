import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneRepository, GitService } from '../src/services/git/service';
import { findExecutable, runTool } from '../src/services/latex/tools';

const roots: string[] = [];
async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'loom-git-'));
  roots.push(root);
  const git = await findExecutable('git');
  if (!git) return null;
  for (const args of [
    ['init', '-q', root],
    ['-C', root, 'config', 'user.name', 'Loom Test'],
    ['-C', root, 'config', 'user.email', 'loom@example.invalid'],
  ]) {
    const result = await runTool(git, args);
    if (result.code !== 0) throw new Error(result.output);
  }
  return { root, git };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Git status and diff service', () => {
  it('reports branch, untracked Unicode paths, and distinct index/worktree diffs', async () => {
    const setup = await repository();
    if (!setup) return;
    const path = 'draft λ.tex';
    await writeFile(join(setup.root, path), 'first line\n');
    let result = await runTool(setup.git, ['-C', setup.root, 'add', '--', path]);
    expect(result.code).toBe(0);
    result = await runTool(setup.git, ['-C', setup.root, 'commit', '-qm', 'baseline']);
    expect(result.code).toBe(0);
    await writeFile(join(setup.root, path), 'staged line\n');
    result = await runTool(setup.git, ['-C', setup.root, 'add', '--', path]);
    expect(result.code).toBe(0);
    await writeFile(join(setup.root, path), 'working line\n');
    await writeFile(join(setup.root, 'new notes.md'), 'not staged\n');
    const service = new GitService(() => ({
      root: setup.root,
      projectId: 'p',
      paths: [path, 'new notes.md'],
    }));
    const status = await service.command({ type: 'status', projectId: 'p' });
    expect(status).toMatchObject({
      kind: 'status',
      repository: true,
      branch: expect.any(String),
      files: expect.arrayContaining([
        expect.objectContaining({ path, index: 'M', worktree: 'M' }),
        expect.objectContaining({ path: 'new notes.md', index: '?', worktree: '?' }),
      ]),
    });
    const index = await service.command({ type: 'diff', projectId: 'p', path, area: 'index' });
    const worktree = await service.command({
      type: 'diff',
      projectId: 'p',
      path,
      area: 'worktree',
    });
    expect(index).toMatchObject({ kind: 'diff', text: expect.stringContaining('staged line') });
    expect(worktree).toMatchObject({ kind: 'diff', text: expect.stringContaining('working line') });
    const untracked = await service.command({
      type: 'diff',
      projectId: 'p',
      path: 'new notes.md',
      area: 'worktree',
    });
    expect(untracked).toMatchObject({ kind: 'diff', text: expect.stringContaining('not staged') });
  });

  it('does not treat an ordinary project folder as a repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-no-git-'));
    roots.push(root);
    const service = new GitService(() => ({ root, projectId: 'p', paths: [] }));
    await expect(service.command({ type: 'status', projectId: 'p' })).resolves.toMatchObject({
      kind: 'status',
      repository: false,
    });
  });

  it('stages only the chosen path and rejects a commit after the reviewed index changes', async () => {
    const setup = await repository();
    if (!setup) return;
    await writeFile(join(setup.root, 'a.tex'), 'old a\n');
    await writeFile(join(setup.root, 'b.tex'), 'old b\n');
    let result = await runTool(setup.git, ['-C', setup.root, 'add', '--', 'a.tex', 'b.tex']);
    expect(result.code).toBe(0);
    result = await runTool(setup.git, ['-C', setup.root, 'commit', '-qm', 'baseline']);
    expect(result.code).toBe(0);
    await writeFile(join(setup.root, 'a.tex'), 'new a\n');
    await writeFile(join(setup.root, 'b.tex'), 'new b\n');
    const service = new GitService(() => ({
      root: setup.root,
      projectId: 'p',
      paths: ['a.tex', 'b.tex'],
    }));
    await service.command({ type: 'stage', projectId: 'p', path: 'a.tex' });
    const staged = await service.command({ type: 'status', projectId: 'p' });
    expect(staged).toMatchObject({
      kind: 'status',
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'a.tex', index: 'M', worktree: ' ' }),
        expect.objectContaining({ path: 'b.tex', index: ' ', worktree: 'M' }),
      ]),
    });
    if (staged.kind !== 'status' || !staged.indexTree) throw new Error('Missing index tree.');
    await service.command({ type: 'stage', projectId: 'p', path: 'b.tex' });
    await expect(
      service.command({
        type: 'commit',
        projectId: 'p',
        message: 'reviewed a only',
        expectedIndexTree: staged.indexTree,
      }),
    ).rejects.toThrow(/changed after review/);
  });

  it('blocks sensitive staged paths instead of silently changing the index', async () => {
    const setup = await repository();
    if (!setup) return;
    await writeFile(join(setup.root, '.env'), 'TOKEN=synthetic\n');
    const result = await runTool(setup.git, ['-C', setup.root, 'add', '--', '.env']);
    expect(result.code).toBe(0);
    const service = new GitService(() => ({ root: setup.root, projectId: 'p', paths: ['.env'] }));
    const status = await service.command({ type: 'status', projectId: 'p' });
    if (status.kind !== 'status' || !status.indexTree) throw new Error('Missing staged tree.');
    await expect(
      service.command({
        type: 'commit',
        projectId: 'p',
        message: 'private',
        expectedIndexTree: status.indexTree,
      }),
    ).rejects.toThrow(/may be private/);
    expect(
      await runTool(setup.git, ['-C', setup.root, 'diff', '--cached', '--name-only']),
    ).toMatchObject({ output: '.env\n' });
  });

  it('commits only the reviewed index and creates a branch without pushing', async () => {
    const setup = await repository();
    if (!setup) return;
    await writeFile(join(setup.root, 'main.tex'), 'baseline\n');
    let result = await runTool(setup.git, ['-C', setup.root, 'add', '--', 'main.tex']);
    expect(result.code).toBe(0);
    result = await runTool(setup.git, ['-C', setup.root, 'commit', '-qm', 'baseline']);
    expect(result.code).toBe(0);
    await writeFile(join(setup.root, 'main.tex'), 'revision\n');
    const service = new GitService(() => ({
      root: setup.root,
      projectId: 'p',
      paths: ['main.tex'],
    }));
    await service.command({ type: 'stage', projectId: 'p', path: 'main.tex' });
    const staged = await service.command({ type: 'status', projectId: 'p' });
    if (staged.kind !== 'status' || !staged.indexTree) throw new Error('Missing staged index.');
    const commit = await service.command({
      type: 'commit',
      projectId: 'p',
      message: 'reviewed update',
      expectedIndexTree: staged.indexTree,
    });
    expect(commit).toMatchObject({ kind: 'status', files: [] });
    result = await runTool(setup.git, ['-C', setup.root, 'log', '-1', '--format=%s']);
    expect(result.output.trim()).toBe('reviewed update');
    await service.command({
      type: 'branch',
      projectId: 'p',
      name: 'codex/reviewed-work',
      action: 'create',
    });
    const branch = await service.command({ type: 'status', projectId: 'p' });
    expect(branch).toMatchObject({ kind: 'status', branch: 'codex/reviewed-work' });
  });

  it('clones a local bare remote into a new destination and preserves failure destinations', async () => {
    const git = await findExecutable('git');
    if (!git) return;
    const parent = await mkdtemp(join(tmpdir(), 'loom-clone-'));
    roots.push(parent);
    const source = join(parent, 'source');
    const bare = join(parent, 'remote.git');
    const destination = join(parent, 'paper');
    await mkdir(source);
    await writeFile(join(source, 'main.tex'), 'portable source\n');
    for (const args of [
      ['init', '-q', source],
      ['-C', source, 'config', 'user.name', 'Loom Test'],
      ['-C', source, 'config', 'user.email', 'loom@example.invalid'],
      ['-C', source, 'add', '--', 'main.tex'],
      ['-C', source, 'commit', '-qm', 'portable'],
      ['init', '--bare', '-q', bare],
      ['-C', source, 'remote', 'add', 'origin', bare],
      ['-C', source, 'push', '-qu', 'origin', 'HEAD'],
    ]) {
      const result = await runTool(git, args);
      expect(result.code).toBe(0);
    }
    await cloneRepository(bare, destination);
    expect(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(join(destination, 'main.tex'), 'utf8'),
      ),
    ).toBe('portable source\n');
  });

  it('shows merge base/ours/theirs and keeps conflict stages until a resolved file is staged', async () => {
    const setup = await repository();
    if (!setup) return;
    await writeFile(join(setup.root, 'main.tex'), 'base\n');
    let result = await runTool(setup.git, ['-C', setup.root, 'add', '--', 'main.tex']);
    expect(result.code).toBe(0);
    result = await runTool(setup.git, ['-C', setup.root, 'commit', '-qm', 'base']);
    expect(result.code).toBe(0);
    result = await runTool(setup.git, ['-C', setup.root, 'branch', 'theirs']);
    expect(result.code).toBe(0);
    result = await runTool(setup.git, ['-C', setup.root, 'switch', 'theirs']);
    expect(result.code).toBe(0);
    await writeFile(join(setup.root, 'main.tex'), 'theirs\n');
    result = await runTool(setup.git, ['-C', setup.root, 'commit', '-qam', 'theirs']);
    expect(result.code).toBe(0);
    result = await runTool(setup.git, ['-C', setup.root, 'switch', '-']);
    expect(result.code).toBe(0);
    await writeFile(join(setup.root, 'main.tex'), 'ours\n');
    result = await runTool(setup.git, ['-C', setup.root, 'commit', '-qam', 'ours']);
    expect(result.code).toBe(0);
    result = await runTool(setup.git, ['-C', setup.root, 'merge', 'theirs']);
    expect(result.code).toBe(1);
    const service = new GitService(() => ({
      root: setup.root,
      projectId: 'p',
      paths: ['main.tex'],
    }));
    expect(await service.command({ type: 'status', projectId: 'p' })).toMatchObject({
      kind: 'status',
      mergeInProgress: true,
      files: [expect.objectContaining({ path: 'main.tex', index: 'U' })],
    });
    expect(
      await service.command({ type: 'diff', projectId: 'p', path: 'main.tex', area: 'base' }),
    ).toMatchObject({ text: 'base\n' });
    expect(
      await service.command({ type: 'diff', projectId: 'p', path: 'main.tex', area: 'ours' }),
    ).toMatchObject({ text: 'ours\n' });
    expect(
      await service.command({ type: 'diff', projectId: 'p', path: 'main.tex', area: 'theirs' }),
    ).toMatchObject({ text: 'theirs\n' });
    await expect(
      service.command({ type: 'resolve', projectId: 'p', path: 'main.tex', choice: 'working' }),
    ).rejects.toThrow(/markers remain/);
    await writeFile(join(setup.root, 'main.tex'), 'resolved\n');
    const resolved = await service.command({
      type: 'resolve',
      projectId: 'p',
      path: 'main.tex',
      choice: 'working',
    });
    expect(resolved).toMatchObject({
      kind: 'status',
      mergeInProgress: true,
      files: [expect.objectContaining({ path: 'main.tex', index: 'M', worktree: ' ' })],
    });
  });
});
