import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitService } from '../src/services/git/service';
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
});
