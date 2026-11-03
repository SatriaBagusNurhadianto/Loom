import { createMemo, createSignal, createUniqueId, For, onCleanup, Show, type JSX } from 'solid-js';
import type { AgentWorkspace } from './workspace';
import { modelIdentity } from './workspace';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton } from '../ui/primitives';
import './menus.css';

/** Native top-layer popover shared by the chat's searchable model and option menus. */
function ChoicePopover(props: {
  label: string;
  text: string;
  icon: IconName;
  disabled?: boolean;
  children: (close: () => void) => JSX.Element;
}) {
  const id = createUniqueId(),
    [open, setOpen] = createSignal(false);
  let trigger!: HTMLButtonElement, popup!: HTMLDivElement;
  const items = () => [
    ...popup.querySelectorAll<HTMLButtonElement>('[data-choice]:not(:disabled)'),
  ];
  const close = (restore = true) => {
    if (popup.matches(':popover-open')) popup.hidePopover();
    if (restore) trigger.focus();
  };
  const show = () => {
    popup.showPopover();
    const rect = trigger.getBoundingClientRect(),
      bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - bounds.width - 8))}px`;
    popup.style.top = `${Math.max(8, rect.top - bounds.height - 8)}px`;
    (
      popup.querySelector<HTMLElement>('[data-search]') ??
      popup.querySelector<HTMLElement>('[data-choice][aria-pressed="true"]') ??
      items()[0]
    )?.focus();
  };
  const resize = () => close(false);
  window.addEventListener('resize', resize);
  onCleanup(() => window.removeEventListener('resize', resize));
  return (
    <>
      <button
        ref={trigger}
        class="agent-choice-trigger"
        aria-label={props.label}
        title={props.label}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open()}
        disabled={props.disabled}
        onClick={() => (open() ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        <Icon name={props.icon} size={16} />
        <span>{props.text}</span>
        <Icon name="down" size={12} />
      </button>
      <div
        ref={popup}
        id={id}
        class="agent-choice-popup"
        role="dialog"
        aria-label={props.label}
        popover="auto"
        onToggle={() => setOpen(popup.matches(':popover-open'))}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          const choices = items(),
            index = choices.indexOf(document.activeElement as HTMLButtonElement);
          const search = document.activeElement?.hasAttribute('data-search');
          if (
            ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
            (!search || event.key.startsWith('Arrow'))
          ) {
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? choices.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
            choices[next]?.focus();
          }
        }}
      >
        {props.children(() => close())}
      </div>
    </>
  );
}
const effortLabel = (effort: string) =>
  ({
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra high',
    max: 'Max',
    ultra: 'Ultra',
    minimal: 'Minimal',
    none: 'None',
  })[effort] ?? effort;
const modes = [
  {
    id: 'supervised',
    name: 'Supervised',
    description: 'Ask before commands and file changes.',
    icon: 'info',
  },
  {
    id: 'auto-accept-edits',
    name: 'Auto-accept edits',
    description: 'Allow paper edits; ask before other actions.',
    icon: 'edit',
  },
  {
    id: 'auto',
    name: 'Auto',
    description: 'Let Codex review routine actions. OpenCode still asks about commands.',
    icon: 'tools',
  },
  {
    id: 'full-access',
    name: 'Full access',
    description: 'Allow commands and edits without prompts, including outside the paper folder.',
    icon: 'warning',
  },
] as const;

export function AgentChatMenus(props: { agent: AgentWorkspace; onConnect: () => void }) {
  const a = props.agent,
    [query, setQuery] = createSignal(''),
    [favoritesOnly, setFavoritesOnly] = createSignal(false);
  const [favorites, setFavorites] = createSignal<string[]>(readFavorites());
  let search!: HTMLInputElement;
  function readFavorites(): string[] {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('loom:agent-favorites:v1') ?? '[]');
      return Array.isArray(saved)
        ? saved.filter((v): v is string => typeof v === 'string').slice(0, 3000)
        : [];
    } catch {
      return [];
    }
  }
  const models = createMemo(() =>
    (a.state()?.models ?? [])
      .filter((m) => {
        const key = modelIdentity(m);
        return (
          (!favoritesOnly() || favorites().includes(key)) &&
          `${m.name} ${m.providerId} ${m.id}`.toLowerCase().includes(query().toLowerCase().trim())
        );
      })
      .sort(
        (x, y) =>
          Number(favorites().includes(modelIdentity(y))) -
          Number(favorites().includes(modelIdentity(x))),
      ),
  );
  const disabled = () => a.busy() || a.state()?.running || a.submitting();
  const ready = () => a.state()?.connection === 'connected';
  const mode = () => modes.find((m) => m.id === a.settings().permissionMode) ?? modes[1];
  const reasoning = () => a.settings().reasoning || a.model()?.defaultReasoning || '';
  return (
    <div class="agent-chat-options" aria-label="Agent chat settings">
      <Show
        when={ready()}
        fallback={
          <button class="agent-choice-trigger" onClick={props.onConnect}>
            <Icon name="chat" size={16} />
            Connect agent
            <Icon name="down" size={12} />
          </button>
        }
      >
        <ChoicePopover
          label="Choose agent model"
          text={a.model()?.name ?? 'Choose model'}
          icon="chat"
          disabled={disabled()}
        >
          {(close) => (
            <div class="agent-model-picker">
              <aside class="agent-model-rail" aria-label="Model filters">
                <button
                  classList={{ selected: favoritesOnly() }}
                  aria-label="Favorite models"
                  aria-pressed={favoritesOnly()}
                  onClick={() => setFavoritesOnly(!favoritesOnly())}
                >
                  <Icon name="star" />
                </button>
                <button
                  classList={{ selected: !favoritesOnly() }}
                  aria-label="All connected models"
                  aria-pressed={!favoritesOnly()}
                  onClick={() => setFavoritesOnly(false)}
                >
                  <Icon name={a.state()?.harness === 'codex' ? 'chat' : 'tools'} />
                </button>
                <button
                  aria-label="Agent connections"
                  title="Agent connections"
                  onClick={() => {
                    close();
                    props.onConnect();
                  }}
                >
                  <Icon name="settings" />
                </button>
              </aside>
              <div class="agent-model-choices">
                <div class="search-field agent-model-search">
                  <Icon name="search" size={16} />
                  <input
                    ref={search}
                    data-search
                    aria-label="Search models"
                    placeholder="Search models…"
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                  <Show when={query()}>
                    <IconButton
                      label="Clear model search"
                      icon="close"
                      onClick={() => {
                        setQuery('');
                        search.focus();
                      }}
                    />
                  </Show>
                </div>
                <p class="agent-menu-caption">
                  {a.state()?.harness === 'codex' ? 'Codex' : 'OpenCode'} · {models().length} models
                </p>
                <div class="agent-model-results">
                  <For each={models()}>
                    {(model) => (
                      <div class="agent-model-choice-row">
                        <button
                          data-choice
                          aria-pressed={
                            a.model() && modelIdentity(a.model()!) === modelIdentity(model)
                          }
                          onClick={() => {
                            a.setModelKey(modelIdentity(model));
                            close();
                          }}
                        >
                          <span>{model.name}</span>
                          <small>
                            {model.providerId} · {model.id}
                          </small>
                        </button>
                        <button
                          class="agent-favorite"
                          aria-label={`${favorites().includes(modelIdentity(model)) ? 'Remove' : 'Add'} ${model.name} ${favorites().includes(modelIdentity(model)) ? 'from' : 'to'} favorites`}
                          aria-pressed={favorites().includes(modelIdentity(model))}
                          onClick={() => {
                            const key = modelIdentity(model),
                              next = favorites().includes(key)
                                ? favorites().filter((v) => v !== key)
                                : [...favorites(), key];
                            setFavorites(next);
                            try {
                              localStorage.setItem('loom:agent-favorites:v1', JSON.stringify(next));
                            } catch {
                              /* Choice remains available for this window. */
                            }
                          }}
                        >
                          <Icon name="star" size={16} />
                        </button>
                      </div>
                    )}
                  </For>
                  <Show when={!models().length}>
                    <p class="agent-menu-empty">
                      {query()
                        ? 'No matching models.'
                        : favoritesOnly()
                          ? 'Star a model to keep it here.'
                          : 'No models available. Open Agent connections to set up your harness.'}
                    </p>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </ChoicePopover>
        <ChoicePopover
          label="Reasoning"
          text={reasoning() ? effortLabel(reasoning()) : 'Default'}
          icon="section"
          disabled={disabled()}
        >
          {(close) => (
            <div class="agent-option-list">
              <p class="agent-menu-heading">Reasoning</p>
              <button
                data-choice
                aria-pressed={!a.settings().reasoning}
                onClick={() => {
                  void a.setSettings({ ...a.settings(), reasoning: '' });
                  close();
                }}
              >
                <span>Default</span>
                <small>
                  {a.model()?.defaultReasoning
                    ? effortLabel(a.model()!.defaultReasoning!) + ' · selected by the harness'
                    : 'Use this model’s native settings.'}
                </small>
              </button>
              <For each={a.model()?.reasoningEfforts ?? []}>
                {(effort) => (
                  <button
                    data-choice
                    aria-pressed={a.settings().reasoning === effort}
                    onClick={() => {
                      void a.setSettings({ ...a.settings(), reasoning: effort });
                      close();
                    }}
                  >
                    <span>{effortLabel(effort)}</span>
                  </button>
                )}
              </For>
              <Show when={!a.model()?.reasoningEfforts?.length}>
                <p class="agent-menu-caption">This model exposes no adjustable reasoning levels.</p>
              </Show>
            </div>
          )}
        </ChoicePopover>
        <ChoicePopover
          label="Permissions"
          text={mode().name}
          icon={mode().icon}
          disabled={disabled()}
        >
          {(close) => (
            <div class="agent-option-list">
              <p class="agent-menu-heading">Permissions · this chat</p>
              <For each={modes}>
                {(entry) => (
                  <button
                    data-choice
                    aria-pressed={mode().id === entry.id}
                    onClick={() => {
                      void a.setSettings({ ...a.settings(), permissionMode: entry.id });
                      close();
                    }}
                  >
                    <Icon name={entry.icon} size={18} />
                    <span>
                      {entry.name}
                      <small>{entry.description}</small>
                    </span>
                    <Show when={mode().id === entry.id}>
                      <Icon name="check" size={15} />
                    </Show>
                  </button>
                )}
              </For>
              <p class="agent-menu-caption">
                Applies to the next request in this native harness. File changes remain reviewable
                afterward.
              </p>
            </div>
          )}
        </ChoicePopover>
      </Show>
    </div>
  );
}
