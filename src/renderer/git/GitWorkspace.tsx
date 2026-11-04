import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { GitDiff, GitStatus } from '../../contracts/git';
import { Modal } from '../ui/primitives';
import './git.css';

export function GitWorkspace(props: {
  projectId: () => string | undefined;
  open: () => boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = createSignal<GitStatus | null>(null);
  const [selected, setSelected] = createSignal<{ path: string; area: 'index' | 'worktree' } | null>(
    null,
  );
  const [diff, setDiff] = createSignal<GitDiff | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const id = () => props.projectId();
  const refresh = async () => {
    const projectId = id();
    if (!projectId || !window.loom) return;
    setBusy(true);
    setError('');
    const result = await window.loom.git({ type: 'status', projectId });
    if (id() !== projectId) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      setStatus(null);
      return;
    }
    if (result.value.kind !== 'status') return;
    setStatus(result.value);
    const current = selected();
    if (current && !result.value.files.some((file) => file.path === current.path)) {
      setSelected(null);
      setDiff(null);
    }
  };
  createEffect(() => {
    if (props.open()) void refresh();
    else {
      setSelected(null);
      setDiff(null);
    }
  });
  const changed = createMemo(
    () =>
      status()?.files.filter(
        (file) => file.index !== '!' && (file.index !== ' ' || file.worktree !== ' '),
      ) ?? [],
  );
  const loadDiff = async (path: string, area: 'index' | 'worktree') => {
    const projectId = id();
    if (!projectId || !window.loom) return;
    setSelected({ path, area });
    setDiff(null);
    setError('');
    const result = await window.loom.git({ type: 'diff', projectId, path, area });
    if (id() !== projectId || selected()?.path !== path || selected()?.area !== area) return;
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value.kind === 'diff') setDiff(result.value);
  };
  const label = (code: string) =>
    code === ' ' ? '—' : code === '?' ? 'untracked' : code === '!' ? 'ignored' : code;
  return (
    <Modal
      title="Git · repository review"
      open={props.open()}
      onClose={props.onClose}
      initialFocus="button"
    >
      <section class="git-workspace" aria-label="Git repository">
        <div class="git-toolbar">
          <div>
            <strong>{status()?.repository ? status()?.rootName : 'Repository not detected'}</strong>
            <p>
              {status()?.repository
                ? `${status()?.detached ? 'Detached HEAD' : (status()?.branch ?? 'Branch unavailable')}${status()?.upstream ? ` · tracks ${status()?.upstream}` : ''}`
                : status()?.gitAvailable === false
                  ? 'Git is not installed or could not be found.'
                  : 'Open a Git repository to review manuscript changes.'}
            </p>
          </div>
          <button class="secondary-button" disabled={busy()} onClick={() => void refresh()}>
            {busy() ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <Show when={status()?.mergeInProgress}>
          <p class="git-callout">
            A merge is in progress. Conflict review and resolution are not available yet.
          </p>
        </Show>
        <Show when={status()?.repository && !status()?.upstream}>
          <p class="git-callout">
            No upstream is configured. Git uses your existing credential helper or SSH
            configuration; Loom does not store Git credentials.
          </p>
        </Show>
        <Show when={status()?.repository && status()?.files.length === 0}>
          <p class="muted">Working tree clean.</p>
        </Show>
        <div class="git-review-grid">
          <div class="git-file-list" aria-label="Changed files">
            <For each={changed()}>
              {(file) => (
                <article class="git-file">
                  <span class="git-file-path">{file.path}</span>
                  <div>
                    <button
                      class="text-button"
                      onClick={() => void loadDiff(file.path, 'index')}
                      aria-label={`Review staged changes to ${file.path}`}
                    >
                      Staged · {label(file.index)}
                    </button>
                    <button
                      class="text-button"
                      onClick={() => void loadDiff(file.path, 'worktree')}
                      aria-label={`Review unstaged changes to ${file.path}`}
                    >
                      Working · {label(file.worktree)}
                    </button>
                  </div>
                </article>
              )}
            </For>
          </div>
          <div class="git-diff" aria-label="Git diff review">
            <Show
              when={selected()}
              fallback={<p class="muted">Choose a staged or working tree diff to review.</p>}
            >
              <h3>
                {selected()?.path}{' '}
                <small>· {selected()?.area === 'index' ? 'staged' : 'working tree'}</small>
              </h3>
              <Show when={diff()} fallback={<p class="muted">Loading diff…</p>}>
                <pre>
                  {diff()?.binary
                    ? 'Binary file changed; textual diff is unavailable.'
                    : diff()?.text || 'No textual changes in this area.'}
                </pre>
                <Show when={diff()?.truncated}>
                  <p class="muted">Diff is truncated at 200,000 characters.</p>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
        <Show when={status()?.truncated}>
          <p class="muted">The changed file list is capped at 5,000 entries.</p>
        </Show>
        <Show when={error()}>
          <p class="inline-error" role="alert">
            {error()}
          </p>
        </Show>
        <p class="muted">
          This view reads native Git state. Editing source never commits or pushes.
        </p>
      </section>
    </Modal>
  );
}
