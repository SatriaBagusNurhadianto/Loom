import { createEffect, createUniqueId, onCleanup, type JSX } from 'solid-js';
import { Icon, type IconName } from './Icon';
export function IconButton(props: {
  label: string;
  icon: IconName;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      class="icon-button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active === undefined ? undefined : props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}
export function EmptyState(props: {
  icon: IconName;
  title: string;
  children: JSX.Element;
  action?: JSX.Element;
}) {
  return (
    <div class="empty-state">
      <span class="empty-icon">
        <Icon name={props.icon} size={25} />
      </span>
      <h2>{props.title}</h2>
      <div class="empty-copy">{props.children}</div>
      {props.action}
    </div>
  );
}
export function Modal(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: JSX.Element;
  initialFocus?: string;
}) {
  const titleId = createUniqueId();
  let dialog!: HTMLDialogElement;
  let previous: HTMLElement | null = null;
  createEffect(() => {
    if (props.open && !dialog.open) {
      previous = document.activeElement as HTMLElement;
      dialog.showModal();
      if (props.initialFocus) dialog.querySelector<HTMLElement>(props.initialFocus)?.focus();
    } else if (!props.open && dialog.open) {
      dialog.close();
      previous?.focus();
    }
  });
  onCleanup(() => {
    if (dialog.open) dialog.close();
  });
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog) {
          const r = dialog.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            props.onClose();
        }
      }}
    >
      <div class="modal-heading">
        <h2 id={titleId}>{props.title}</h2>
        <IconButton label="Close dialog" icon="close" onClick={props.onClose} />
      </div>
      <div class="modal-body">{props.children}</div>
    </dialog>
  );
}
