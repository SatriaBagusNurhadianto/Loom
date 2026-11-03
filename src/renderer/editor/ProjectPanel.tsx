import { createEffect, createMemo, createSignal, onCleanup, For, Show } from 'solid-js';
import type { ProjectSnapshot } from '../../contracts/project';
import type { ProjectWorkspace } from './documents';
import { Modal } from '../ui/primitives';
export function ProjectPanel(props: { workspace: ProjectWorkspace; onNavigate?: () => void }) {
  const w = props.workspace;
  const [query, setQuery] = createSignal('');
  const [composing, setComposing] = createSignal(false);
  const [hits, setHits] = createSignal<NonNullable<ProjectSnapshot['hits']>>([]);
  let searchInput!: HTMLInputElement;
  const [path, setPath] = createSignal('');
  const [operation, setOperation] = createSignal<'rename' | 'delete' | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [formError, setFormError] = createSignal('');
  const [matchIds, setMatchIds] = createSignal<string[] | null>(null);
  createEffect(() => {
    const q = query();
    if (composing()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!q) {
        setMatchIds(null);
        setHits([]);
        return;
      }
      void w.command({ type: 'search', query: q }).then((result) => {
        if (!cancelled && result?.ok) {
          setMatchIds(result.value?.matches ?? []);
          setHits(result.value?.hits ?? []);
        }
      });
    }, 300);
    onCleanup(() => {
      cancelled = true;
      clearTimeout(timer);
    });
  });
  const matches = createMemo(
    () =>
      w
        .project()
        ?.files.filter((f) => !f.deleted && (matchIds() === null || matchIds()!.includes(f.id))) ??
      [],
  );
  const sections = createMemo(() => {
    w.version();
    const text = w.live(w.active())?.doc.getText('source').toString() ?? w.file()?.text ?? '';
    return [...text.matchAll(/\\(?:sub)*section\*?(?:\[[^\]]*\])?\{([^}]*)\}/g)].map((m) => ({
      title: m[1],
      offset: m.index!,
    }));
  });
  async function submit() {
    if (busy()) return;
    setBusy(true);
    try {
      const op = operation();
      const result =
        op === 'rename'
          ? await w.command({ type: 'rename', fileId: w.active(), path: path() })
          : await w.command({ type: 'delete', fileId: w.active() });
      if (result?.ok) {
        setOperation(null);
        setPath('');
      } else setFormError(result?.error.message ?? 'Operation unavailable.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="project-panel">
      <div class="project-actions">
        <button disabled={w.pending()} onClick={() => void w.newFile()}>
          New file
        </button>
        <button
          disabled={!w.file()}
          onClick={() => {
            setPath(w.file()?.path ?? '');
            setFormError('');
            setOperation('rename');
          }}
        >
          Rename / move
        </button>
        <button
          disabled={!w.file()}
          onClick={() => {
            setFormError('');
            setOperation('delete');
          }}
        >
          Delete
        </button>
      </div>
      <div class="search-field">
        <input
          ref={searchInput}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setQuery(e.currentTarget.value);
            setComposing(false);
          }}
          aria-label="Search project text"
          placeholder="Search files and source…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Show when={query()}>
          <button
            aria-label="Clear project search"
            onClick={() => {
              setQuery('');
              setMatchIds(null);
              setHits([]);
              searchInput.focus();
            }}
          >
            ×
          </button>
        </Show>
      </div>
      <Show when={query()}>
        <section class="search-hits" aria-label="Project search results">
          <p>{hits().length} matching locations (up to 200)</p>
          <For each={hits()}>
            {(hit) => (
              <button
                class="search-hit"
                onClick={() => {
                  props.onNavigate?.();
                  void w.locate(hit.fileId, hit.offset);
                }}
              >
                <strong>
                  {hit.path}:{hit.line}
                </strong>
                <span>{hit.snippet}</span>
              </button>
            )}
          </For>
        </section>
      </Show>
      <div class="project-files">
        <For each={matches()} fallback={<p>No matching files.</p>}>
          {(f) => (
            <button
              class="file-row"
              classList={{ selected: w.active() === f.id }}
              onClick={() => void w.select(f.id)}
            >
              <span>{f.path}</span>
              <small>
                {w.project()?.rootId === f.id
                  ? 'root'
                  : f.conflict
                    ? 'conflict'
                    : f.text === null
                      ? 'asset'
                      : ''}
              </small>
            </button>
          )}
        </For>
      </div>
      <Show when={w.file()?.path.endsWith('.tex')}>
        <button
          class="text-button"
          onClick={() => void w.command({ type: 'root', fileId: w.active() })}
        >
          Use {w.file()?.path} as root
        </button>
      </Show>
      <p class="project-root">
        Root:{' '}
        {w.project()?.files.find((f) => f.id === w.project()?.rootId)?.path ??
          'Choose a .tex root document'}
      </p>
      <section aria-label="Document outline">
        <h3>Outline</h3>
        <For each={sections()} fallback={<p>No sections in this file.</p>}>
          {(s) => (
            <button
              class="outline-item"
              onClick={() => {
                props.onNavigate?.();
                void w.locate(w.active(), s.offset);
              }}
            >
              {s.title}
            </button>
          )}
        </For>
      </section>
      <Show when={w.project()?.files.some((f) => f.deleted)}>
        <details>
          <summary>Recover deleted files</summary>
          <For each={w.project()?.files.filter((f) => f.deleted)}>
            {(f) => (
              <button
                class="file-row"
                onClick={() => void w.command({ type: 'restore', fileId: f.id })}
              >
                Restore {f.path}
              </button>
            )}
          </For>
        </details>
      </Show>
      <Modal
        open={operation() !== null}
        title={
          operation() === 'delete'
            ? 'Delete file'
            : operation() === 'rename'
              ? 'Rename or move file'
              : 'Create file'
        }
        onClose={() => setOperation(null)}
      >
        <Show
          when={operation() === 'delete'}
          fallback={
            <label>
              Project-relative path
              <input
                aria-label="Project-relative path"
                value={path()}
                onInput={(e) => setPath(e.currentTarget.value)}
              />
            </label>
          }
        >
          <p>Delete {w.file()?.path}? You can restore it from Recover deleted files.</p>
        </Show>
        <Show when={formError()}>
          <p role="alert">{formError()}</p>
        </Show>
        <button onClick={() => setOperation(null)}>Cancel</button>
        <button disabled={busy()} onClick={() => void submit()}>
          {operation() === 'delete' ? 'Delete' : operation() === 'rename' ? 'Rename' : 'Create'}
        </button>
      </Modal>
    </div>
  );
}
