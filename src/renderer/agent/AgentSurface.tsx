import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { IconButton, Modal } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { ProviderLogo } from '../ui/ProviderLogo';
import { type AgentWorkspace } from './workspace';
import { AgentChatMenus } from './AgentMenus';
export { AgentConnections } from './AgentConnections';

const questionFieldId = (questionId: string, fieldKey: string) =>
  `agent-question-${encodeURIComponent(questionId)}-${encodeURIComponent(fieldKey)}`;

export function AgentChats(props: {
  agent: AgentWorkspace;
  onConnect: () => void;
  onSelect?: () => void;
}) {
  const a = props.agent;
  return (
    <div class="agent-chats">
      <Show
        when={a.state()?.sessions.length}
        fallback={
          <div class="sidebar-empty chat-empty">
            <Icon name="chat" size={24} />
            <p>No conversations yet</p>
            <span>Ask about your paper or work on a revision together.</span>
            <button
              class="text-button"
              onClick={() =>
                a.state()?.connection === 'connected' ? void a.newChat() : props.onConnect()
              }
            >
              {a.state()?.connection === 'connected' ? 'New conversation' : 'Connect an agent'}
            </button>
          </div>
        }
      >
        <ul class="agent-chat-list">
          <For each={a.state()?.sessions}>
            {(ref) => (
              <li>
                <button
                  class="agent-chat-row"
                  classList={{ selected: a.state()?.sessionId === ref.id }}
                  aria-pressed={a.state()?.sessionId === ref.id}
                  disabled={
                    a.busy() || (a.state()?.running && a.state()?.connection === 'connected')
                  }
                  onClick={() => {
                    void a.selectChat(ref.id).then((ok) => {
                      if (ok) props.onSelect?.();
                    });
                  }}
                >
                  <ProviderLogo provider={ref.harness} size={20} />
                  <span>
                    {ref.title}
                    <small>{ref.harness === 'codex' ? 'Codex' : 'OpenCode'}</small>
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
        <button class="text-button" onClick={props.onConnect}>
          Agent connections
        </button>
      </Show>
    </div>
  );
}
export function AgentConversation(props: { agent: AgentWorkspace; onReview: () => void }) {
  const a = props.agent;
  let scroller!: HTMLDivElement;
  const [copyError, setCopyError] = createSignal('');
  const [follow, setFollow] = createSignal(true),
    [questionErrors, setQuestionErrors] = createSignal<
      Record<string, { message: string; fieldId: string }>
    >({}),
    [answers, setAnswers] = createSignal<
      Record<string, Record<string, string | string[] | boolean>>
    >({});
  const clearQuestionError = (questionId: string, fieldId: string) => {
    setQuestionErrors((old) => {
      if (old[questionId]?.fieldId !== fieldId) return old;
      const next = { ...old };
      delete next[questionId];
      return next;
    });
  };
  const updateQuestionAnswer = (
    questionId: string,
    fieldId: string,
    fieldKey: string,
    value: string | string[] | boolean,
  ) => {
    setAnswers((old) => ({
      ...old,
      [questionId]: { ...old[questionId], [fieldKey]: value },
    }));
    clearQuestionError(questionId, fieldId);
  };
  const content = createMemo(
    () =>
      a
        .state()
        ?.messages.map((m) => m.id + m.text + m.state)
        .join('|') +
      JSON.stringify(a.state()?.permissions) +
      JSON.stringify(a.state()?.questions),
  );
  createEffect(() => {
    content();
    if (follow())
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
  });
  const changed = () =>
    a
      .state()
      ?.turns.reduce((n, t) => n + t.changes.filter((c) => c.review === 'pending').length, 0) ?? 0;
  return (
    <Show when={a.open()}>
      <section class="agent-conversation" aria-label="Conversation about this paper">
        <div class="agent-conversation-heading">
          <IconButton
            icon="down"
            label="Hide conversation"
            onClick={() => {
              a.setOpen(false);
              requestAnimationFrame(() =>
                document.querySelector<HTMLTextAreaElement>('.agent-prompt')?.focus(),
              );
            }}
          />
          <span>
            {a.state()?.sessions.find((s) => s.id === a.state()?.sessionId)?.title ??
              'New conversation'}
          </span>
          <div>
            <Show when={changed()}>
              <button class="text-button" onClick={props.onReview}>
                Review changes ({changed()})
              </button>
            </Show>
            <IconButton
              icon="plus"
              label="New conversation"
              disabled={a.busy() || a.state()?.running || a.state()?.connection !== 'connected'}
              onClick={() => void a.newChat()}
            />
          </div>
        </div>
        <div
          class="agent-messages"
          ref={scroller}
          onScroll={() =>
            setFollow(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60)
          }
        >
          <Show
            when={a.state()?.messages.length}
            fallback={
              <p class="agent-chat-guidance">
                Ask where an assumption enters your paper, discuss an idea, or request a focused
                revision. The agent can inspect relevant project files.
              </p>
            }
          >
            <For each={a.state()?.messages}>
              {(message) => (
                <div
                  class="agent-message"
                  classList={{
                    'agent-message-user': message.role === 'user',
                    'agent-message-tool': message.role === 'tool',
                    'agent-message-status': message.role === 'status',
                  }}
                >
                  <small>
                    <Show
                      when={message.role === 'assistant'}
                      fallback={
                        <Icon
                          name={
                            message.role === 'user'
                              ? 'user'
                              : message.role === 'tool'
                                ? 'terminal'
                                : 'info'
                          }
                          size={13}
                        />
                      }
                    >
                      <ProviderLogo provider={a.state()?.harness ?? 'opencode'} size={17} />
                    </Show>
                    {message.role === 'user'
                      ? 'You'
                      : message.role === 'assistant'
                        ? a.state()?.harness === 'codex'
                          ? 'Codex'
                          : 'OpenCode'
                        : message.role === 'tool'
                          ? 'Tool activity'
                          : 'Request status'}
                    {message.state ? ' · ' + message.state : ''}
                  </small>
                  <div>{message.text}</div>
                  <Show when={message.role === 'assistant' || message.role === 'user'}>
                    <IconButton
                      icon="copy"
                      label="Copy message"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(message.text)
                          .catch(() =>
                            setCopyError(
                              'Could not copy this message. Select its text and copy it instead.',
                            ),
                          );
                      }}
                    />
                  </Show>
                </div>
              )}
            </For>
          </Show>
          <Show when={copyError()}>
            <p role="alert" class="agent-inline-error">
              {copyError()}
            </p>
          </Show>
          <Show when={a.state()?.running}>
            <p class="agent-activity" role="status">
              {a.state()?.permissions.length
                ? 'Waiting for your permission'
                : a.state()?.questions.length
                  ? 'Waiting for your answer'
                  : 'Thinking…'}
            </p>
          </Show>
          <For each={a.state()?.permissions}>
            {(permission) => (
              <div class="agent-request">
                <h4>Permission needed: {permission.action}</h4>
                <pre>{permission.resources.join('\n')}</pre>
                <p>
                  Allow this operation once using the agent’s permission system. Read the requested
                  action and paths above before allowing it.
                </p>
                <div class="button-row">
                  <button
                    class="secondary-button"
                    disabled={a.busy()}
                    onClick={() => {
                      const projectId = a.projects.project()?.id;
                      if (projectId)
                        void a.act({
                          type: 'permission',
                          projectId,
                          requestId: permission.id,
                          reply: 'reject',
                        });
                    }}
                  >
                    Deny
                  </button>
                  <button
                    class="primary-button"
                    disabled={a.busy()}
                    onClick={() => {
                      const projectId = a.projects.project()?.id;
                      if (projectId)
                        void a.act({
                          type: 'permission',
                          projectId,
                          requestId: permission.id,
                          reply: 'once',
                        });
                    }}
                  >
                    Allow once
                  </button>
                </div>
              </div>
            )}
          </For>
          <For each={a.state()?.questions}>
            {(question) => (
              <form
                noValidate
                class="agent-request"
                onSubmit={(e) => {
                  e.preventDefault();
                  const rawValues: Record<string, string | string[] | boolean | undefined> = {
                    ...Object.fromEntries(
                      question.fields
                        .filter((f) => f.type === 'boolean')
                        .map((f) => [f.key, false]),
                    ),
                    ...(answers()[question.id] ?? {}),
                  };
                  const isEmpty = (value: string | string[] | boolean | undefined) =>
                    value === undefined ||
                    (typeof value === 'string' && value.trim() === '') ||
                    (Array.isArray(value) && value.length === 0);
                  const invalid = question.fields.find((field) => {
                    if (field.type === 'external') return true;
                    if (field.type === 'boolean') return false;
                    const value = rawValues[field.key];
                    const empty = isEmpty(value);
                    if (field.required && empty) return true;
                    if ((field.type === 'number' || field.type === 'integer') && !empty) {
                      const number = Number(value);
                      return (
                        !Number.isFinite(number) ||
                        (field.type === 'integer' && !Number.isInteger(number))
                      );
                    }
                    return false;
                  });
                  if (invalid) {
                    const value = rawValues[invalid.key];
                    const empty = isEmpty(value);
                    const label = invalid.title || invalid.key;
                    const message =
                      invalid.type === 'external'
                        ? `${label} needs an answer in the harness because Loom cannot display this control.`
                        : !empty && (invalid.type === 'number' || invalid.type === 'integer')
                          ? !Number.isFinite(Number(value))
                            ? `Enter a finite number for ${label}.`
                            : `Enter a whole number for ${label}.`
                          : `Answer ${label} before sending.`;
                    const fieldId = questionFieldId(question.id, invalid.key);
                    setQuestionErrors((old) => ({
                      ...old,
                      [question.id]: { message, fieldId },
                    }));
                    requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
                    return;
                  }
                  const values: Record<string, string | string[] | boolean | number> = {};
                  for (const field of question.fields) {
                    const value = rawValues[field.key];
                    if (field.type === 'boolean') {
                      values[field.key] = value === true;
                    } else if (field.type === 'number' || field.type === 'integer') {
                      if (!isEmpty(value)) values[field.key] = Number(value);
                    } else if (value !== undefined) {
                      values[field.key] = value;
                    }
                  }
                  setQuestionErrors((old) => {
                    const next = { ...old };
                    delete next[question.id];
                    return next;
                  });
                  const projectId = a.projects.project()?.id;
                  if (projectId)
                    void a.act({
                      type: 'answer',
                      projectId,
                      requestId: question.id,
                      answer: values,
                    });
                }}
              >
                <h4>{question.title}</h4>
                <Show when={questionErrors()[question.id]?.message}>
                  <p class="inline-error" role="alert">
                    {questionErrors()[question.id]?.message}
                  </p>
                </Show>
                <For each={question.fields}>
                  {(field) => {
                    const fieldId = questionFieldId(question.id, field.key);
                    const descriptionId = `${fieldId}-description`;
                    const invalid = () => questionErrors()[question.id]?.fieldId === fieldId;
                    return (
                      <label class="field-label">
                        {field.title || field.key}
                        <Show when={field.description}>
                          <span id={descriptionId}>{field.description}</span>
                        </Show>
                        <Show
                          when={field.type !== 'external'}
                          fallback={
                            <p id={fieldId} tabIndex={-1}>
                              This question needs a control that Loom cannot display. Answer in the
                              harness or stop this request.
                            </p>
                          }
                        >
                          <Show
                            when={field.options.length}
                            fallback={
                              <input
                                id={fieldId}
                                type={field.type === 'boolean' ? 'checkbox' : 'text'}
                                inputmode={
                                  field.type === 'number' || field.type === 'integer'
                                    ? 'decimal'
                                    : undefined
                                }
                                value={
                                  field.type === 'boolean'
                                    ? undefined
                                    : String(answers()[question.id]?.[field.key] ?? '')
                                }
                                checked={
                                  field.type === 'boolean'
                                    ? answers()[question.id]?.[field.key] === true
                                    : undefined
                                }
                                required={field.required && field.type !== 'boolean'}
                                aria-invalid={
                                  field.type !== 'boolean' && invalid() ? 'true' : undefined
                                }
                                aria-describedby={field.description ? descriptionId : undefined}
                                onInput={(e) =>
                                  updateQuestionAnswer(
                                    question.id,
                                    fieldId,
                                    field.key,
                                    field.type === 'boolean'
                                      ? e.currentTarget.checked
                                      : e.currentTarget.value,
                                  )
                                }
                              />
                            }
                          >
                            <select
                              id={fieldId}
                              multiple={field.type === 'multiselect'}
                              value={answers()[question.id]?.[field.key] as string | undefined}
                              required={field.required && field.type !== 'boolean'}
                              aria-invalid={invalid() ? 'true' : undefined}
                              aria-describedby={field.description ? descriptionId : undefined}
                              aria-label={field.title || field.key}
                              onChange={(e) =>
                                updateQuestionAnswer(
                                  question.id,
                                  fieldId,
                                  field.key,
                                  field.type === 'multiselect'
                                    ? Array.from(e.currentTarget.selectedOptions).map(
                                        (o) => o.value,
                                      )
                                    : e.currentTarget.value,
                                )
                              }
                            >
                              <Show when={field.type !== 'multiselect'}>
                                <option value="">Choose an answer</option>
                              </Show>
                              <For each={field.options}>
                                {(option) => <option value={option.value}>{option.label}</option>}
                              </For>
                            </select>
                          </Show>
                        </Show>
                      </label>
                    );
                  }}
                </For>
                <div class="button-row">
                  <Show when={question.rejectable}>
                    <button
                      type="button"
                      class="secondary-button"
                      disabled={a.busy()}
                      onClick={() => {
                        const projectId = a.projects.project()?.id;
                        if (projectId)
                          void a.act({
                            type: 'answer',
                            projectId,
                            requestId: question.id,
                            answer: {},
                            reject: true,
                          });
                      }}
                    >
                      Deny
                    </button>
                  </Show>
                  <button
                    class="primary-button"
                    disabled={a.busy() || question.fields.some((f) => f.type === 'external')}
                  >
                    Send answer
                  </button>
                </div>
              </form>
            )}
          </For>
          <Show when={!follow()}>
            <button
              class="text-button agent-follow"
              onClick={() => {
                setFollow(true);
                scroller.scrollTop = scroller.scrollHeight;
              }}
            >
              Jump to latest
            </button>
          </Show>
        </div>
      </section>
    </Show>
  );
}
export function AgentComposer(props: {
  agent: AgentWorkspace;
  onConnect: () => void;
  onReview: () => void;
}) {
  const a = props.agent;
  const [attachOpen, setAttachOpen] = createSignal(false),
    [file, setFile] = createSignal('');
  let input!: HTMLTextAreaElement;
  const ready = () => a.state()?.connection === 'connected',
    running = () => a.state()?.running || a.submitting();
  const changed = () =>
    a
      .state()
      ?.turns.reduce((n, t) => n + t.changes.filter((c) => c.review === 'pending').length, 0) ?? 0;
  return (
    <>
      <div class="composer agent-composer">
        <textarea
          ref={input}
          class="agent-prompt resize-none"
          aria-label="Ask about your paper"
          placeholder={
            a.projects.project() ? 'Ask anything' : 'Open a paper to work with an agent…'
          }
          rows={2}
          style={{ resize: 'none' }}
          maxLength={50000}
          value={a.draft()}
          onInput={(e) => a.setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
              e.preventDefault();
              void a.send();
            }
          }}
        />
        <Show when={a.attachments().length || a.selection()}>
          <div class="agent-attachments">
            <For each={a.attachments()}>
              {(path) => (
                <button
                  title={`Remove attached file ${path}`}
                  aria-label={`Remove attached file ${path}`}
                  onClick={() => a.setAttachments((old) => old.filter((p) => p !== path))}
                >
                  {path} ×
                </button>
              )}
            </For>
            <Show when={a.selection()}>
              <button title={a.selection()?.text} onClick={() => a.setSelection(null)}>
                Selected passage · {a.selection()?.path} ×
              </button>
            </Show>
          </div>
        </Show>
        <Show when={a.projects.file() && !a.selection()}>
          <button
            class="text-button agent-selection-action"
            onClick={() => a.attachSelection()}
            disabled={running()}
          >
            Attach selected text
          </button>
        </Show>
        <div class="composer-actions">
          <IconButton
            label="Attach text or project files"
            icon="plus"
            disabled={!a.projects.project() || running()}
            onClick={() => setAttachOpen(true)}
          />
          <AgentChatMenus agent={a} onConnect={props.onConnect} />
          <IconButton label="Agent connections" icon="settings" onClick={props.onConnect} />
          <button
            class="send-button"
            disabled={
              running()
                ? a.busy() && !a.submitting()
                : !ready() || !a.model() || !a.draft().trim() || a.busy()
            }
            aria-label={running() ? 'Stop agent request' : 'Send to agent'}
            title={running() ? 'Stop agent request' : 'Send · Ctrl Enter'}
            onClick={() => (running() ? void a.cancel() : void a.send())}
          >
            <Show when={running()} fallback={<Icon name="arrow" size={22} />}>
              <span class="agent-stop-square" />
            </Show>
          </button>
        </div>
      </div>
      <Show when={ready() && !a.state()?.models.length}>
        <div class="agent-inline-error">
          <span>No models available. Configure a model in your agent, then reconnect.</span>
          <button class="text-button" onClick={props.onConnect}>
            Agent setup
          </button>
        </div>
      </Show>

      <div class="agent-composer-status">
        <button class="text-button" onClick={() => a.setOpen(!a.open())}>
          {a.open()
            ? 'Hide conversation'
            : a.state()?.permissions.length
              ? 'View permission request'
              : a.state()?.questions.length
                ? 'Answer agent question'
                : 'Show conversation'}
        </button>
        <span role="status" aria-live="polite">
          {a.state()?.permissions.length
            ? 'Needs your permission'
            : a.state()?.questions.length
              ? 'Needs your answer'
              : running()
                ? 'Agent working'
                : ready()
                  ? 'Agent connected'
                  : 'Agent disconnected'}
        </span>
        <Show when={changed()}>
          <button class="text-button" onClick={props.onReview}>
            <Icon name="edit" size={13} />
            Review {changed()} change{changed() === 1 ? '' : 's'}
          </button>
        </Show>
      </div>
      <Show when={a.error() || a.state()?.error}>
        <div class="agent-inline-error" role="alert">
          <span>{a.error() || a.state()?.error}</span>
          <button class="text-button" onClick={props.onConnect}>
            Connection details
          </button>
        </div>
      </Show>
      <Modal
        open={attachOpen()}
        title="Attach context"
        icon="fileText"
        onClose={() => setAttachOpen(false)}
      >
        <p>
          Add a selected passage or source files for this request. The agent can also inspect
          relevant files in your paper.
        </p>
        <p class="help-text">
          {a.model()?.images
            ? 'The selected model accepts images, but image attachments are not available in Loom yet.'
            : 'The selected model accepts text attachments.'}
        </p>
        <button
          class="secondary-button"
          onClick={() => {
            if (a.attachSelection()) setAttachOpen(false);
          }}
        >
          Attach selected text
        </button>
        <label class="field-label">
          Project text file
          <select value={file()} onChange={(e) => setFile(e.currentTarget.value)}>
            <option value="">Choose a file</option>
            <For each={a.projects.project()?.files.filter((f) => !f.deleted && f.text !== null)}>
              {(f) => <option value={f.path}>{f.path}</option>}
            </For>
          </select>
        </label>
        <button
          class="primary-button"
          disabled={!file() || a.attachments().length >= 20}
          onClick={() => {
            a.setAttachments((old) => [...new Set([...old, file()])]);
            setFile('');
            setAttachOpen(false);
            input?.focus();
          }}
        >
          Attach file
        </button>
        <Show when={a.error()}>
          <p class="inline-error" role="alert">
            {a.error()}
          </p>
        </Show>
      </Modal>
    </>
  );
}
export function AgentReview(props: {
  agent: AgentWorkspace;
  open: boolean;
  onClose: () => void;
  onCompile: () => void;
}) {
  const a = props.agent;
  const [confirm, setConfirm] = createSignal<{ turnId: string; path: string } | null>(null);
  const turns = () => a.state()?.turns.filter((t) => t.changes.length) ?? [];
  return (
    <Modal open={props.open} title="Review file changes" icon="edit" onClose={props.onClose}>
      <p>
        These files changed during an agent request. Edits are already on disk; this is review after
        writing. Changes may also include other edits made during the request.
      </p>
      <Show when={turns().length} fallback={<p>No observed file changes yet.</p>}>
        <For each={turns()}>
          {(turn) => (
            <section class="agent-review-turn">
              <h3>
                {turn.status === 'running'
                  ? 'Request in progress'
                  : turn.status === 'succeeded'
                    ? 'Completed request'
                    : `${turn.status} request`}
              </h3>
              <p>
                {new Date(turn.startedAt).toLocaleString()} · {turn.changes.length} file
                {turn.changes.length === 1 ? '' : 's'}
              </p>
              <For each={turn.changes}>
                {(change) => (
                  <details class="agent-change">
                    <summary>
                      {change.path}{' '}
                      <span>
                        {change.kind} · {change.review}
                      </span>
                    </summary>
                    <Show when={change.humanTouched}>
                      <p>
                        You also edited this file during the request. Automatic revert is
                        unavailable so your writing is preserved.
                      </p>
                    </Show>
                    <Show
                      when={!change.binary}
                      fallback={<p>Binary file changed. Recovery retains its original bytes.</p>}
                    >
                      <p class="muted">
                        − Before request · + Observed after request. Long comparisons may be
                        truncated; original recovery bytes are retained.
                      </p>
                      <Show when={change.diffLimited}>
                        <p>
                          Detailed diff exceeded its limit. Before and after sections are shown;
                          very long text is truncated.
                        </p>
                      </Show>
                      <pre class="agent-diff">
                        <For
                          each={
                            change.diff ?? [
                              { text: change.before ?? '', kind: 'removed' },
                              { text: change.after ?? '', kind: 'added' },
                            ]
                          }
                        >
                          {(part) => (
                            <span
                              classList={{
                                'diff-added': part.kind === 'added',
                                'diff-removed': part.kind === 'removed',
                              }}
                            >
                              {part.text
                                .split(/(?<=\n)/)
                                .map(
                                  (line) =>
                                    (part.kind === 'added'
                                      ? '+ '
                                      : part.kind === 'removed'
                                        ? '− '
                                        : '  ') + line,
                                )
                                .join('')}
                            </span>
                          )}
                        </For>
                      </pre>
                    </Show>
                    <Show when={change.review === 'pending'}>
                      <div class="button-row">
                        <button
                          class="secondary-button"
                          disabled={a.busy() || a.state()?.running}
                          onClick={() => void a.review(turn.id, change.path, 'keep')}
                        >
                          Keep change
                        </button>
                        <button
                          class="secondary-button"
                          disabled={a.busy() || a.state()?.running || change.humanTouched}
                          onClick={() => setConfirm({ turnId: turn.id, path: change.path })}
                        >
                          Revert change…
                        </button>
                      </div>
                      <Show when={confirm()?.turnId === turn.id && confirm()?.path === change.path}>
                        <div class="agent-revert-confirm">
                          <p>
                            Revert the observed change in {change.path}? Compatible newer writing
                            will be kept. If changes overlap, Loom will keep both versions and stop
                            the revert.
                          </p>
                          <div class="button-row">
                            <button
                              class="secondary-button"
                              onClick={() => setConfirm(null)}
                              autofocus
                            >
                              Cancel
                            </button>
                            <button
                              class="primary-button"
                              disabled={a.busy()}
                              onClick={() => {
                                void a.review(turn.id, change.path, 'revert').then((ok) => {
                                  if (ok) setConfirm(null);
                                });
                              }}
                            >
                              Revert this file
                            </button>
                          </div>
                        </div>
                      </Show>
                    </Show>
                  </details>
                )}
              </For>
            </section>
          )}
        </For>
        <button
          class="primary-button"
          disabled={a.state()?.running || a.busy()}
          onClick={props.onCompile}
        >
          Update PDF
        </button>
      </Show>
      <Show when={a.error()}>
        <p class="inline-error" role="alert">
          {a.error()}
        </p>
      </Show>
    </Modal>
  );
}
