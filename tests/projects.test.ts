import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Y from 'yjs';
import { zipSync, strToU8 } from 'fflate';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { reconcile } from '../src/services/project/reconcile';
import { projectCommandSchema } from '../src/contracts/project';
let dir: string, root: string, store: MetadataStore, service: ProjectService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loom-project-'));
  root = join(dir, '论文');
  await mkdir(root);
  await writeFile(join(root, 'main.tex'), 'alpha\nbeta\ngamma\n');
  store = new MetadataStore(join(dir, 'data'));
  service = new ProjectService(store);
  await service.open(root);
  await service.command({ type: 'load', fileId: service.snapshot().files[0].id });
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  await rm(dir, { recursive: true, force: true });
});
async function edit(text: string) {
  const f = service.snapshot().files[0],
    doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(f.update));
  doc.getText('source').delete(0, doc.getText('source').length);
  doc.getText('source').insert(0, text);
  return {
    type: 'sync' as const,
    fileId: f.id,
    update: Array.from(Y.encodeStateAsUpdate(doc)),
    baseline: f.baseline,
    text,
  };
}
describe('ordinary projects and persistence', () => {
  it('native file creation validates identity, containment, symlinks and existing files', async () => {
    const projectId = service.snapshot().id;
    await expect(service.createFile(join(dir, 'outside.tex'), projectId)).rejects.toThrow(
      'inside the open project',
    );
    await expect(service.createFile(join(root, 'main.tex'), 'stale-project')).rejects.toThrow(
      'project changed',
    );
    await expect(service.createFile(join(root, 'main.tex'), projectId)).rejects.toThrow();
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe('alpha\nbeta\ngamma\n');
    await symlink(dir, join(root, 'linked'));
    await expect(service.createFile(join(root, 'linked', 'escape.tex'), projectId)).rejects.toThrow(
      'Symbolic links',
    );
    const snapshot = await service.createFile(join(root, '章节', 'new.tex'), projectId);
    expect(snapshot?.files.some((f) => f.path === '章节/new.tex')).toBe(true);
    expect(await readFile(join(root, '章节', 'new.tex'), 'utf8')).toBe('');
  });
  it('saves, checkpoints, reopens and retains stable IDs on non-ASCII rename', async () => {
    const id = service.snapshot().files[0].id;
    await service.command(await edit('new text'));
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe('new text');
    await service.command({ type: 'rename', fileId: id, path: '章节/导论.tex' });
    store.close();
    store = new MetadataStore(join(dir, 'data'));
    service = new ProjectService(store);
    await service.current();
    const reopened = await service.command({ type: 'load', fileId: id });
    expect(reopened?.files[0]).toMatchObject({
      id,
      path: '章节/导论.tex',
      text: 'new text',
      saved: true,
    });
  });
  it('merges disjoint edits and suppresses duplicate observations', async () => {
    const command = await edit('ALPHA\nbeta\ngamma\n');
    await writeFile(join(root, 'main.tex'), 'alpha\nbeta\nGAMMA\n');
    await service.command(command);
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe('ALPHA\nbeta\nGAMMA\n');
    const before = service.snapshot().files[0].update;
    await service.command({ type: 'refresh' });
    expect(service.snapshot().files[0].update).toEqual(before);
  });
  it('preserves overlap inputs and resolves explicitly', async () => {
    const command = await edit('human\nbeta\ngamma\n');
    await writeFile(join(root, 'main.tex'), 'external\nbeta\ngamma\n');
    await service.command(command);
    let f = service.snapshot().files[0];
    expect(f).toMatchObject({
      conflict: true,
      text: 'human\nbeta\ngamma\n',
      disk: 'external\nbeta\ngamma\n',
      baseline: 'alpha\nbeta\ngamma\n',
      saved: false,
    });
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('external');
    await service.command({
      type: 'resolve',
      fileId: f.id,
      choice: 'local',
      disk: f.disk,
      diskRevision: f.diskRevision,
    });
    f = service.snapshot().files[0];
    expect(f.saved).toBe(true);
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('human');
  });
  it('retains recovery after interrupted atomic write and detects reopen divergence', async () => {
    const command = await edit('human');
    const fs = await import('node:fs');
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('interrupted'));
    await expect(service.command(command)).rejects.toThrow('interrupted');
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('alpha');
    await writeFile(join(root, 'main.tex'), 'external');
    store.close();
    store = new MetadataStore(join(dir, 'data'));
    service = new ProjectService(store);
    await service.open(root);
    await service.command({ type: 'load', fileId: service.snapshot().files[0].id });
    expect(service.snapshot().files[0]).toMatchObject({
      text: 'human',
      disk: 'external',
      conflict: true,
    });
  });
  it('detects external rename and deletion, restores deleted binary assets', async () => {
    const id = service.snapshot().files[0].id;
    await rename(join(root, 'main.tex'), join(root, 'moved.tex'));
    await service.command({ type: 'refresh' });
    expect(service.snapshot().files[0]).toMatchObject({ id, path: 'moved.tex' });
    await rm(join(root, 'moved.tex'));
    await service.command({ type: 'refresh' });
    expect(service.snapshot().files[0].conflict).toBe(true);
    await service.command({
      type: 'resolve',
      fileId: id,
      choice: 'local',
      disk: null,
      diskRevision: service.snapshot().files[0].diskRevision,
    });
    expect(await readFile(join(root, 'moved.tex'), 'utf8')).toContain('alpha');
    await writeFile(join(root, 'image.bin'), Buffer.from([0, 255, 3]));
    await service.command({ type: 'refresh' });
    const asset = service.snapshot().files.find((f) => f.path === 'image.bin')!;
    await service.command({ type: 'delete', fileId: asset.id });
    await service.command({ type: 'restore', fileId: asset.id });
    expect(await readFile(join(root, 'image.bin'))).toEqual(Buffer.from([0, 255, 3]));
  });
  it('rejects traversal, symlinks and overwrite on file operations', async () => {
    expect(projectCommandSchema.safeParse({ type: 'create', path: '../escape' }).success).toBe(
      false,
    );
    await symlink(dir, join(root, 'escape'));
    await expect(service.command({ type: 'create', path: 'escape/stolen' })).rejects.toThrow(
      'Symbolic',
    );
    await expect(service.command({ type: 'create', path: 'main.tex' })).rejects.toThrow();
  });
  it('imports ordinary folders and safe ZIPs without altering sources', async () => {
    await writeFile(
      join(dir, 'paper.zip'),
      zipSync({
        'main.tex': strToU8('\\documentclass{article}'),
        'figures/a.bin': new Uint8Array([0, 1]),
      }),
    );
    await service.importZip(join(dir, 'paper.zip'), join(dir, 'imported'));
    expect(service.snapshot().rootId).not.toBeNull();
    expect(await readFile(join(dir, 'imported/figures/a.bin'))).toEqual(Buffer.from([0, 1]));
    await writeFile(join(dir, 'bad.zip'), zipSync({ '../escape': strToU8('bad') }));
    await expect(service.importZip(join(dir, 'bad.zip'), join(dir, 'bad'))).rejects.toThrow();
    await service.importFolder(root, join(dir, 'copied'));
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe('alpha\nbeta\ngamma\n');
  });
  it('persists preferences and rejects newer metadata versions', async () => {
    await service.command({ type: 'preferences', value: '{"font":14}' });
    await service.open(root);
    await service.command({ type: 'load', fileId: service.snapshot().files[0].id });
    expect(service.snapshot().preferences).toBe('{"font":14}');
    store.db.exec('PRAGMA user_version=99');
    expect(() => new MetadataStore(join(dir, 'data'))).toThrow('newer');
  });
});
it('reconciliation refuses overlap, handles inserts and leaves compatible changes', () => {
  expect(reconcile('abc', 'axc', 'ayc')).toBeNull();
  expect(reconcile('abc', 'xabc', 'abcy')).toBe('xabcy');
});

it('uses an acknowledged baseline when disk was observed before a stale replica arrives', async () => {
  const command = await edit('human\nbeta\ngamma\n');
  await writeFile(join(root, 'main.tex'), 'external\nbeta\ngamma\n');
  await service.command({ type: 'refresh' });
  await service.command(command);
  expect(service.snapshot().files[0]).toMatchObject({
    text: 'human\nbeta\ngamma\n',
    conflict: true,
    disk: 'external\nbeta\ngamma\n',
  });
});
it('loads only requested document payloads and rebuilds derived search indexes', async () => {
  await writeFile(join(root, 'second.tex'), 'searchable phrase');
  await service.command({ type: 'refresh' });
  let snap = service.snapshot();
  const second = snap.files.find((f) => f.path === 'second.tex')!;
  expect(second.loaded).toBe(false);
  expect(second.update).toEqual([]);
  const result = await service.command({ type: 'search', query: 'searchable phrase' });
  expect(result?.matches).toEqual([second.id]);
  await service.command({ type: 'load', fileId: second.id });
  snap = service.snapshot();
  expect(snap.files.find((f) => f.path === 'main.tex')?.update).toEqual([]);
  expect(snap.files.find((f) => f.id === second.id)?.text).toBe('searchable phrase');
  store.db.exec('DELETE FROM file_index');
  await service.command({ type: 'refresh' });
  expect((await service.command({ type: 'search', query: 'searchable' }))?.matches).toEqual([
    second.id,
  ]);
});
it('distinguishes binary replacement from deletion and requires its current revision', async () => {
  const id = service.snapshot().files[0].id;
  await writeFile(join(root, 'main.tex'), Buffer.from([0, 255, 1]));
  await service.command({ type: 'refresh' });
  let f = service.snapshot().files[0];
  expect(f).toMatchObject({ conflict: true, diskKind: 'binary', deleted: false });
  await expect(
    service.command({
      type: 'resolve',
      fileId: id,
      choice: 'disk',
      disk: null,
      diskRevision: 'old',
    }),
  ).rejects.toThrow('changed again');
  await service.command({
    type: 'resolve',
    fileId: id,
    choice: 'local',
    disk: null,
    diskRevision: f.diskRevision,
  });
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('alpha');
  await writeFile(join(root, 'main.tex'), Buffer.from([0, 255, 2]));
  await service.command({ type: 'refresh' });
  f = service.snapshot().files[0];
  await service.command({
    type: 'resolve',
    fileId: id,
    choice: 'disk',
    disk: null,
    diskRevision: f.diskRevision,
  });
  expect(service.snapshot().files[0]).toMatchObject({
    conflict: false,
    deleted: false,
    text: null,
  });
  expect(await readFile(join(root, 'main.tex'))).toEqual(Buffer.from([0, 255, 2]));
});
it('retains a deletion checkpoint when unlink succeeds but completion is interrupted', async () => {
  const id = service.snapshot().files[0].id;
  await service.command({ type: 'delete', fileId: id });
  const raw = JSON.parse(store.load(root)!);
  raw.files[0].deleted = false;
  store.save(root, JSON.stringify(raw));
  await service.open(root);
  await service.command({ type: 'restore', fileId: id });
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('alpha');
});
it('does not merge a folder import into an existing destination', async () => {
  const dest = join(dir, 'existing');
  await mkdir(dest);
  await writeFile(join(dest, 'precious'), 'keep');
  await expect(service.importFolder(root, dest)).rejects.toThrow();
  expect(await readFile(join(dest, 'precious'), 'utf8')).toBe('keep');
});

it('migrates schema v1 to v2 without losing recoverable project identity', async () => {
  const id = service.snapshot().id;
  store.db.exec('DROP TABLE file_index; PRAGMA user_version=1;');
  store.close();
  store = new MetadataStore(join(dir, 'data'));
  service = new ProjectService(store);
  expect((await service.current())?.id).toBe(id);
  expect(store.search(root, 'alpha')).toHaveLength(1);
});
it('retains the old project when opening a new folder fails', async () => {
  const original = service.snapshot();
  const unavailable = join(dir, 'new-project');
  await mkdir(unavailable);
  await writeFile(join(unavailable, 'other.tex'), 'other');
  const scan = vi.spyOn(store, 'index').mockImplementationOnce(() => {
    throw new Error('index unavailable');
  });
  await expect(service.open(unavailable)).rejects.toThrow('unavailable');
  scan.mockRestore();
  expect(service.snapshot().id).toBe(original.id);
  expect(store.get('lastProject')).toBe(root);
  await service.command(await edit('old project remains editable'));
  expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe('old project remains editable');
});
