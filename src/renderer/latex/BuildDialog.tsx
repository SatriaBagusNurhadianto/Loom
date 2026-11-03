import { createEffect, createMemo, createSignal, untrack, For, Show } from 'solid-js';
import { defaultBuildSettings, type BuildSettings } from '../../contracts/latex';
import type { ProjectWorkspace } from '../editor/documents';
import { Modal } from '../ui/primitives';
import type { LatexWorkspace } from './workspace';
export function BuildDialog(props: {
  open: boolean;
  onClose: () => void;
  workspace: ProjectWorkspace;
  latex: LatexWorkspace;
}) {
  const [settings, setSettings] = createSignal<BuildSettings>(defaultBuildSettings);
  const [saved, setSaved] = createSignal(false);
  const [root, setRoot] = createSignal('');
  const patch = (value: Partial<BuildSettings>) => {
    setSettings((old) => ({ ...old, ...value }));
    setSaved(false);
  };
  const formKey = createMemo(() => (props.open ? (props.workspace.project()?.id ?? 'empty') : ''));
  const settingsReady = createMemo(() => !!props.latex.state());
  createEffect(() => {
    if (!formKey() || !settingsReady()) return;
    untrack(() => {
      setSettings({ ...(props.latex.state()?.settings ?? defaultBuildSettings) });
      setRoot(props.workspace.project()?.rootId ?? '');
      setSaved(false);
    });
  });
  async function save() {
    if (root() && root() !== props.workspace.project()?.rootId) {
      const result = await props.workspace.command({ type: 'root', fileId: root() });
      if (!result?.ok) return;
    }
    setSaved(await props.latex.configure(settings()));
  }
  const current = () => props.latex.state()?.current;
  return (
    <Modal title="Build and LaTeX" open={props.open} onClose={props.onClose}>
      <p class="muted">
        Compile a saved snapshot with local TeX tools. Your source stays editable while the build
        runs.
      </p>
      <Show when={props.latex.error()}>
        <p class="inline-error" role="alert">
          {props.latex.error()}
        </p>
      </Show>
      <Show when={props.workspace.error()}>
        <p class="inline-error" role="alert">
          {props.workspace.error()}
        </p>
      </Show>
      <div class="build-settings">
        <label>
          Root document
          <select
            disabled={!settingsReady()}
            aria-label="Root document"
            value={root()}
            onChange={(e) => {
              setRoot(e.currentTarget.value);
              setSaved(false);
            }}
          >
            <option value="">Choose a root .tex document</option>
            <For
              each={props.workspace
                .project()
                ?.files.filter((f) => !f.deleted && f.path.endsWith('.tex'))}
            >
              {(file) => <option value={file.id}>{file.path}</option>}
            </For>
          </select>
        </label>
        <label>
          TeX engine
          <select
            disabled={!settingsReady()}
            aria-label="TeX engine"
            value={settings().engine}
            onChange={(e) => patch({ engine: e.currentTarget.value as BuildSettings['engine'] })}
          >
            <option value="pdflatex">pdfLaTeX</option>
            <option value="xelatex">XeLaTeX</option>
            <option value="lualatex">LuaLaTeX</option>
          </select>
        </label>
        <label>
          Bibliography
          <select
            disabled={!settingsReady()}
            aria-label="Bibliography"
            value={settings().bibliography}
            onChange={(e) =>
              patch({ bibliography: e.currentTarget.value as BuildSettings['bibliography'] })
            }
          >
            <option value="auto">Detect from source</option>
            <option value="bibtex">BibTeX</option>
            <option value="biber">Biber</option>
            <option value="none">Do not run bibliography tools</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={settings().autoBuild}
            onChange={(e) => patch({ autoBuild: e.currentTarget.checked })}
          />
          Compile after editing settles
        </label>
        <label>
          Delay (milliseconds)
          <input
            type="number"
            min="750"
            max="10000"
            step="250"
            value={settings().delayMs}
            onChange={(e) =>
              patch({
                delayMs: Math.max(750, Math.min(10000, Number(e.currentTarget.value) || 1500)),
              })
            }
          />
        </label>
      </div>
      <p class="muted">
        Save writes <code>loom.build.json</code> in this project with the root, engine,
        bibliography, latexmk recipe and automatic build preference. Executable locations stay on
        this computer. Custom latexmk RC files and shell escape are disabled.
      </p>
      <div class="button-row">
        <button
          class="secondary-button"
          disabled={props.latex.busy() || !root()}
          onClick={() => void save()}
        >
          Save build settings
        </button>
        <Show when={saved()}>
          <span role="status">Settings saved</span>
        </Show>
      </div>
      <div class="button-row build-commands">
        <button
          class="primary-button"
          disabled={props.latex.busy()}
          onClick={() => void props.latex.compile()}
        >
          Compile
        </button>
        <button
          class="secondary-button"
          disabled={props.latex.busy()}
          onClick={() => void props.latex.compile(true)}
        >
          Clean rebuild
        </button>
        <button
          class="secondary-button"
          disabled={!props.latex.running()}
          onClick={() => void props.latex.cancel()}
        >
          Cancel build
        </button>
      </div>
      <p role="status">
        {props.latex.running()
          ? 'Building saved snapshot…'
          : current()?.status
            ? `Build ${current()!.status}`
            : 'No build yet'}
        {props.latex.state()?.queued ? ' · One follow-up build queued' : ''}
      </p>
      <Show when={current()}>
        {(build) => (
          <>
            <p class="muted">
              Source {build().revision.slice(0, 12)} · {build().root} · {build().settings.engine}
            </p>
            <Show when={props.latex.state()?.successful}>
              <p class="muted">
                {props.latex.stale()
                  ? 'The retained PDF is older than the current source or settings.'
                  : 'The PDF matches saved source.'}
              </p>
            </Show>
            <ul class="build-diagnostics">
              <For each={build().diagnostics}>
                {(item) => (
                  <li>
                    <button
                      disabled={!item.path}
                      onClick={() => {
                        if (item.path) {
                          props.onClose();
                          void props.latex.locate({
                            path: item.path,
                            line: item.line,
                            column: item.column,
                          });
                        }
                      }}
                    >
                      {item.path ? `${item.path}:${item.line} · ` : ''}
                      {item.severity}: {item.message}
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <details class="build-log">
              <summary>Raw build log</summary>
              <pre>{build().log}</pre>
            </details>
            <details>
              <summary>Recorded build tool versions</summary>
              <For each={build().tools.filter((t) => t.available)}>
                {(tool) => (
                  <p class="tool-version">
                    {tool.name}: {tool.version}
                  </p>
                )}
              </For>
              <p class="muted">
                Versions describe this build; they do not freeze or reproduce its full environment.
              </p>
            </details>
          </>
        )}
      </Show>
      <div class="build-tool-heading">
        <h3>Local tools</h3>
        <button class="secondary-button" onClick={() => void props.latex.refresh(true)}>
          Detect tools
        </button>
      </div>
      <Show when={props.latex.state()} fallback={<p role="status">Checking local tools…</p>}>
        <ul class="tool-list">
          <For each={props.latex.state()?.tools}>
            {(tool) => (
              <li>
                <strong>{tool.name}</strong>
                <span>{tool.available ? 'Available' : 'Missing or unusable'}</span>
                <details>
                  <summary>Version details</summary>
                  <pre>{tool.version}</pre>
                </details>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <h3>Set up local LaTeX</h3>
      <p>
        Install TeX Live (Linux or Windows), MiKTeX (Windows), or MacTeX (macOS), including latexmk,
        your engine, BibTeX/Biber and SyncTeX. Install TexLab for completion, diagnostics and Go to
        definition. Restart Loom after changing PATH, then choose Detect tools.
      </p>
      <p class="muted">
        A missing .sty/.cls package is reported in the build log. Install that package with your
        distribution's package manager and compile again. Source editing remains available.
      </p>
      <div class="button-row">
        <button class="secondary-button" onClick={() => void window.loom?.openSetup('tex')}>
          TeX installation guide ↗
        </button>
        <button class="secondary-button" onClick={() => void window.loom?.openSetup('texlab')}>
          TexLab installation guide ↗
        </button>
      </div>
      <p class="muted">{props.latex.languageStatus()}</p>
    </Modal>
  );
}
