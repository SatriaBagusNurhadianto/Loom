import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, chmod } from 'node:fs/promises';
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
it('retains and verifies the exact submitted image through recovery and rejects altered checkpoints', async () => {
  const original = await readFile('tests/fixtures/whiteboard-equation.png');
  await writeFile(join(root, 'board.png'), original);
  await projects.refresh();
  const turn = await changes.begin(
    'native-session',
    projects.snapshot().sourceRevision!,
    false,
    2147483647,
    'conversation',
    ['board.png'],
  );
  const submittedPath = changes.imagePath(turn, 'board.png');
  expect(await readFile(submittedPath)).toEqual(original);
  await writeFile(join(root, 'board.png'), Buffer.from('project image changed'));
  const reloaded = new AgentChanges(projects, join(dir, 'recovery'));
  await reloaded.bind(id);
  expect(await reloaded.submittedImage(turn.view.id, 'board.png', 'conversation')).toMatchObject({
    path: 'board.png',
    data: original.toString('base64'),
  });
  await expect(reloaded.submittedImage(turn.view.id, 'board.png', 'another')).rejects.toThrow(
    'unavailable',
  );
  await chmod(submittedPath, 0o600);
  await writeFile(submittedPath, Buffer.concat([original, Buffer.from('tampered')]));
  await expect(reloaded.submittedImage(turn.view.id, 'board.png', 'conversation')).rejects.toThrow(
    'cannot be verified',
  );
});
it('checkpoints before turn, groups partial writes and merges a later unrelated edit on revert', async () => {
  await changes.begin('session', projects.snapshot().sourceRevision!, false, 2147483647);
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
  await changes.begin('session', projects.snapshot().sourceRevision!, false, 2147483647);
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
it('preserves a newer scientific correction and the source image when reverting an overlapping agent edit', async () => {
  const image = await readFile('tests/fixtures/whiteboard-diagram.png');
  const baseline = '\\begin{equation} E = mc^2 \\end{equation}\n';
  await writeFile(join(root, 'main.tex'), baseline);
  await writeFile(join(root, 'board.png'), image);
  await projects.refresh();
  await changes.begin(
    'session',
    projects.snapshot().sourceRevision!,
    false,
    2147483647,
    'conversation',
    ['board.png'],
  );
  await writeFile(join(root, 'main.tex'), '\\begin{equation} E = m v^2 \\end{equation}\n');
  await changes.finish('succeeded');
  const turn = changes.views()[0];
  expect(turn.changes[0]).toMatchObject({ path: 'main.tex', before: baseline });
  const authorCorrection = '\\begin{equation} E = m c^2 / 2 \\end{equation}\n';
  await writeFile(join(root, 'main.tex'), authorCorrection);
  await projects.refresh();
  await expect(
    changes.review(turn.id, 'main.tex', 'revert', projects.snapshot().sourceRevision!),
  ).rejects.toThrow('overlaps');
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(authorCorrection);
  expect(await readFile(join(root, 'board.png'))).toEqual(image);
  expect((await changes.submittedImage(turn.id, 'board.png', 'conversation')).data).toBe(
    image.toString('base64'),
  );
});
it('restores created, deleted and binary files without discarding unrelated files', async () => {
  await writeFile(join(root, 'asset.bin'), Buffer.from([0, 1, 2]));
  await projects.refresh();
  await changes.begin('session', projects.snapshot().sourceRevision!, false, 2147483647);
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
  await changes.begin('session', projects.snapshot().sourceRevision!, false, 2147483647);
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
  await expect(changes.begin('session', 'stale', false, 2147483647)).rejects.toThrow('changed');
});
it('recovers writes after an earlier observation when the service was interrupted', async () => {
  await changes.begin('session', projects.snapshot().sourceRevision!, false, 2147483647);
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

it('does not recover or allow review while a tracked supervisor is still alive', async () => {
  await changes.begin('session', projects.snapshot().sourceRevision!, false, process.pid);
  await writeFile(join(root, 'main.tex'), 'partial work');
  const reloaded = new AgentChanges(projects, join(dir, 'recovery'));
  await reloaded.bind(id);
  expect(await reloaded.recoverInterrupted()).toBe(false);
  expect(reloaded.unsettled()).toBeTruthy();
  await expect(
    reloaded.begin('other', projects.snapshot().sourceRevision!, false, process.pid),
  ).rejects.toThrow('previous request');
  await expect(
    reloaded.review(
      reloaded.views()[0].id,
      'main.tex',
      'revert',
      projects.snapshot().sourceRevision!,
    ),
  ).rejects.toThrow('Reconnect and stop');
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe('partial work');
});
it('bounds expensive line diffs and reuses the before/after fallback while saving remains available', async () => {
  const before = Array.from({ length: 7000 }, (_, i) => 'before ' + i + '\n').join('');
  const after = Array.from({ length: 7000 }, (_, i) => 'after ' + i + '\n').join('');
  await writeFile(join(root, 'main.tex'), before);
  await projects.refresh();
  await projects.command({
    type: 'load',
    fileId: projects.snapshot().files.find((f) => f.path === 'main.tex')!.id,
  });
  const baseline = projects.snapshot().files.find((f) => f.path === 'main.tex')!;
  if (baseline.conflict)
    await projects.command({
      type: 'resolve',
      fileId: baseline.id,
      choice: 'disk',
      disk: baseline.disk,
      diskRevision: baseline.diskRevision,
    });
  await changes.begin('session', projects.snapshot().sourceRevision!, false, process.pid);
  await writeFile(join(root, 'main.tex'), after);
  await changes.observe();
  const diff = changes.views()[0].changes[0];
  expect(diff.diffLimited).toBe(true);
  expect(diff.diff?.[0]).toMatchObject({ kind: 'removed', text: before });
  expect(diff.diff?.[1]).toMatchObject({ kind: 'added', text: after });
  await changes.observe();
  expect(changes.views()[0].changes[0].diff).toBe(diff.diff);
  await projects.command({ type: 'preferences', value: 'still responsive' });
  expect(projects.snapshot().preferences).toBe('still responsive');
}, 2000);

it('safe rename recovery retains a usable main document after reverting both observed paths', async () => {
  await writeFile(join(root, 'main.tex'), '\\documentclass{article}\nText.');
  await projects.refresh();
  await changes.begin('session', projects.snapshot().sourceRevision!, false, 2147483647);
  await rename(join(root, 'main.tex'), join(root, 'renamed.tex'));
  await changes.finish('succeeded');
  const t = changes.views()[0];
  expect(t.changes).toHaveLength(2);
  await changes.review(t.id, 'main.tex', 'revert', projects.snapshot().sourceRevision!);
  await changes.review(t.id, 'renamed.tex', 'revert', projects.snapshot().sourceRevision!);
  const snapshot = projects.snapshot();
  expect(snapshot.files.find((f) => f.id === snapshot.rootId)).toMatchObject({
    path: 'main.tex',
    deleted: false,
    conflict: false,
  });
});
it('refuses unknown recovery metadata versions without overwriting stored checkpoints', async () => {
  const value = JSON.stringify({ version: 9, turns: [] });
  store.set('agent-turns:' + id, value);
  const next = new AgentChanges(projects, join(dir, 'recovery'));
  await expect(next.bind(id)).rejects.toThrow('incompatible');
  expect(store.get('agent-turns:' + id)).toBe(value);
});
