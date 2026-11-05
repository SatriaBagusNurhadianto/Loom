import { createEffect, createSignal, For, onCleanup } from 'solid-js';
import { Modal } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import {
  appearanceKey,
  applyAppearance,
  defaultAppearance,
  readAppearance,
  themes,
  type Appearance,
} from './preferences';
export function createAppearance() {
  let initial = { ...defaultAppearance };
  try {
    initial = readAppearance(localStorage.getItem(appearanceKey));
  } catch {
    /* In-memory appearance remains available. */
  }
  const [value, setValue] = createSignal(initial);
  const [error, setError] = createSignal('');
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => applyAppearance(value(), media.matches);
  createEffect(apply);
  media.addEventListener('change', apply);
  onCleanup(() => media.removeEventListener('change', apply));
  const update = (patch: Partial<Appearance>) => {
    const next = { ...value(), ...patch };
    setValue(next);
    try {
      localStorage.setItem(appearanceKey, JSON.stringify(next));
      setError('');
    } catch {
      setError('Appearance changed for this window, but could not be saved for next time.');
    }
  };
  return { value, update, error };
}
export function AppearanceDialog(props: {
  open: boolean;
  onClose: () => void;
  appearance: ReturnType<typeof createAppearance>;
}) {
  const a = props.appearance;
  return (
    <Modal title="Appearance" icon="appearance" open={props.open} onClose={props.onClose}>
      <div class="appearance-settings">
        <p class="muted">
          Make room for the way you write. Changes apply immediately and are saved on this device.
        </p>
        <section aria-labelledby="scheme-heading">
          <h3 id="scheme-heading">Color scheme</h3>
          <div class="scheme-options" role="group" aria-label="Color scheme">
            <For each={['system', 'light', 'dark'] as const}>
              {(scheme) => (
                <button
                  class="scheme-option"
                  aria-pressed={a.value().scheme === scheme}
                  onClick={() => a.update({ scheme })}
                >
                  <span class={`scheme-preview ${scheme}`} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <Icon
                    name={scheme === 'system' ? 'monitor' : scheme === 'light' ? 'sun' : 'moon'}
                    size={16}
                  />
                  {scheme[0].toUpperCase() + scheme.slice(1)}
                  <span class="appearance-check" aria-hidden="true">
                    {a.value().scheme === scheme ? <Icon name="check" size={14} /> : null}
                  </span>
                </button>
              )}
            </For>
          </div>
        </section>
        <section aria-labelledby="themes-heading">
          <h3 id="themes-heading">Themes</h3>
          <div class="theme-options" role="group" aria-label="Themes">
            <For each={themes}>
              {(theme) => (
                <button
                  class="theme-option"
                  aria-pressed={a.value().theme === theme.id}
                  onClick={() => a.update({ theme: theme.id })}
                >
                  <span
                    class="theme-swatches"
                    aria-hidden="true"
                    style={{
                      '--swatch-dark': theme.dark,
                      '--swatch-light': theme.light,
                      '--swatch-accent': theme.accent,
                    }}
                  >
                    <i />
                    <i />
                  </span>
                  <span>
                    <strong>{theme.name}</strong>
                    <small>{theme.hint}</small>
                  </span>
                  <span class="appearance-check" aria-hidden="true">
                    {a.value().theme === theme.id ? <Icon name="check" size={16} /> : null}
                  </span>
                </button>
              )}
            </For>
          </div>
        </section>
        <section aria-labelledby="interface-heading">
          <h3 id="interface-heading">Interface</h3>
          <label class="appearance-row">
            <span>
              <strong>Contrast</strong>
              <small>Strength of text and separators.</small>
            </span>
            <output>{a.value().contrast}%</output>
            <input
              type="range"
              aria-label="Interface contrast"
              min="90"
              max="120"
              step="1"
              value={a.value().contrast}
              onInput={(e) => a.update({ contrast: Number(e.currentTarget.value) })}
            />
          </label>
          <label class="appearance-row">
            <span>
              <strong>Surface opacity</strong>
              <small>Solid or softly translucent menus, dialogs and composer.</small>
            </span>
            <output>{a.value().opacity}%</output>
            <input
              type="range"
              aria-label="Surface opacity"
              min="80"
              max="100"
              step="1"
              value={a.value().opacity}
              onInput={(e) => a.update({ opacity: Number(e.currentTarget.value) })}
            />
          </label>
          <label class="appearance-row">
            <span>
              <strong>Diff colors</strong>
              <small>Additions and deletions also retain + and − signs.</small>
            </span>
            <select
              aria-label="Diff colors"
              value={a.value().diff}
              onChange={(e) => a.update({ diff: e.currentTarget.value as Appearance['diff'] })}
            >
              <option value="red-green">Red &amp; green</option>
              <option value="blue-amber">Blue &amp; amber</option>
            </select>
          </label>
          <label class="appearance-row">
            <span>
              <strong>Chat width</strong>
              <small>Message width inside an expanded conversation.</small>
            </span>
            <select
              aria-label="Chat width"
              value={a.value().chatWidth}
              onChange={(e) =>
                a.update({ chatWidth: e.currentTarget.value as Appearance['chatWidth'] })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="wide">Wide</option>
            </select>
          </label>
        </section>
        <p class="appearance-status" role={a.error() ? 'alert' : 'status'}>
          {a.error() || 'Saved automatically on this device'}
        </p>
        <button class="text-button" onClick={() => a.update({ ...defaultAppearance })}>
          Restore defaults
        </button>
      </div>
    </Modal>
  );
}
