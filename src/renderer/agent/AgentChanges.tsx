import { createMemo, createSignal, createEffect, onMount, untrack, For, Show } from 'solid-js';
import type { AgentChange } from '../../contracts/agent';
import type { AgentWorkspace } from './workspace';
import { Icon } from '../ui/Icon';
import { IconButton, Modal } from '../ui/primitives';
import { tokenize } from '../workspace/example';
import './changes.css';
import { changeCounts, diffRows } from './changePresentation';

export type ChangeSelection = { turnId: string; path: string };
export function pendingChanges(agent: AgentWorkspace) {
  return (agent.state()?.turns ?? []).flatMap((turn) =>
    turn.changes
      .filter((change) => change.review === 'pending')
      .map((change) => ({ turnId: turn.id, change })),
  );
}
export function selectedChange(agent: AgentWorkspace, selection: ChangeSelection | null) {
  return agent
    .state()
    ?.turns.find((turn) => turn.id === selection?.turnId)
    ?.changes.find((change) => change.path === selection?.path);
}
export function AgentChanges(props: {
  agent: AgentWorkspace;
  onSelect: (selection: ChangeSelection) => void;
  onClose: () => void;
  undo: ChangeSelection[] | null;
  onUndoChange: (targets: ChangeSelection[] | null) => void;
}) {
  const a = props.agent;
  const entries = createMemo(() => pendingChanges(a));
  const projectIdentity = createMemo(() => a.projects.project()?.id);
  createEffect(() => {
    projectIdentity();
    setFailure('');
    setCollapsed(false);
  });
  const [collapsed, setCollapsed] = createSignal(false);
  const [working, setWorking] = createSignal(false);
  const [failure, setFailure] = createSignal('');
  const disabled = () => working() || a.busy() || !!a.state()?.running;
  const apply = async (targets: ChangeSelection[], action: 'keep' | 'revert') => {
    if (disabled()) return;
    setWorking(true);
    setFailure('');
    try {
      // Newest first: several observed turns may touch the same file.
      for (const target of targets) {
        if (!(await a.review(target.turnId, target.path, action))) {
          setFailure(
            'Stopped here to preserve newer writing. Completed files stay reviewed; remaining files still need review.',
          );
          return;
        }
      }
      props.onUndoChange(null);
      props.onClose();
    } finally {
      setWorking(false);
    }
  };
  const targets = () =>
    entries()
      .map(({ turnId, change }) => ({ turnId, path: change.path }))
      .reverse();
  return (
    <>
      <Show when={entries().length}>
        <section class="agent-merge-card" aria-label="Merge Changes" aria-busy={working()}>
          <div class="agent-merge-heading">
            <strong>Merge Changes</strong>
            <span>auto-applied</span>
            <div>
              <button
                class="text-button"
                disabled={disabled()}
                onClick={() => props.onUndoChange(targets())}
              >
                Undo all
              </button>
              <button
                class="text-button"
                disabled={disabled()}
                onClick={() => void apply(targets(), 'keep')}
              >
                Keep all
              </button>
              <button
                class="icon-button"
                aria-label={collapsed() ? 'Expand changes' : 'Collapse changes'}
                aria-expanded={!collapsed()}
                onClick={() => setCollapsed(!collapsed())}
              >
                <Icon name="down" size={16} />
              </button>
            </div>
          </div>
          <Show when={!collapsed()}>
            <div class="agent-merge-files">
              <For each={entries()}>
                {({ turnId, change }) => {
                  const counts = () => changeCounts(change);
                  return (
                    <div class="agent-merge-file">
                      <Icon name="fileCode" size={15} />
                      <span class="agent-merge-path" title={change.path}>
                        {change.path}
                      </span>
                      <em>{change.kind}</em>
                      <Show
                        when={!change.binary && !change.diffLimited}
                        fallback={
                          <span class="agent-merge-summary">
                            {change.binary ? 'Binary' : 'Large change'}
                          </span>
                        }
                      >
                        <span class="diff-count added">+{counts().added}</span>
                        <span class="diff-count removed">−{counts().removed}</span>
                      </Show>
                      <button
                        class="secondary-button"
                        aria-label={`Review ${change.path}`}
                        onClick={() => props.onSelect({ turnId, path: change.path })}
                      >
                        Review
                      </button>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
          <Show
            when={
              a.state()?.turns.find((turn) => turn.id === entries().at(-1)?.turnId)?.status !==
                'succeeded' && !a.state()?.running
            }
          >
            <p class="agent-merge-note">
              {a.state()?.turns.find((turn) => turn.id === entries().at(-1)?.turnId)?.status}{' '}
              request · partial changes are retained
            </p>
          </Show>
          <Show when={a.state()?.running}>
            <p class="agent-merge-note">
              Changes are still arriving. Review now; keep or undo when the request stops.
            </p>
          </Show>
          <Show when={failure()}>
            <p role="alert" class="agent-merge-note">
              {failure()}
            </p>
          </Show>
        </section>
      </Show>
      <Modal
        open={!!props.undo}
        title="Undo agent changes"
        icon="restore"
        onClose={() => {
          if (!working()) props.onUndoChange(null);
        }}
      >
        <p>
          Undo the observed changes in {props.undo?.length} file
          {props.undo?.length === 1 ? '' : 's'}? Compatible newer writing is kept. If a file
          overlaps newer edits, Loom stops and preserves both versions.
        </p>
        <ul>
          <For each={props.undo ?? []}>{(target) => <li>{target.path}</li>}</For>
        </ul>
        <Show when={failure()}>
          <p role="alert">{failure()}</p>
        </Show>
        <div class="button-row">
          <button
            class="secondary-button"
            disabled={working()}
            onClick={() => props.onUndoChange(null)}
          >
            Cancel
          </button>
          <button
            class="primary-button"
            disabled={disabled()}
            onClick={() => void apply(props.undo ?? [], 'revert')}
          >
            {working() ? 'Undoing…' : 'Undo changes'}
          </button>
        </div>
      </Modal>
    </>
  );
}

export function AgentDiff(props: {
  change: AgentChange;
  onClose: () => void;
  onKeep: () => void;
  onUndo: () => void;
  disabled: boolean;
}) {
  const path = createMemo(() => props.change.path);
  const before = createMemo(() => props.change.before);
  const after = createMemo(() => props.change.after);
  const data = createMemo(() => {
    path();
    before();
    after();
    return diffRows(untrack(() => props.change));
  });
  const hunks = () => Math.max(0, ...data().rows.map((row) => row.hunk));
  const [current, setCurrent] = createSignal(1);
  let host!: HTMLDivElement;
  let region!: HTMLElement;
  onMount(() => region.focus());
  createEffect(() => {
    data();
    setCurrent(1);
  });
  const navigate = (offset: number) => {
    const next = ((current() - 1 + offset + hunks()) % hunks()) + 1;
    setCurrent(next);
    host.querySelector(`[data-hunk="${next}"]`)?.scrollIntoView({ block: 'center' });
  };
  return (
    <section
      class="agent-source-diff"
      ref={region}
      tabIndex={-1}
      aria-label={`Changes in ${props.change.path}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div class="agent-diff-toolbar">
        <span title={props.change.path}>
          {props.change.path}{' '}
          <small>
            · {props.change.review === 'pending' ? 'Needs review' : props.change.review} · saved
            changes
          </small>
        </span>
        <div>
          <span aria-live="polite">
            {hunks() ? current() : 0}/{hunks()}
          </span>
          <IconButton
            icon="down"
            label="Next change"
            disabled={!hunks()}
            onClick={() => navigate(1)}
          />
          <IconButton
            icon="arrow"
            label="Previous change"
            disabled={!hunks()}
            onClick={() => navigate(-1)}
          />
          <IconButton
            icon="check"
            label="Keep file changes"
            disabled={props.disabled || props.change.review !== 'pending'}
            onClick={props.onKeep}
          />
          <IconButton
            icon="close"
            label="Undo file changes"
            disabled={
              props.disabled || props.change.humanTouched || props.change.review !== 'pending'
            }
            onClick={props.onUndo}
          />
          <button class="text-button" onClick={props.onClose}>
            Back to editor
          </button>
        </div>
      </div>
      <p class="agent-diff-context">
        Changes are already applied. These saved versions may include other edits observed during
        the request. Newer writing stays in the editor.
      </p>
      <Show
        when={!props.change.binary && !props.change.diffLimited}
        fallback={
          <div class="agent-diff-fallback">
            <p>
              {props.change.binary
                ? 'Binary file: a text diff is unavailable.'
                : 'This change exceeds the detailed comparison limit.'}
            </p>
            <Show when={!props.change.binary}>
              <h4>Before</h4>
              <pre>{props.change.before ?? '(missing)'}</pre>
              <h4>After</h4>
              <pre>{props.change.after ?? '(missing)'}</pre>
            </Show>
          </div>
        }
      >
        <div
          class="agent-diff-lines"
          ref={host}
          tabIndex={0}
          aria-label="Source changes, read only"
        >
          <For each={data().rows}>
            {(row) => (
              <div class={`agent-diff-line diff-${row.kind}`} data-hunk={row.hunk || undefined}>
                <span class="diff-line-number">{row.old ?? ''}</span>
                <span class="diff-line-number">{row.next ?? ''}</span>
                <span class="diff-line-sign">
                  {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
                </span>
                <code>
                  <For each={tokenize(row.text)}>
                    {(token) => <span class={token.kind}>{token.text}</span>}
                  </For>
                  {row.text === '' ? ' ' : ''}
                </code>
              </div>
            )}
          </For>
          <Show when={data().limited}>
            <details>
              <summary>Showing the first 4,000 lines · View saved versions</summary>
              <h4>Before</h4>
              <pre>{props.change.before ?? '(missing)'}</pre>
              <h4>After</h4>
              <pre>{props.change.after ?? '(missing)'}</pre>
            </details>
          </Show>
        </div>
      </Show>
      <Show when={props.change.humanTouched}>
        <p class="agent-diff-context">
          You also edited this file during the request. Automatic undo is unavailable; your writing
          is preserved.
        </p>
      </Show>
    </section>
  );
}
