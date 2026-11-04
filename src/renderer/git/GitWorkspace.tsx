import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { GitDiff, GitStatus } from '../../contracts/git';
import type { BuildState } from '../../contracts/latex';
import type { SourcePreflight } from '../../contracts/git';
import { Modal } from '../ui/primitives';
import './git.css';

export function GitWorkspace(props: {
  projectId: () => string | undefined;
  open: () => boolean;
  onClose: () => void;
  beforeMutation: () => Promise<boolean>;
  onCloned: () => Promise<void>;
  onStatus: (status: GitStatus | null) => void;
  onPreparePublication: () => void;
  onSelectPath: (path: string) => void | Promise<void>;
}) {
  const [status, setStatus] = createSignal<GitStatus | null>(null);
  const [selected, setSelected] = createSignal<{
    path: string;
    area: 'index' | 'worktree' | 'base' | 'ours' | 'theirs';
  } | null>(null);
  const [diff, setDiff] = createSignal<GitDiff | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [commitOpen, setCommitOpen] = createSignal(false);
  const [commitMessage, setCommitMessage] = createSignal('');
  const [commitReviewTree, setCommitReviewTree] = createSignal<string | null>(null);
  const [reviewedTree, setReviewedTree] = createSignal<string | null>(null);
  const [reviewedPaths, setReviewedPaths] = createSignal<string[]>([]);
  const [branchName, setBranchName] = createSignal('');
  const [remoteUrl, setRemoteUrl] = createSignal('');
  const [pushRemote, setPushRemote] = createSignal('');
  let diffGeneration = 0;
  const [preflight, setPreflight] = createSignal<SourcePreflight | null>(null);
  const [buildState, setBuildState] = createSignal<BuildState | null>(null);
  const [buildStatusUnavailable, setBuildStatusUnavailable] = createSignal(false);
  const id = () => props.projectId();
  createEffect(() => {
    const firstRemote = status()?.remotes[0];
    if (!pushRemote() && firstRemote) setPushRemote(firstRemote);
  });
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
      props.onStatus(null);
      return;
    }
    if (result.value.kind !== 'status') return;
    setStatus(result.value);
    props.onStatus(result.value);
    if (reviewedTree() !== result.value.indexTree) {
      setReviewedTree(result.value.indexTree);
      setReviewedPaths([]);
    }
    const current = selected();
    if (current && !result.value.files.some((file) => file.path === current.path)) {
      setSelected(null);
      setDiff(null);
    }
  };
  createEffect(() => {
    if (props.open()) void refresh();
    else {
      diffGeneration++;
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
  const staged = createMemo(
    () =>
      status()?.files.filter((file) => !file.conflict && ![' ', '?', '!'].includes(file.index)) ??
      [],
  );
  const stageAction = async (type: 'stage' | 'unstage', path: string) => {
    const projectId = id();
    if (!projectId || !window.loom) return;
    if (!(await props.beforeMutation())) return;
    setBusy(true);
    setError('');
    const result = await window.loom.git({ type, projectId, path });
    setBusy(false);
    if (id() !== projectId) return;
    if (!result.ok) setError(result.error.message);
    else await refresh();
  };
  const operation = async (type: 'fetch' | 'pull' | 'push') => {
    const projectId = id();
    if (!projectId || !window.loom) return;
    if ((type === 'pull' || type === 'push') && !(await props.beforeMutation())) return;
    setBusy(true);
    setError('');
    const result = await window.loom.git({
      type,
      projectId,
      ...(type === 'push' && !status()?.upstream && pushRemote() ? { remote: pushRemote() } : {}),
    });
    setBusy(false);
    if (id() !== projectId) return;
    if (!result.ok) setError(result.error.message);
    else await refresh();
  };
  const commit = async () => {
    const projectId = id(),
      expectedIndexTree = status()?.indexTree;
    if (!projectId || !expectedIndexTree || !window.loom || !commitMessage().trim()) return;
    if (!(await props.beforeMutation())) return;
    setBusy(true);
    setError('');
    const result = await window.loom.git({
      type: 'commit',
      projectId,
      message: commitMessage().trim(),
      expectedIndexTree,
    });
    setBusy(false);
    if (id() !== projectId) return;
    if (!result.ok) setError(result.error.message);
    else {
      if (result.value.kind === 'status' && result.value.commitNotice)
        setNotice(result.value.commitNotice);
      setCommitOpen(false);
      setCommitMessage('');
      setReviewedPaths([]);
      setReviewedTree(null);
      await refresh();
    }
  };
  const changeBranch = async (name: string, action: 'create' | 'switch') => {
    const projectId = id();
    if (!projectId || !window.loom || !(await props.beforeMutation())) return;
    setBusy(true);
    setError('');
    const result = await window.loom.git({ type: 'branch', projectId, name, action });
    setBusy(false);
    if (id() !== projectId) return;
    if (!result.ok) setError(result.error.message);
    else {
      setBranchName('');
      setCommitOpen(false);
      setReviewedPaths([]);
      await refresh();
    }
  };
  const clone = async () => {
    if (!(await props.beforeMutation()) || !window.loom) return;
    setBusy(true);
    setError('');
    const result = await window.loom.cloneGit({ url: remoteUrl().trim() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (!result.value) return;
    setRemoteUrl('');
    await props.onCloned();
    props.onClose();
  };
  const loadPreflight = async () => {
    const projectId = id();
    if (!projectId || !window.loom || !(await props.beforeMutation())) return;
    setBusy(true);
    setError('');
    setPreflight(null);
    setBuildState(null);
    setBuildStatusUnavailable(false);
    const [sourceResult, buildResult] = await Promise.all([
      window.loom.git({ type: 'preflight', projectId }),
      window.loom.latex({ type: 'status', projectId, detect: false }),
    ]);
    setBusy(false);
    if (id() !== projectId) return;
    if (!sourceResult.ok) {
      setError(sourceResult.error.message);
      return;
    }
    if (sourceResult.value.kind !== 'preflight') {
      setError('Publication preflight returned an invalid result.');
      return;
    }
    setPreflight(sourceResult.value);
    if (buildResult.ok && buildResult.value.kind === 'state')
      setBuildState(buildResult.value.state);
    else setBuildStatusUnavailable(true);
  };
  const exportSource = async () => {
    const projectId = id(),
      report = preflight();
    if (!projectId || !report || !window.loom) return;
    if (!(await props.beforeMutation())) return;
    setBusy(true);
    setError('');
    const result = await window.loom.exportSource({ projectId, revision: report.revision });
    setBusy(false);
    if (id() !== projectId) return;
    if (!result.ok) setError(result.error.message);
    else if (!result.value.cancelled)
      setNotice(
        `Source ZIP exported: ${result.value.included} files included, ${result.value.excluded} excluded.`,
      );
  };
  const loadDiff = async (
    path: string,
    area: 'index' | 'worktree' | 'base' | 'ours' | 'theirs',
  ) => {
    const projectId = id();
    if (!projectId || !window.loom) return;
    const request = ++diffGeneration;
    setSelected({ path, area });
    setDiff(null);
    setError('');
    const result = await window.loom.git({ type: 'diff', projectId, path, area });
    if (
      id() !== projectId ||
      request !== diffGeneration ||
      selected()?.path !== path ||
      selected()?.area !== area
    )
      return;
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value.kind !== 'diff') return;
    if (area === 'index' && result.value.indexTree) {
      const latest = await window.loom.git({ type: 'status', projectId });
      if (id() !== projectId || request !== diffGeneration || selected()?.path !== path) return;
      if (!latest.ok || latest.value.kind !== 'status') {
        setError(
          latest.ok
            ? 'Could not refresh Git status after loading the staged diff.'
            : latest.error.message,
        );
        return;
      }
      setStatus(latest.value);
      props.onStatus(latest.value);
      if (reviewedTree() !== latest.value.indexTree) {
        setReviewedTree(latest.value.indexTree);
        setReviewedPaths([]);
      }
      setDiff(result.value);
      if (result.value.indexTree === latest.value.indexTree) {
        setCommitReviewTree(latest.value.indexTree);
        setReviewedPaths((paths) => (paths.includes(path) ? paths : [...paths, path]));
      } else
        setError(
          'The Git index changed while opening this diff. Refresh and review the staged file again.',
        );
      return;
    }
    setDiff(result.value);
  };
  const resolveConflict = async (path: string, choice: 'working' | 'ours' | 'theirs') => {
    const projectId = id();
    if (!projectId || !window.loom || !(await props.beforeMutation())) return;
    setBusy(true);
    setError('');
    const result = await window.loom.git({ type: 'resolve', projectId, path, choice });
    setBusy(false);
    if (id() !== projectId) return;
    if (!result.ok) {
      setError(result.error.message);
      await refresh();
    } else await refresh();
  };
  const label = (code: string) =>
    code === ' '
      ? '—'
      : code === '?'
        ? 'untracked'
        : code === '!'
          ? 'ignored'
          : code === 'T'
            ? 'type changed'
            : code;
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
        <Show when={status()?.gitAvailable}>
          <div class="git-clone-controls">
            <label>
              Clone an existing repository
              <input
                value={remoteUrl()}
                onInput={(event) => setRemoteUrl(event.currentTarget.value)}
                maxLength={2000}
                placeholder="https://host/group/paper.git, git@host:group/paper.git, or file:///path/to/local.git"
              />
            </label>
            <button
              class="secondary-button"
              disabled={busy() || !remoteUrl().trim()}
              onClick={() => void clone()}
            >
              Choose location and clone
            </button>
            <p class="muted">
              Uses your configured Git credential helper or SSH key. Loom never stores remote
              credentials. A failed clone may leave a partial folder for inspection.
            </p>
          </div>
        </Show>
        <div class="git-actions">
          <button
            class="secondary-button"
            disabled={busy() || !status()?.repository}
            onClick={() => void operation('fetch')}
          >
            Fetch
          </button>
          <button
            class="secondary-button"
            disabled={busy() || !status()?.repository || !!status()?.files.length}
            onClick={() => void operation('pull')}
          >
            Pull
          </button>
          <button
            class="secondary-button"
            disabled={busy() || !status()?.upstream || status()?.detached}
            onClick={() => void operation('push')}
          >
            Push committed revisions
          </button>
          <Show when={!status()?.upstream && status()?.branch && status()?.remotes.length}>
            <label class="git-publish-remote">
              Publish branch to
              <select
                aria-label="Publish branch to remote"
                value={pushRemote() || status()?.remotes[0] || ''}
                disabled={busy()}
                onChange={(event) => setPushRemote(event.currentTarget.value)}
              >
                <For each={status()?.remotes}>
                  {(remote) => <option value={remote}>{remote}</option>}
                </For>
              </select>
            </label>
            <button
              class="secondary-button"
              disabled={busy() || !(pushRemote() || status()?.remotes[0]) || status()?.detached}
              onClick={() => void operation('push')}
            >
              Publish branch
            </button>
          </Show>
          <button
            class="primary-button"
            disabled={
              busy() ||
              (!staged().length &&
                !(
                  status()?.mergeInProgress &&
                  status()?.indexMatchesHead &&
                  status()?.indexTree &&
                  !status()?.files.some((file) => file.conflict)
                ))
            }
            onClick={() => {
              setCommitReviewTree(status()?.indexTree ?? null);
              setReviewedTree(status()?.indexTree ?? null);
              setReviewedPaths([]);
              setCommitOpen(true);
            }}
          >
            {status()?.mergeInProgress && !staged().length
              ? 'Review merge completion'
              : `Review staged commit (${staged().length})`}
          </button>
        </div>
        <div class="git-branch-controls">
          <label>
            Switch branch
            <select
              value={status()?.branch ?? ''}
              disabled={busy() || !!status()?.files.length || !status()?.repository}
              onChange={(event) => {
                const name = event.currentTarget.value;
                if (name && name !== status()?.branch) void changeBranch(name, 'switch');
              }}
            >
              <option value="">Choose a branch…</option>
              {status()?.branches.map((branch) => (
                <option value={branch}>{branch}</option>
              ))}
            </select>
          </label>
          <label>
            New branch
            <input
              value={branchName()}
              maxLength={200}
              onInput={(event) => setBranchName(event.currentTarget.value)}
              placeholder="feature/revision"
            />
          </label>
          <button
            class="secondary-button"
            disabled={busy() || !branchName().trim() || !!status()?.files.length}
            onClick={() => void changeBranch(branchName().trim(), 'create')}
          >
            Create and switch
          </button>
        </div>
        <section class="git-publication" aria-label="Publication preflight and export">
          <div class="git-actions">
            <strong>Publication</strong>
            <button class="secondary-button" disabled={busy()} onClick={() => void loadPreflight()}>
              {preflight() ? 'Refresh preflight' : 'Run preflight'}
            </button>
            <button
              class="secondary-button"
              disabled={!preflight() || busy()}
              onClick={() => void exportSource()}
            >
              Export source ZIP
            </button>
            <button
              class="text-button"
              onClick={() => {
                props.onPreparePublication();
                props.onClose();
              }}
            >
              Prepare an editable journal revision request
            </button>
          </div>
          <Show when={preflight()}>
            <p class="muted">
              {preflight()?.included.length} files included · {preflight()?.excluded.length} files
              excluded · source revision {preflight()?.revision.slice(0, 12)}
            </p>
            <Show when={buildStatusUnavailable()}>
              <p class="inline-error" role="alert">
                Could not check PDF/build status. Preflight is incomplete; retry before relying on
                PDF freshness.
              </p>
            </Show>
            <Show when={buildState()}>
              <p class="git-callout">
                Latest successful PDF:{' '}
                {buildState()?.successful
                  ? buildState()?.successful?.revision === preflight()?.revision
                    ? 'matches this source revision'
                    : 'stale · compiled from an older source revision'
                  : 'unavailable'}
                {buildState()?.current?.status === 'failed' ? ' · latest build failed' : ''}
              </p>
              <Show when={(buildState()?.successful?.diagnostics.length ?? 0) > 0}>
                <p class="muted">
                  Latest successful build diagnostics:{' '}
                  {buildState()?.successful?.diagnostics.length}. Review the build log and any
                  unresolved warnings.
                </p>
              </Show>
              <Show when={buildState()?.current?.status === 'failed'}>
                <p class="inline-error">
                  The latest build failed
                  {buildState()?.current?.diagnostics.length
                    ? ` with ${buildState()?.current?.diagnostics.length} reported diagnostics`
                    : ''}
                  . Review the build log before submission.
                </p>
              </Show>
              <Show when={buildState()?.tools.some((tool) => !tool.available) ?? false}>
                <p class="inline-error">The current tool check reports missing LaTeX tools.</p>
              </Show>
            </Show>
            <ul class="git-preflight-warnings">
              {preflight()?.warnings.map((warning) => (
                <li>{warning}</li>
              ))}
            </ul>
            <details>
              <summary>Included files</summary>
              <ul>
                {preflight()?.included.map((path) => (
                  <li>{path}</li>
                ))}
              </ul>
            </details>
            <details>
              <summary>Excluded files</summary>
              <ul>
                {preflight()?.excluded.map((entry) => (
                  <li>
                    {entry.path} · {entry.reason}
                  </li>
                ))}
              </ul>
            </details>
          </Show>
        </section>
        <Show when={commitOpen()}>
          <div class="git-commit-review" aria-label="Commit review">
            <strong>
              {status()?.mergeInProgress && !staged().length
                ? 'Review merge completion'
                : 'Review actual staged changes'}
            </strong>
            <Show when={status()?.mergeInProgress && !staged().length}>
              <p>This creates the merge commit without changes to the current tree content.</p>
            </Show>
            <p class="muted">
              {staged().length ? 'Open each staged diff below. ' : ''}Loom rechecks the index before
              commit. It will not push this commit.
            </p>
            <Show when={status()?.truncated}>
              <p role="alert">
                Reduce the changed file list before committing; this list is incomplete.
              </p>
            </Show>
            <ul>
              {staged().map((file) => (
                <li>
                  {file.path} · {label(file.index)}
                  {reviewedTree() === status()?.indexTree && reviewedPaths().includes(file.path)
                    ? ' · reviewed'
                    : ' · review diff below'}
                </li>
              ))}
            </ul>
            <label>
              Commit message
              <textarea
                value={commitMessage()}
                onInput={(event) => setCommitMessage(event.currentTarget.value)}
                maxLength={2000}
                rows={3}
              />
            </label>
            <div class="git-actions">
              <button class="secondary-button" onClick={() => setCommitOpen(false)}>
                Cancel
              </button>
              <button
                class="primary-button"
                disabled={
                  busy() ||
                  !commitMessage().trim() ||
                  !status()?.indexTree ||
                  status()?.truncated ||
                  status()?.files.some((file) => file.conflict) ||
                  reviewedTree() !== status()?.indexTree ||
                  commitReviewTree() !== status()?.indexTree ||
                  (!staged().length &&
                    !(status()?.mergeInProgress && status()?.indexMatchesHead)) ||
                  staged().some((file) => !reviewedPaths().includes(file.path))
                }
                onClick={() => void commit()}
              >
                {busy()
                  ? 'Committing…'
                  : status()?.mergeInProgress && !staged().length
                    ? 'Finish merge'
                    : 'Commit reviewed changes'}
              </button>
            </div>
          </div>
        </Show>
        <Show when={status()?.mergeInProgress}>
          <p class="git-callout">
            A merge is in progress. Review base, ours and theirs for each conflict. Edit conflict
            markers in the source pane, save, then mark the edited file resolved; choosing ours or
            theirs replaces the working file. Commit only after all conflicts are resolved.
          </p>
        </Show>
        <Show when={status()?.repository && !!status()?.files.length}>
          <p class="git-callout">
            The worktree has uncommitted changes. Review and save or commit them before pull or
            branch changes. Push sends committed revisions only.
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
                  <Show when={file.originalPath}>
                    <p class="muted">
                      From{' '}
                      {file.crossesProjectBoundary
                        ? `repository path ${file.originalPath} (outside this project; commit blocked)`
                        : file.originalPath}
                    </p>
                  </Show>
                  <div>
                    <button
                      class="text-button"
                      onClick={() => {
                        props.onSelectPath(file.path);
                        void loadDiff(file.path, 'index');
                      }}
                      aria-label={`Review staged changes to ${file.path}`}
                    >
                      Staged · {label(file.index)}
                    </button>
                    <Show when={file.index === ' ' || file.index === '?'}>
                      <button
                        class="text-button"
                        disabled={busy()}
                        onClick={() => void stageAction('stage', file.path)}
                      >
                        Stage
                      </button>
                    </Show>
                    <Show when={!file.conflict && ![' ', '?', '!'].includes(file.index)}>
                      <button
                        class="text-button"
                        disabled={busy()}
                        onClick={() => void stageAction('unstage', file.path)}
                      >
                        Unstage
                      </button>
                    </Show>
                    <button
                      class="text-button"
                      onClick={() => {
                        props.onSelectPath(file.path);
                        void loadDiff(file.path, 'worktree');
                      }}
                      aria-label={`Review unstaged changes to ${file.path}`}
                    >
                      Working · {label(file.worktree)}
                    </button>
                    <Show when={file.conflict}>
                      <div class="git-conflict-actions">
                        <button
                          class="text-button"
                          onClick={() => void loadDiff(file.path, 'base')}
                        >
                          Review base
                        </button>
                        <button
                          class="text-button"
                          onClick={() => void loadDiff(file.path, 'ours')}
                        >
                          Review ours
                        </button>
                        <button
                          class="text-button"
                          onClick={() => void loadDiff(file.path, 'theirs')}
                        >
                          Review theirs
                        </button>
                        <button
                          class="text-button"
                          onClick={async () => {
                            await props.onSelectPath(file.path);
                            setSelected(null);
                            setDiff(null);
                            props.onClose();
                          }}
                        >
                          Edit in source pane
                        </button>
                        <button
                          class="text-button"
                          disabled={busy()}
                          onClick={() => void resolveConflict(file.path, 'working')}
                        >
                          Mark edited file resolved
                        </button>
                        <button
                          class="text-button"
                          disabled={busy()}
                          onClick={() => void resolveConflict(file.path, 'ours')}
                        >
                          Resolve using ours
                        </button>
                        <button
                          class="text-button"
                          disabled={busy()}
                          onClick={() => void resolveConflict(file.path, 'theirs')}
                        >
                          Resolve using theirs
                        </button>
                      </div>
                    </Show>
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
                <small>
                  ·{' '}
                  {selected()?.area === 'index'
                    ? 'staged'
                    : selected()?.area === 'worktree'
                      ? 'working tree'
                      : `merge ${selected()?.area}`}
                </small>
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
        <Show when={notice()}>
          <p class="git-callout" role="status">
            {notice()}
          </p>
        </Show>
        <Show when={status()?.commitNotice}>
          <p class="git-callout" role="status">
            {status()?.commitNotice}
          </p>
        </Show>
        <p class="muted">
          This view reads native Git state. Editing source never commits or pushes.
        </p>
      </section>
    </Modal>
  );
}
