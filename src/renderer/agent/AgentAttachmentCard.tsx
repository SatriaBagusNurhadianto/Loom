import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Icon } from '../ui/Icon';

/** One attachment presentation for draft, sent, and older conversation records. */
export function AgentAttachmentCard(props: {
  path: string;
  image?: boolean;
  compact?: boolean;
  detail?: string;
  thumbnail?: () => Promise<string | null>;
  revision?: string | null;
  onPreview?: () => void;
  previewLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
}) {
  const [thumbnail, setThumbnail] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(!!props.thumbnail);
  const [visible, setVisible] = createSignal(false);
  const revision = createMemo(() => props.revision);
  let card!: HTMLDivElement;
  createEffect(() => {
    revision();
    const load = props.thumbnail;
    if (!visible() || !load) return;
    let disposed = false;
    setLoading(true);
    setThumbnail(null);
    void load().then(
      (result) => {
        if (!disposed) {
          setThumbnail(result);
          setLoading(false);
        }
      },
      () => {
        if (!disposed) setLoading(false);
      },
    );
    onCleanup(() => {
      disposed = true;
    });
  });
  onMount(() => {
    if (!props.thumbnail) return;
    let observer: IntersectionObserver | undefined;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            setVisible(true);
          }
        },
        { root: card.closest('.agent-messages'), rootMargin: '160px' },
      );
      observer.observe(card);
    } else setVisible(true);
    onCleanup(() => observer?.disconnect());
  });
  return (
    <div
      ref={card}
      class="agent-attachment-card"
      classList={{ 'is-image': props.image, 'is-compact': props.compact }}
      title={props.path}
    >
      <Show
        when={props.image}
        fallback={
          <div class="agent-attachment-file">
            <span class="agent-attachment-file-icon" aria-hidden="true">
              <Icon name="fileText" size={22} />
            </span>
            <span class="agent-attachment-name">
              {props.path.split('/').at(-1)}
              <span class="agent-attachment-detail">
                {props.detail ?? `${props.path.split('.').at(-1)?.toUpperCase()} file`}
              </span>
            </span>
          </div>
        }
      >
        <button
          type="button"
          class="agent-attachment-preview"
          aria-label={props.previewLabel ?? `View image ${props.path}`}
          onClick={props.onPreview}
        >
          <Show
            when={thumbnail()}
            fallback={
              <span class="agent-attachment-placeholder" aria-hidden="true">
                <Icon name={loading() ? 'fileImage' : 'warning'} size={22} />
                <span>{loading() ? 'Loading preview…' : 'Preview unavailable'}</span>
              </span>
            }
          >
            {(src) => <img src={src()} alt="" aria-hidden="true" />}
          </Show>
          <span class="agent-attachment-caption">{props.path.split('/').at(-1)}</span>
        </button>
      </Show>
      <Show when={props.onRemove}>
        <button
          type="button"
          class="agent-attachment-remove"
          title={props.removeLabel ?? `Remove attached file ${props.path}`}
          aria-label={props.removeLabel ?? `Remove attached file ${props.path}`}
          disabled={props.disabled}
          onClick={props.onRemove}
        >
          <Icon name="close" size={13} />
        </button>
      </Show>
    </div>
  );
}
