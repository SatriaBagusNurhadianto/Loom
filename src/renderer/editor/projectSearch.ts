import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import type {
  ProjectCommand,
  ProjectResult,
  ProjectSnapshot,
  SearchHit,
} from '../../contracts/project';

/** One transient search session shared by the sidebar, compact navigator and source editor. */
export function createProjectSearch(workspace: {
  project: Accessor<ProjectSnapshot | null>;
  command: (command: ProjectCommand) => Promise<ProjectResult | undefined>;
  locate: (id: string, offset: number, length?: number) => Promise<void>;
}) {
  const [query, setQuery] = createSignal('');
  const [composing, setComposing] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  const [error, setError] = createSignal('');
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [selected, setSelected] = createSignal<SearchHit | null>(null);
  let epoch = 0,
    projectId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const revision = createMemo(() =>
    JSON.stringify(
      workspace.project()?.files.map((file) => [file.id, file.path, file.revision, file.deleted]),
    ),
  );
  createEffect(() => {
    const id = workspace.project()?.id;
    if (id !== projectId) {
      projectId = id;
      setQuery('');
      setComposing(false);
      setSelected(null);
    }
  });
  async function run(generation = ++epoch) {
    clearTimeout(timer);
    const q = query().trim(),
      id = workspace.project()?.id;
    if (!q || !id || composing()) return;
    setSearching(true);
    setError('');
    try {
      const result = await workspace.command({ type: 'search', query: q });
      if (generation !== epoch || id !== workspace.project()?.id) return;
      if (result?.ok) setHits(result.value?.hits ?? []);
      else setError(result && !result.ok ? result.error.message : 'Search unavailable. Try again.');
    } catch {
      if (generation === epoch) setError('Search unavailable. Try again.');
    } finally {
      if (generation === epoch) setSearching(false);
    }
  }
  createEffect(() => {
    revision();
    const q = query().trim(),
      paused = composing(),
      generation = ++epoch;
    clearTimeout(timer);
    setHits([]);
    setSelected(null);
    setError('');
    setSearching(!!q && !paused);
    if (q && !paused) timer = setTimeout(() => void run(generation), 300);
  });
  onCleanup(() => {
    clearTimeout(timer);
    ++epoch;
  });
  return {
    query,
    setQuery,
    composing,
    setComposing,
    searching,
    error,
    hits,
    selected,
    highlightQuery: () => (composing() ? '' : query().trim()),
    clear: () => {
      setQuery('');
      setSelected(null);
    },
    run: () => run(),
    navigate: async (hit: SearchHit) => {
      setSelected(hit);
      await workspace.locate(hit.fileId, hit.offset, hit.length);
    },
  };
}
