import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { HarnessKind } from '../../contracts/agent';
import { IconButton, Modal } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { type AgentWorkspace, modelIdentity } from './workspace';

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
                  <Icon name="chat" size={16} />
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
export function AgentConnections(props: {
  agent: AgentWorkspace;
  open: boolean;
  onClose: () => void;
  onOpenProject: () => void;
}) {
  const a = props.agent;
  const [selected, setSelected] = createSignal<HarnessKind>('opencode'),
    [external, setExternal] = createSignal(false),
    [endpoint, setEndpoint] = createSignal('http://127.0.0.1:4096'),
    [username, setUsername] = createSignal('opencode'),
    [password, setPassword] = createSignal(''),
    [showPassword, setShowPassword] = createSignal(false);
  let wasOpen = false;
  createEffect(() => {
    if (props.open && !wasOpen) {
      setSelected(a.state()?.harness ?? 'opencode');
      void a.refresh(true);
    }
    if (!props.open) {
      setPassword('');
      setShowPassword(false);
    }
    wasOpen = props.open;
  });
  const provider = () => a.state()?.providers.find((p) => p.id === selected());
  const connected = () =>
    a.state()?.harness === selected() && a.state()?.connection === 'connected';
  const name = () => (selected() === 'codex' ? 'Codex' : 'OpenCode');
  return (
    <Modal open={props.open} title="Agent connections" onClose={props.onClose}>
      <p class="dialog-description">
        Use your existing agent account and its available models. The agent can read relevant paper
        files. Your request, attachments and the file contents it reads are sent to its configured
        model.
      </p>
      <Show
        when={a.projects.project()}
        fallback={
          <div class="dialog-section">
            <p>Open a paper folder to connect its agent.</p>
            <button class="primary-button" onClick={props.onOpenProject}>
              Open or create project
            </button>
          </div>
        }
      >
        <div class="agent-provider-picker" role="group" aria-label="Agent providers">
          <For each={['opencode', 'codex'] as HarnessKind[]}>
            {(id) => (
              <button
                aria-pressed={selected() === id}
                classList={{ selected: selected() === id }}
                onClick={() => setSelected(id)}
              >
                <span>{id === 'codex' ? 'Codex' : 'OpenCode'}</span>
                <small>
                  {a.state()?.providers.find((p) => p.id === id)?.version ?? 'Checking…'}
                </small>
              </button>
            )}
          </For>
        </div>
        <section class="dialog-section agent-provider-details">
          <h3>{name()}</h3>
          <p class="agent-connection-state">
            {connected()
              ? 'Connected to this paper'
              : a.state()?.harness === selected() && a.state()?.connection === 'interrupted'
                ? 'Connection interrupted'
                : provider()?.installed
                  ? 'Installed · ready to connect'
                  : provider()?.version === 'Not checked'
                    ? 'Checking installation…'
                    : 'Not installed'}
          </p>
          <Show when={connected()}>
            <p>
              {!a.state()?.models.length
                ? 'No models available. Use the setup guide to configure a model in this agent, then reconnect.'
                : provider()?.auth === 'required'
                  ? 'Sign-in required. Open the selected agent and sign in, then reconnect.'
                  : provider()?.auth === 'available'
                    ? 'An account is configured through this agent. Model access is checked when you send.'
                    : `${a.state()?.models.length ?? 0} configured models available. Access is checked when you send a request.`}
            </p>
            <p>
              {a.state()?.ownership === 'external'
                ? 'Disconnect detaches from your server; Loom does not stop it.'
                : 'Loom manages this agent process and closes it on disconnect.'}
            </p>
          </Show>
          <p class="agent-direct-copy">
            Agent requests can change your files directly using the permissions configured in your
            agent. Review changes afterward to keep or revert them. These permissions may also allow
            access outside the paper folder.
          </p>
          <div class="button-row">
            <Show
              when={connected()}
              fallback={
                <button
                  class="primary-button"
                  disabled={
                    a.busy() || (a.state()?.running && a.state()?.connection === 'connected')
                  }
                  onClick={() => {
                    if (
                      provider()?.version !== 'Not checked' &&
                      !provider()?.installed &&
                      !(selected() === 'opencode' && external())
                    ) {
                      void window.loom?.openSetup(selected());
                      return;
                    }
                    void a
                      .connect(
                        selected(),
                        selected() === 'opencode' && external() ? endpoint() : undefined,
                        username(),
                        password(),
                      )
                      .then((ok) => {
                        if (ok) setPassword('');
                      });
                  }}
                >
                  {a.busy()
                    ? 'Connecting…'
                    : a.state()?.connection === 'interrupted' && a.state()?.harness === selected()
                      ? 'Reconnect'
                      : provider()?.version !== 'Not checked' &&
                          !provider()?.installed &&
                          !(selected() === 'opencode' && external())
                        ? `Set up ${name()}`
                        : `Connect ${name()}`}
                </button>
              }
            >
              <button
                class="secondary-button"
                disabled={a.busy()}
                onClick={() => {
                  const projectId = a.projects.project()?.id;
                  if (projectId) void a.act({ type: 'disconnect', projectId });
                }}
              >
                Disconnect
              </button>
            </Show>
            <button
              class="secondary-button"
              onClick={() => void window.loom?.openSetup(selected())}
            >
              Setup guide
            </button>
          </div>
          <Show when={!connected()}>
            <p>
              {provider()?.installed
                ? 'If you need to sign in, use'
                : 'Install ' + name() + ', then sign in using'}{' '}
              <code>{selected() === 'codex' ? 'codex login' : 'opencode auth login'}</code>. Loom
              reuses that setup and does not store your provider keys.
            </p>
          </Show>
          <details>
            <summary>Connection details</summary>
            <p>
              Supported versions: OpenCode 2.2.x from 2.2.1; Codex 0.159.x. Detected version:{' '}
              {provider()?.version ?? 'Checking…'}.
            </p>
            <p>
              {a.state()?.toolsAvailable && connected()
                ? 'Loom paper structure, PDF status and build tools are connected.'
                : selected() === 'opencode'
                  ? 'Loom tools connect with managed agent instances. Existing OpenCode servers keep their own tools and permissions.'
                  : 'Loom paper and PDF tools connect when you start a managed Codex instance.'}
            </p>
            <Show when={selected() === 'opencode'}>
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={external()}
                  disabled={connected()}
                  onChange={(e) => setExternal(e.currentTarget.checked)}
                />
                Use an existing local OpenCode server
              </label>
              <Show when={external()}>
                <label class="field-label">
                  Server address
                  <input
                    value={endpoint()}
                    onInput={(e) => setEndpoint(e.currentTarget.value)}
                    disabled={connected()}
                  />
                </label>
                <label class="field-label">
                  Server username
                  <input
                    value={username()}
                    onInput={(e) => setUsername(e.currentTarget.value)}
                    disabled={connected()}
                  />
                </label>
                <label class="field-label">
                  Server password
                  <input
                    type={showPassword() ? 'text' : 'password'}
                    autocomplete="off"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    disabled={connected()}
                  />
                </label>
                <button
                  class="text-button"
                  aria-pressed={showPassword()}
                  onClick={() => setShowPassword(!showPassword())}
                >
                  {showPassword() ? 'Hide password' : 'Show password'}
                </button>
                <p>
                  Use a private address such as 127.0.0.1. The password stays in memory for this
                  connection.
                </p>
              </Show>
            </Show>
          </details>
        </section>
        <Show when={a.error() || a.state()?.error}>
          <p class="inline-error" role="alert">
            {a.error() || a.state()?.error}
          </p>
        </Show>
      </Show>
    </Modal>
  );
}
export function AgentConversation(props: { agent: AgentWorkspace; onReview: () => void }) {
  const a = props.agent;
  let scroller!: HTMLDivElement;
  const [follow, setFollow] = createSignal(true),
    [questionError, setQuestionError] = createSignal(''),
    [answers, setAnswers] = createSignal<
      Record<string, Record<string, string | string[] | boolean | number>>
    >({});
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
          <span>
            <Icon name="chat" size={14} />{' '}
            {a.state()?.sessions.find((s) => s.id === a.state()?.sessionId)?.title ??
              'New conversation'}{' '}
            · {a.projects.project()?.name ?? 'Paper'}
          </span>
          <div>
            <Show when={changed()}>
              <button class="text-button" onClick={props.onReview}>
                Review changes ({changed()})
              </button>
            </Show>
            <IconButton
              icon="close"
              label="Hide conversation"
              onClick={() => {
                a.setOpen(false);
                requestAnimationFrame(() =>
                  document.querySelector<HTMLTextAreaElement>('.agent-prompt')?.focus(),
                );
              }}
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
                </div>
              )}
            </For>
          </Show>
          <Show when={a.state()?.running}>
            <p class="agent-activity" role="status">
              {a.state()?.permissions.length
                ? 'Waiting for your permission'
                : a.state()?.questions.length
                  ? 'Waiting for your answer'
                  : 'Working on your request…'}
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
                  const values = {
                    ...Object.fromEntries(
                      question.fields
                        .filter((f) => f.type === 'boolean')
                        .map((f) => [f.key, false]),
                    ),
                    ...answers()[question.id],
                  };
                  const missing = question.fields.find(
                    (field) =>
                      field.required &&
                      (values[field.key] === undefined ||
                        values[field.key] === '' ||
                        (Array.isArray(values[field.key]) &&
                          !(values[field.key] as string[]).length)),
                  );
                  if (missing) {
                    setQuestionError(
                      'Answer ' + (missing.title || missing.key) + ' before sending.',
                    );
                    e.currentTarget.querySelector<HTMLElement>('input,select')?.focus();
                    return;
                  }
                  setQuestionError('');
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
                <Show when={questionError()}>
                  <p class="inline-error" role="alert">
                    {questionError()}
                  </p>
                </Show>
                <For each={question.fields}>
                  {(field) => (
                    <label class="field-label">
                      {field.title || field.key}
                      <Show when={field.description}>
                        <span>{field.description}</span>
                      </Show>
                      <Show
                        when={field.type !== 'external'}
                        fallback={
                          <p>
                            This question needs a control that Loom cannot display. Answer in the
                            harness or stop this request.
                          </p>
                        }
                      >
                        <Show
                          when={field.options.length}
                          fallback={
                            <input
                              type={
                                field.type === 'boolean'
                                  ? 'checkbox'
                                  : field.type === 'number' || field.type === 'integer'
                                    ? 'number'
                                    : 'text'
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
                              required={field.required}
                              aria-invalid={
                                !!questionError() &&
                                field.required &&
                                !answers()[question.id]?.[field.key]
                              }
                              onInput={(e) =>
                                setAnswers((old) => ({
                                  ...old,
                                  [question.id]: {
                                    ...old[question.id],
                                    [field.key]:
                                      field.type === 'boolean'
                                        ? e.currentTarget.checked
                                        : field.type === 'number' || field.type === 'integer'
                                          ? Number(e.currentTarget.value)
                                          : e.currentTarget.value,
                                  },
                                }))
                              }
                            />
                          }
                        >
                          <select
                            multiple={field.type === 'multiselect'}
                            value={answers()[question.id]?.[field.key] as string | undefined}
                            required={field.required}
                            aria-invalid={
                              !!questionError() &&
                              field.required &&
                              !answers()[question.id]?.[field.key]
                            }
                            aria-label={field.title || field.key}
                            onChange={(e) =>
                              setAnswers((old) => ({
                                ...old,
                                [question.id]: {
                                  ...old[question.id],
                                  [field.key]:
                                    field.type === 'multiselect'
                                      ? Array.from(e.currentTarget.selectedOptions).map(
                                          (o) => o.value,
                                        )
                                      : e.currentTarget.value,
                                },
                              }))
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
                  )}
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
            a.projects.project() ? 'Ask about your paper…' : 'Open a paper to work with an agent…'
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
          <button
            class="model-button agent-harness-button"
            onClick={props.onConnect}
            title="Agent connections"
          >
            {ready() ? (a.state()?.harness === 'codex' ? 'Codex' : 'OpenCode') : 'Connect agent'}
            <Icon name="down" size={13} />
          </button>
          <Show when={ready() && a.state()?.models.length}>
            <select
              class="agent-model-select"
              aria-label="Agent model"
              value={a.model() ? modelIdentity(a.model()!) : ''}
              disabled={running()}
              onChange={(e) => a.setModelKey(e.currentTarget.value)}
            >
              <For each={a.state()?.models}>
                {(model) => (
                  <option value={modelIdentity(model)}>
                    {model.name} · {model.providerId}
                  </option>
                )}
              </For>
            </select>
          </Show>
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
      <Show when={ready() && a.model()}>
        <div class="agent-capabilities">
          {a.model()?.tools
            ? 'Can inspect files and use project tools'
            : 'Discussion model · cannot inspect or edit project files with tools'}
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
      <Modal open={attachOpen()} title="Attach context" onClose={() => setAttachOpen(false)}>
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
    <Modal open={props.open} title="Review file changes" onClose={props.onClose}>
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
