import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { AgentChanges } from '../src/services/agents/changes';
let dir: string,
  root: string,
  store: MetadataStore,
  projects: ProjectService,
  changes: AgentChanges,
  id: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loom-agent-'));
  root = join(dir, 'paper');
  await mkdir(root);
  await writeFile(join(root, 'main.tex'), 'alpha\nbeta\ngamma\n');
  store = new MetadataStore(join(dir, 'data'));
  projects = new ProjectService(store);
  await projects.open(root);
  id = projects.snapshot().id;
  changes = new AgentChanges(projects, join(dir, 'recovery'));
  await changes.bind(id);
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});
it('checkpoints before turn, groups partial writes and merges a later unrelated edit on revert', async () => {
  await changes.begin('session', projects.snapshot().sourceRevision!);
  await writeFile(join(root, 'main.tex'), 'changed\nbeta\ngamma\n');
  await changes.finish('cancelled');
  const turn = changes.views()[0];
  expect(turn.status).toBe('cancelled');
  expect(turn.changes).toMatchObject([
    { path: 'main.tex', before: 'alpha\nbeta\ngamma\n', after: 'changed\nbeta\ngamma\n' },
  ]);
  await writeFile(join(root, 'main.tex'), 'changed\nbeta\ngamma\nauthor addition\n');
  await projects.refresh();
  await changes.review(turn.id, 'main.tex', 'revert', projects.snapshot().sourceRevision!);
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(
    'alpha\nbeta\ngamma\nauthor addition\n',
  );
});
it('refuses overlapping newer writing and preserves disk and checkpoints', async () => {
  await changes.begin('session', projects.snapshot().sourceRevision!);
  await writeFile(join(root, 'main.tex'), 'changed\nbeta\ngamma\n');
  await changes.finish('succeeded');
  await writeFile(join(root, 'main.tex'), 'human\nbeta\ngamma\n');
  await projects.refresh();
  await expect(
    changes.review(
      changes.views()[0].id,
      'main.tex',
      'revert',
      projects.snapshot().sourceRevision!,
    ),
  ).rejects.toThrow('overlaps');
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('human');
});
it('restores created, deleted and binary files without discarding unrelated files', async () => {
  await writeFile(join(root, 'asset.bin'), Buffer.from([0, 1, 2]));
  await projects.refresh();
  await changes.begin('session', projects.snapshot().sourceRevision!);
  await rm(join(root, 'main.tex'));
  await writeFile(join(root, 'new.tex'), 'new');
  await writeFile(join(root, 'asset.bin'), Buffer.from([0, 3, 4]));
  await changes.finish('failed');
  const t = changes.views()[0];
  expect(t.changes).toHaveLength(3);
  for (const path of ['main.tex', 'new.tex', 'asset.bin'])
    await changes.review(t.id, path, 'revert', projects.snapshot().sourceRevision!);
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('alpha');
  expect(await readFile(join(root, 'asset.bin'))).toEqual(Buffer.from([0, 1, 2]));
  expect(projects.snapshot().files.find((f) => f.path === 'new.tex')?.deleted).toBe(true);
});
it('recovers an interrupted pre-turn baseline after service restart', async () => {
  await changes.begin('session', projects.snapshot().sourceRevision!);
  await writeFile(join(root, 'main.tex'), 'partial\nbeta\ngamma\n');
  const reloaded = new AgentChanges(projects, join(dir, 'recovery'));
  await reloaded.bind(id);
  await reloaded.recoverInterrupted();
  expect(reloaded.views()[0]).toMatchObject({
    status: 'interrupted',
    changes: [{ path: 'main.tex', after: 'partial\nbeta\ngamma\n' }],
  });
});
it('refuses stale launch/revert revisions, unsafe endpoint and invalid paths', async () => {
  await expect(changes.begin('session', 'stale')).rejects.toThrow('changed');
});
it('recovers writes after an earlier observation when the service was interrupted', async () => {
  await changes.begin('session', projects.snapshot().sourceRevision!);
  await writeFile(join(root, 'main.tex'), 'first change');
  await changes.observe();
  await writeFile(join(root, 'main.tex'), 'final partial change');
  await writeFile(join(root, 'second.tex'), 'partial second file');
  const reloaded = new AgentChanges(projects, join(dir, 'recovery'));
  await reloaded.bind(id);
  await reloaded.recoverInterrupted();
  expect(reloaded.views()[0].changes).toMatchObject([
    { path: 'main.tex', after: 'final partial change' },
    { path: 'second.tex', after: 'partial second file' },
  ]);
});
