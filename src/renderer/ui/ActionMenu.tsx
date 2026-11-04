import { createSignal, createUniqueId, Index, onCleanup } from 'solid-js';
import { Icon, type IconName } from './Icon';

export type MenuAction = {
  label: string;
  icon: IconName;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
};

/** Native top-layer popover, with menu keyboard navigation and explicit focus return. */
export function ActionMenu(props: {
  label: string;
  actions: MenuAction[];
  icon?: IconName;
  disabled?: boolean;
}) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let trigger!: HTMLButtonElement;
  let menu!: HTMLDivElement;
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  function close(restore = false) {
    if (menu.matches(':popover-open')) menu.hidePopover();
    if (restore) trigger.focus();
  }
  function position() {
    const rect = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - bounds.width, innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - bounds.height - 8))}px`;
  }
  function show(last = false) {
    menu.showPopover();
    position();
    const buttons = items();
    (last ? buttons.at(-1) : buttons[0])?.focus();
  }
  const resize = () => {
    if (menu.matches(':popover-open')) position();
  };
  window.addEventListener('resize', resize);
  onCleanup(() => window.removeEventListener('resize', resize));
  return (
    <>
      <button
        ref={trigger}
        class="icon-button action-menu-trigger"
        title={props.label}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-controls={id}
        aria-expanded={open()}
        disabled={props.disabled}
        onClick={() => (open() ? close(true) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show(event.key === 'ArrowUp');
          }
        }}
      >
        <Icon name={props.icon ?? 'more'} />
      </button>
      <div
        ref={menu}
        id={id}
        class="action-menu"
        popover="auto"
        role="menu"
        aria-label={props.label}
        onToggle={() => setOpen(menu.matches(':popover-open'))}
        onKeyDown={(event) => {
          const buttons = items(),
            index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
            buttons[next]?.focus();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          } else if (event.key === 'Tab') close(true);
        }}
      >
        <Index each={props.actions}>
          {(action) => (
            <button
              role="menuitem"
              disabled={action().disabled}
              classList={{ 'danger-action': action().danger }}
              onClick={() => {
                close(true);
                action().run();
              }}
            >
              <Icon name={action().icon} size={16} />
              <span>{action().label}</span>
            </button>
          )}
        </Index>
      </div>
    </>
  );
}
