import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { projectCommandSchema, projectResultSchema } from '../src/contracts/project';
let directory: string;
let store: MetadataStore;
afterEach(async () => {
  store?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
it('retains separate project identities and preferences across reopen, and keeps missing folders in the library', async () => {
  directory = await mkdtemp(join(tmpdir(), 'loom-library-'));
  store = new MetadataStore(join(directory, 'data'));
  let service = new ProjectService(store);
  const a = await service.create(join(directory, 'Paper A'));
  await service.command({ type: 'preferences', value: '{"font":19,"active":"saved"}' });
  const b = await service.create(join(directory, 'Paper B'));
  expect(a.id).not.toBe(b.id);
  store.close();
  store = new MetadataStore(join(directory, 'data'));
  service = new ProjectService(store);
  expect(await service.library()).toHaveLength(2);
  expect(await service.reopen(a.id)).toMatchObject({
    id: a.id,
    preferences: '{"font":19,"active":"saved"}',
  });
  expect(await service.reopen(b.id)).toMatchObject({ id: b.id, preferences: null });
  await rm(join(directory, 'Paper A'), { recursive: true });
  expect((await service.library()).find((p) => p.id === a.id)).toMatchObject({ available: false });
  await expect(service.reopen(a.id)).rejects.toThrow('recovery data has been retained');
  expect(service.snapshot().id).toBe(b.id);
  await rm(join(directory, 'Paper B'), { recursive: true });
  await expect(
    service.command({ type: 'preferences', value: '{"font":17}' }),
  ).resolves.toMatchObject({ preferences: '{"font":17}' });
  expect(store.load(join(directory, 'Paper A'))).not.toBeNull();
  const restarted = new ProjectService(store);
  expect(await restarted.current(true)).toBeNull();
  await restarted.create(join(directory, 'Paper C'));
  expect(await restarted.library()).toHaveLength(3);
  expect(
    projectResultSchema.safeParse({ ok: true, value: null, library: await service.library() })
      .success,
  ).toBe(true);
  expect(
    projectCommandSchema.safeParse({ type: 'reopen', projectId: a.id, path: '/untrusted' }).success,
  ).toBe(false);
});
it('migrates existing metadata into the library without opening or rewriting manuscripts', async () => {
  directory = await mkdtemp(join(tmpdir(), 'loom-library-'));
  const paper = join(directory, 'Legacy');
  await mkdir(paper);
  await writeFile(join(paper, 'main.tex'), 'Synthetic manuscript');
  store = new MetadataStore(join(directory, 'data'));
  const service = new ProjectService(store);
  const opened = await service.open(paper);
  store.db.exec('DROP TABLE project_library; PRAGMA user_version=2');
  store.close();
  store = new MetadataStore(join(directory, 'data'));
  expect(await new ProjectService(store).library()).toEqual([
    { id: opened.id, name: 'Legacy', path: paper, lastOpened: 0, available: true },
  ]);
  expect(store.load(paper)).not.toBeNull();
});
