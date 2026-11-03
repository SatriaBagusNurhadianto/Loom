import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { createLatexWorkspace } from '../src/renderer/latex/workspace';
import {
  defaultBuildSettings,
  type BuildState,
  type LatexCommand,
  type LatexResult,
} from '../src/contracts/latex';
import type { ProjectWorkspace } from '../src/renderer/editor/documents';
import type { ProjectSnapshot } from '../src/contracts/project';
vi.mock('solid-js', () => vi.importActual<typeof import('solid-js')>('solid-js/dist/solid.js'));
let dispose: () => void;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const snapshot: ProjectSnapshot = {
  id: 'p',
  name: 'Paper',
  rootId: null,
  sourceRevision: 'rev1',
  files: [],
  preferences: null,
};
const state: BuildState = {
  projectId: 'p',
  settings: defaultBuildSettings,
  tools: [],
  current: null,
  successful: null,
  queued: false,
};
function session() {
  const pending: Array<{ command: LatexCommand; resolve: (result: LatexResult) => void }> = [];
  const request = vi.fn(
    (command: LatexCommand) =>
      new Promise<LatexResult>((resolve) => pending.push({ command, resolve })),
  );
  vi.stubGlobal('window', { loom: { latex: request, onServiceEvent: () => () => {} } });
  const value = createRoot((cleanup) => {
    dispose = cleanup;
    const [project, setProject] = createSignal<ProjectSnapshot | null>(snapshot);
    const [editVersion, setEditVersion] = createSignal(0);
    let dirty = false;
    const workspace = {
      project,
      version: editVersion,
      editVersion,
      live: () => ({ dirty }),
      flushPending: async () => true,
      command: vi.fn(async () => ({ ok: true, value: project() })),
    } as unknown as ProjectWorkspace;
    return {
      latex: createLatexWorkspace(workspace, vi.fn()),
      setProject,
      workspace,
      setDirty: (value: boolean) => {
        dirty = value;
        setEditVersion((n) => n + 1);
      },
    };
  });
  return { ...value, pending, request };
}
const result = (value: BuildState): LatexResult => ({
  ok: true,
  value: { kind: 'state', state: value },
});
it('keeps build state through fresh project snapshots and ignores results from an old project', async () => {
  const { latex, pending, setProject } = session();
  await Promise.resolve();
  pending[0].resolve(result(state));
  await Promise.resolve();
  expect(latex.state()?.projectId).toBe('p');
  setProject({ ...snapshot });
  await Promise.resolve();
  expect(latex.state()?.projectId).toBe('p');
  const request = latex.refresh();
  setProject({ ...snapshot, id: 'other' });
  pending
    .find((item, index) => index > 0 && item.command.projectId === 'p')!
    .resolve(result({ ...state, queued: true }));
  await request;
  expect(latex.state()).toBeNull();
});
it('debounces actual source revisions without resetting its timer on status polling', async () => {
  const { latex, pending, setProject, request } = session();
  await Promise.resolve();
  pending[0].resolve(
    result({ ...state, settings: { ...defaultBuildSettings, autoBuild: true, delayMs: 1500 } }),
  );
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(650);
  const poll = latex.refresh();
  pending
    .find((item, index) => index > 0 && item.command.type === 'status')!
    .resolve(
      result({ ...state, settings: { ...defaultBuildSettings, autoBuild: true, delayMs: 1500 } }),
    );
  await poll;
  setProject({ ...snapshot });
  await vi.advanceTimersByTimeAsync(900);
  expect(request.mock.calls.filter(([c]) => c.type === 'build')).toHaveLength(1);
});
it('never lets a late structure result overwrite the newer source index', async () => {
  const { latex, pending, setProject } = session();
  await Promise.resolve();
  pending[0].resolve(result(state));
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(450);
  const old = pending.find((item) => item.command.type === 'structure')!;
  setProject({ ...snapshot, sourceRevision: 'rev2' });
  await vi.advanceTimersByTimeAsync(450);
  const next = pending.filter((item) => item.command.type === 'structure')[1];
  next.resolve({
    ok: true,
    value: {
      kind: 'structure',
      items: [{ path: 'main.tex', kind: 'section', title: 'Current', line: 1, column: 0 }],
    },
  });
  await Promise.resolve();
  old.resolve({
    ok: true,
    value: {
      kind: 'structure',
      items: [{ path: 'main.tex', kind: 'section', title: 'Old', line: 1, column: 0 }],
    },
  });
  await Promise.resolve();
  expect(latex.items()[0]?.title).toBe('Current');
});

it('blocks keyboard/manual and automatic builds while a main document choice is unresolved', async () => {
  const { latex, pending, request } = session();
  await Promise.resolve();
  latex.setMainChoiceRequired(true);
  pending[0].resolve(result({ ...state, settings: { ...defaultBuildSettings, autoBuild: true } }));
  await Promise.resolve();
  await latex.compile();
  expect(latex.error()).toContain('Choose the main document');
  await vi.advanceTimersByTimeAsync(3000);
  expect(request.mock.calls.filter(([command]) => command.type === 'build')).toHaveLength(0);
  latex.setMainChoiceRequired(false);
  await vi.advanceTimersByTimeAsync(1600);
  expect(request.mock.calls.filter(([command]) => command.type === 'build')).toHaveLength(1);
});

it('never carries a deferred manual update into another project', async () => {
  const { latex, pending, setProject, setDirty, request } = session();
  await Promise.resolve();
  pending[0].resolve(result(state));
  await Promise.resolve();
  setProject({ ...snapshot, files: [{ id: 'file' }] } as ProjectSnapshot);
  setDirty(true);
  await latex.compile(true);
  expect(latex.error()).toBe('');
  setProject({ ...snapshot, id: 'other' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(request.mock.calls.filter(([command]) => command.type === 'build')).toHaveLength(0);
});
it('keeps a deferred clean rebuild when an automatic update reaches the saved paper first', async () => {
  const { latex, pending, setProject, setDirty } = session();
  await Promise.resolve();
  pending[0].resolve(result(state));
  await Promise.resolve();
  setProject({ ...snapshot, files: [{ id: 'file' }] } as ProjectSnapshot);
  setDirty(true);
  await latex.compile(true);
  setDirty(false);
  const automatic = latex.compile(false, true);
  await vi.advanceTimersByTimeAsync(0);
  const build = pending.find((item) => item.command.type === 'build')!;
  expect(build.command).toMatchObject({ clean: true });
  build.resolve(result(state));
  await automatic;
  await vi.advanceTimersByTimeAsync(1000);
  expect(pending.filter((item) => item.command.type === 'build')).toHaveLength(1);
});
it('waits for a pause in real typing, not merely a saved disk revision', async () => {
  const { latex, pending, setProject, setDirty, request } = session();
  await Promise.resolve();
  pending[0].resolve(
    result({ ...state, settings: { ...defaultBuildSettings, autoBuild: true, delayMs: 750 } }),
  );
  await Promise.resolve();
  setProject({ ...snapshot, files: [{ id: 'file' }] } as ProjectSnapshot);
  for (let n = 0; n < 6; n++) {
    setDirty(true);
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(request.mock.calls.filter(([command]) => command.type === 'build')).toHaveLength(0);
  expect(latex.error()).toBe('');
  setDirty(false);
  await vi.advanceTimersByTimeAsync(800);
  expect(request.mock.calls.filter(([command]) => command.type === 'build')).toHaveLength(1);
});

it('cancellation during saving prevents a later native build request', async () => {
  const { latex, pending, workspace, request } = session();
  await Promise.resolve();
  pending[0].resolve(result(state));
  await Promise.resolve();
  let saved!: (value: boolean) => void;
  workspace.flushPending = () =>
    new Promise((resolve) => {
      saved = resolve;
    });
  const compiling = latex.compile(true);
  await Promise.resolve();
  const cancelling = latex.cancel();
  await Promise.resolve();
  pending.find((item) => item.command.type === 'cancel')!.resolve(result(state));
  await cancelling;
  saved(true);
  await compiling;
  await vi.advanceTimersByTimeAsync(1000);
  expect(request.mock.calls.filter(([command]) => command.type === 'build')).toHaveLength(0);
});
it('reports a real saving failure when a manual request joined an automatic update', async () => {
  const { latex, pending, workspace } = session();
  await Promise.resolve();
  pending[0].resolve(result(state));
  await Promise.resolve();
  let saved!: (value: boolean) => void;
  workspace.flushPending = () =>
    new Promise((resolve) => {
      saved = resolve;
    });
  const automatic = latex.compile(false, true);
  await Promise.resolve();
  await latex.compile(true);
  saved(false);
  await automatic;
  expect(latex.error()).toContain('could not be saved');
});

it('a retired failed save cannot clear another project manual build or show its error there', async () => {
  const { latex, pending, workspace, setProject } = session();
  await Promise.resolve();
  pending[0].resolve(result(state));
  await Promise.resolve();
  let finish!: (value: boolean) => void;
  workspace.flushPending = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(true);
  const old = latex.compile();
  await Promise.resolve();
  setProject({ ...snapshot, id: 'other' });
  await latex.compile(true);
  finish(false);
  await old;
  await vi.advanceTimersByTimeAsync(400);
  expect(latex.error()).toBe('');
  const next = pending.find((item) => item.command.type === 'build');
  expect(next?.command).toMatchObject({ projectId: 'other', clean: true });
  next!.resolve(result({ ...state, projectId: 'other' }));
  await vi.advanceTimersByTimeAsync(0);
});
