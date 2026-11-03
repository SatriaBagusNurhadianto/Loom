import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { createProjectSearch } from '../src/renderer/editor/projectSearch';
import type { ProjectResult, ProjectSnapshot } from '../src/contracts/project';

// Exercise Solid's client reactivity without a browser DOM or its server no-op effects.
vi.mock('solid-js', () => vi.importActual<typeof import('solid-js')>('solid-js/dist/solid.js'));
let dispose: () => void;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});
const snapshot: ProjectSnapshot = {
  id: 'project-1',
  name: 'Synthetic',
  rootId: null,
  files: [],
  preferences: null,
};
function session() {
  const pending: Array<(result: ProjectResult) => void> = [];
  const command = vi.fn(() => new Promise<ProjectResult>((resolve) => pending.push(resolve)));
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [project, setProject] = createSignal<ProjectSnapshot | null>(snapshot);
    return {
      search: createProjectSearch({ project, command, locate: vi.fn() }),
      setProject,
      pending,
      command,
    };
  });
}
const result = (path: string): ProjectResult => ({
  ok: true,
  value: {
    ...snapshot,
    hits: [
      {
        fileId: 'file-1',
        path,
        kind: 'path',
        line: 1,
        offset: 0,
        length: 0,
        snippet: 'Filename match',
        ranges: [],
        pathRanges: [],
        approximate: false,
      },
    ],
  },
});

it('debounces, pauses for IME, submits immediately and clears pending results', async () => {
  const { search, command, pending } = session();
  search.setQuery('intrduction');
  await vi.advanceTimersByTimeAsync(200);
  expect(command).not.toHaveBeenCalled();
  search.setComposing(true);
  await vi.advanceTimersByTimeAsync(500);
  await search.run();
  expect(command).not.toHaveBeenCalled();
  search.setComposing(false);
  void search.run();
  expect(command).toHaveBeenCalledTimes(1);
  search.clear();
  pending[0](result('main.tex'));
  await vi.advanceTimersByTimeAsync(500);
  expect(search.hits()).toEqual([]);
  expect(search.highlightQuery()).toBe('');
  expect(search.searching()).toBe(false);
});

it('ignores late success and failure from superseded queries', async () => {
  const { search, pending } = session();
  search.setQuery('old');
  void search.run();
  search.setQuery('latest');
  void search.run();
  pending[1](result('latest.tex'));
  await Promise.resolve();
  expect(search.hits()[0].path).toBe('latest.tex');
  pending[0]({ ok: false, error: { code: 'OLD', message: 'Old failure', retryable: true } });
  await Promise.resolve();
  expect(search.hits()[0].path).toBe('latest.tex');
  expect(search.error()).toBe('');
  expect(search.searching()).toBe(false);
});

it('clears on project change and retains actionable current failures for retry', async () => {
  const { search, setProject, pending, command } = session();
  search.setQuery('main');
  void search.run();
  pending[0]({
    ok: false,
    error: { code: 'FAIL', message: 'Save pending edits first.', retryable: true },
  });
  await Promise.resolve();
  expect(search.error()).toBe('Save pending edits first.');
  void search.run();
  setProject({ ...snapshot, id: 'project-2' });
  pending[1](result('main.tex'));
  await vi.advanceTimersByTimeAsync(500);
  expect(search.query()).toBe('');
  expect(search.hits()).toEqual([]);
  expect(search.error()).toBe('');
  expect(command).toHaveBeenCalledTimes(2);
});
