import { afterEach, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectWorkspace } from '../src/renderer/editor/documents';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import type { ProjectCommand, ProjectResult } from '../src/contracts/project';
vi.mock('solid-js', () => vi.importActual<typeof import('solid-js')>('solid-js/dist/solid.js'));
// Recovery timing is simulated; the document binding, service, SQLite and filesystem are real.
vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve();
    destroy = async () => {};
  },
}));
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});
it.each(['none', 'overlap', 'compatible'])(
  'overlapping saves retain typing and distinguish real external edits (%s)',
  async (external) => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-saving-'));
    const root = join(directory, 'paper');
    await mkdir(root);
    await writeFile(join(root, 'main.tex'), 'Original sentence.');
    const store = new MetadataStore(join(directory, 'data'));
    const service = new ProjectService(store);
    const opened = await service.open(root);
    let arm = false;
    let release!: () => void;
    let sent!: () => void;
    const captured = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bridge = async (command: ProjectCommand): Promise<ProjectResult> => {
      const value = await service.run(() => service.command(command));
      if (arm && command.type === 'sync') {
        arm = false;
        sent();
        await gate;
      }
      return { ok: true, value };
    };
    vi.stubGlobal('window', {
      loom: {
        project: bridge,
        chooseProject: async () => ({ ok: true, value: opened }),
        onServiceEvent: () => () => {},
        onCloseRequest: () => () => {},
      },
    });
    const workspace = createRoot((dispose) => {
      cleanup = dispose;
      return createProjectWorkspace(() => {});
    });
    try {
      await workspace.choose('open');
      const id = opened.files[0].id;
      await vi.waitFor(() => expect(workspace.live(id)?.initialized).toBe(true));
      await workspace.flush(id);
      const text = workspace.live(id)!.doc.getText('source');
      arm = true;
      text.insert(text.length, ' First edit.');
      const first = workspace.flush(id);
      await captured;
      text.insert(text.length, ' More typing.');
      if (external === 'overlap') {
        text.delete(0, text.length);
        text.insert(0, 'Human replacement.');
        await writeFile(join(root, 'main.tex'), 'A different external replacement.');
      }
      if (external === 'compatible')
        await writeFile(join(root, 'main.tex'), 'External sentence. First edit.');
      const second = workspace.flush(id);
      release();
      await Promise.all([first, second]);
      await workspace.flush(id);
      if (external === 'overlap') {
        expect(workspace.file()?.conflict).toBe(true);
        expect(text.toString()).toBe('Human replacement.');
        expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(
          'A different external replacement.',
        );
        return;
      }
      expect(workspace.file()?.conflict).toBe(false);
      expect(workspace.live(id)?.dirty).toBe(false);
      const expected =
        external === 'compatible'
          ? 'External sentence. First edit. More typing.'
          : 'Original sentence. First edit. More typing.';
      expect(text.toString()).toBe(expected);
      expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(expected);
    } finally {
      release();
      cleanup?.();
      cleanup = undefined;
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
