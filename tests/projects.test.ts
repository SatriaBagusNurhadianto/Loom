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
    await service.command({ type: 'resolve', fileId: f.id, choice: 'local', disk: f.disk });
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
    await service.command({ type: 'resolve', fileId: id, choice: 'local', disk: null });
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
