import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { changeLocations, createAgentChangePreview } from '../src/renderer/agent/changePreview';
import type { AgentChange, AgentState, AgentTurn } from '../src/contracts/agent';
import type { BuildState } from '../src/contracts/latex';
import type { LatexWorkspace } from '../src/renderer/latex/workspace';
vi.mock('solid-js', () => vi.importActual<typeof import('solid-js')>('solid-js/dist/solid.js'));
let dispose: () => void;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});
const change = (overrides: Partial<AgentChange> = {}): AgentChange => ({
  path: 'sections/results.tex',
  before: '\\section{Results}\nBefore.\n',
  after: '\\section{Results}\nAfter.\n',
  kind: 'modified',
  binary: false,
  humanTouched: false,
  review: 'pending',
  diff: [
    { kind: 'same', text: '\\section{Results}\n' },
    { kind: 'removed', text: 'Before.\n' },
    { kind: 'added', text: 'After.\n' },
  ],
  ...overrides,
});
it('locates new-source lines across inserted/deleted text and excludes non-rendered or binary changes', () => {
  expect(changeLocations([change()])).toEqual([
    { path: 'sections/results.tex', line: 2, column: 0 },
  ]);
  expect(
    changeLocations([change({ kind: 'deleted', after: null }), change({ binary: true })]),
  ).toEqual([]);
  expect(
    changeLocations([
      change({
        path: 'main.tex',
        after: '\\usepackage{new}\n\\begin{document}\nBody.\n',
        diff: [
          { kind: 'removed', text: '\\usepackage{old}\n' },
          { kind: 'added', text: '\\usepackage{new}\n' },
          { kind: 'same', text: '\\begin{document}\nBody.\n' },
        ],
      }),
    ]),
  ).toEqual([]);
  expect(
    changeLocations([
      change({
        after: 'A\nC\n',
        diff: [
          { kind: 'same', text: 'A\n' },
          { kind: 'removed', text: 'B\n' },
          { kind: 'same', text: 'C\n' },
        ],
      }),
    ])[0].line,
  ).toBe(2);
});
it('previews only a newly completed agent turn after its matching successful PDF and never replays history', async () => {
  const turn: AgentTurn = {
    id: 'turn',
    sessionId: 'chat',
    status: 'running',
    startedAt: 'now',
    revision: 'before',
    changes: [change()],
  };
  const openPdf = vi.fn(),
    previewSource = vi.fn(async () => true),
    refresh = vi.fn(async () => {});
  const { setAgent, setBuild, setRevision } = createRoot((cleanup) => {
    dispose = cleanup;
    const [agent, setAgent] = createSignal({ projectId: 'p', turns: [turn] } as AgentState);
    const [build, setBuild] = createSignal({
      projectId: 'p',
      current: null,
      successful: null,
      queued: false,
    } as BuildState);
    const [revision, setRevision] = createSignal('after');
    createAgentChangePreview({
      agent,
      project: () => ({
        id: 'p',
        name: 'Paper',
        rootId: null,
        files: [],
        preferences: null,
        sourceRevision: revision(),
      }),
      latex: {
        state: build,
        running: () => false,
        stale: () => false,
        refresh,
        previewSource,
      } as unknown as LatexWorkspace,
      openPdf,
      report: vi.fn(),
    });
    return { setAgent, setBuild, setRevision };
  });
  setAgent({
    projectId: 'p',
    turns: [{ ...turn, status: 'succeeded', resultRevision: 'after' }],
  } as AgentState);
  expect(refresh).toHaveBeenCalled();
  setBuild({
    projectId: 'p',
    current: null,
    queued: false,
    successful: { id: 'old', revision: 'before' },
  } as BuildState);
  expect(previewSource).not.toHaveBeenCalled();
  setRevision('newer-human-edit');
  setBuild({
    projectId: 'p',
    current: null,
    queued: false,
    successful: { id: 'pdf', revision: 'after' },
  } as BuildState);
  expect(previewSource).not.toHaveBeenCalled();
  setRevision('after');
  await Promise.resolve();
  await Promise.resolve();
  expect(previewSource).toHaveBeenCalledWith(
    { path: 'sections/results.tex', line: 2, column: 0 },
    'after',
  );
  expect(openPdf).toHaveBeenCalledTimes(1);
  setAgent({
    projectId: 'p',
    turns: [{ ...turn, status: 'succeeded', resultRevision: 'after' }],
  } as AgentState);
  expect(openPdf).toHaveBeenCalledTimes(1);
});
