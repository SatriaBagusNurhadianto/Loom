import { createProjectWorkspace } from '../editor/documents';
import { SourceEditor } from '../editor/SourceEditor';
import { ProjectPanel } from '../editor/ProjectPanel';
import { untrack, createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { LoomDesktop, ServiceStatus } from '../../contracts/desktop';
import { Icon } from '../ui/Icon';
import { EmptyState, IconButton, Modal } from '../ui/primitives';
import { defaultLayout, loadLayout, saveLayout, type Layout } from './layout';
import { exampleSource, tokenize } from './example';

declare global {
  interface Window {
    loom?: LoomDesktop;
  }
}
type Dialog = 'projects' | 'tools' | 'settings' | 'availability' | 'service' | null;
export function Workspace() {
  const layoutStorage = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  };
  const initial = loadLayout(layoutStorage);
  const [layout, setLayout] = createSignal(initial.layout);
  const [notice, setNotice] = createSignal(initial.warning ?? '');
  const projects = createProjectWorkspace(setNotice);
  const [example, setExample] = createSignal(false);
  const [dialog, setDialog] = createSignal<Dialog>(null);
  const [availability, setAvailability] = createSignal({ title: '', detail: '' });
  const [query, setQuery] = createSignal('');
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [narrow, setNarrow] = createSignal(window.innerWidth < 1100);
  const [service, setService] = createSignal<ServiceStatus>({
    state: 'starting',
    pid: null,
    version: '0.1.0',
  });
  const [serviceError, setServiceError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let source!: HTMLElement;
  let pdf!: HTMLElement;
  let search!: HTMLInputElement;
  let shell!: HTMLDivElement;
  let dragCleanup: (() => void) | undefined;
  const update = (patch: Partial<Layout>) => setLayout((old) => ({ ...old, ...patch }));
  const effectiveMode = () => (narrow() && layout().mode === 'split' ? 'source' : layout().mode);
  const sidebarVisible = () => layout().sidebarOpen && !narrow() && effectiveMode() === 'split';
  const sourceVisible = () => effectiveMode() !== 'pdf';
  const pdfVisible = () =>
    effectiveMode() === 'pdf' || (effectiveMode() === 'split' && layout().pdfOpen);
  const columns = () =>
    [
      sidebarVisible() ? `${layout().sidebar}fr 6px` : '',
      sourceVisible()
        ? `${100 - (sidebarVisible() ? layout().sidebar : 0) - (pdfVisible() ? layout().pdf : 0)}fr`
        : '',
      sourceVisible() && pdfVisible() ? '6px' : '',
      pdfVisible() ? `${sourceVisible() ? layout().pdf : 100}fr` : '',
    ]
      .filter(Boolean)
      .join(' ');
  const showUnavailable = (title: string, detail: string) => {
    setAvailability({ title, detail });
    setDialog('availability');
  };
  const showExample = () => {
    setExample(true);
    setNotice('Read-only example loaded. No project files were created.');
  };
  const focusMode = (mode: Layout['mode']) => {
    update({ mode });
    requestAnimationFrame(() => (mode === 'pdf' ? pdf : source)?.focus());
  };
  const resize = (which: 'sidebar' | 'pdf', delta: number) => {
    const value = Math.max(
      which === 'sidebar' ? 18 : 22,
      Math.min(which === 'sidebar' ? 38 : 45, layout()[which] + delta),
    );
    if (value + layout()[which === 'sidebar' ? 'pdf' : 'sidebar'] <= 75) update({ [which]: value });
  };
  const startDrag = (event: PointerEvent, which: 'sidebar' | 'pdf') => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanup?.();
    const target = event.currentTarget as HTMLElement;
    target.focus();
    target.setPointerCapture(event.pointerId);
    let last = event.clientX;
    const move = (e: PointerEvent) => {
      resize(which, ((e.clientX - last) / shell.clientWidth) * 100 * (which === 'pdf' ? -1 : 1));
      last = e.clientX;
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('lostpointercapture', end);
      document.body.classList.remove('resizing');
      dragCleanup = undefined;
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('lostpointercapture', end);
    document.body.classList.add('resizing');
    dragCleanup = end;
  };
  const separator = (which: 'sidebar' | 'pdf') => (
    <div
      class="panel-separator"
      role="separator"
      aria-label={which === 'sidebar' ? 'Sidebar width' : 'PDF width'}
      aria-orientation="vertical"
      aria-valuemin={which === 'sidebar' ? 18 : 22}
      aria-valuemax={which === 'sidebar' ? 38 : 45}
      aria-valuenow={Math.round(layout()[which])}
      tabIndex={0}
      onPointerDown={(e) => startDrag(e, which)}
      onDblClick={() => update({ [which]: defaultLayout[which] })}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          resize(which, (e.key === 'ArrowRight' ? 1 : -1) * (which === 'pdf' ? -1 : 1));
        }
        if (e.key === 'Home') {
          e.preventDefault();
          update({ [which]: defaultLayout[which] });
        }
      }}
    />
  );
  const checkService = async (restart = false) => {
    if (busy()) return;
    setBusy(true);
    setServiceError('');
    try {
      if (!window.loom) {
        setService({ state: 'unavailable', pid: null, version: '0.1.0' });
        setServiceError(
          'Desktop service is unavailable in the browser preview. Open the Electron app with npm run dev.',
        );
        return;
      }
      const result = await (restart ? window.loom.restartService() : window.loom.getStatus());
      if (result.ok) setService(result.value);
      else {
        setService({ state: 'unavailable', pid: null, version: '0.1.0' });
        setServiceError(result.error.message);
      }
    } catch {
      setService({ state: 'unavailable', pid: null, version: '0.1.0' });
      setServiceError('Could not reach the desktop service. Retry the connection.');
    } finally {
      setBusy(false);
    }
  };
  let restoredProject = '';
  createEffect(() => {
    const project = projects.project();
    if (project && restoredProject !== project.id) {
      restoredProject = project.id;
      const saved = untrack(projects.storedLayout);
      if (saved) setLayout(saved);
      else projects.setStoredLayout(untrack(layout));
    }
  });
  createEffect(() => {
    const value = layout();
    if (untrack(projects.project)) projects.setStoredLayout(value);
  });
  createEffect(() => {
    if (!saveLayout(layoutStorage, layout()))
      setNotice(
        'Layout could not be saved. This session still works; allow local storage to retain it.',
      );
  });
  onMount(() => {
    void checkService();
    const unsubscribe = window.loom?.onServiceEvent((event) => {
      setService(event.status);
      setServiceError(event.error?.message ?? '');
    });
    const handleResize = () => setNarrow(window.innerWidth < 1100);
    const shortcuts = (e: KeyboardEvent) => {
      if (e.isComposing || dialog()) return;
      if ((e.ctrlKey || e.metaKey) && e.altKey) {
        if (['1', '2', '3', 'b'].includes(e.key.toLowerCase())) e.preventDefault();
        if (e.key === '1') focusMode('source');
        if (e.key === '2') focusMode('pdf');
        if (e.key === '3') focusMode('split');
        if (e.key.toLowerCase() === 'b') update({ sidebarOpen: !layout().sidebarOpen });
      }
      if (e.key === 'F6') {
        e.preventDefault();
        const regions = [...document.querySelectorAll<HTMLElement>('[data-focus-region]')].filter(
          (el) => el.getClientRects().length,
        );
        const current = regions.findIndex(
          (el) => el === document.activeElement || el.contains(document.activeElement),
        );
        regions[(current + (e.shiftKey ? regions.length - 1 : 1)) % regions.length]?.focus();
      }
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', shortcuts);
    onCleanup(() => {
      unsubscribe?.();
      dragCleanup?.();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', shortcuts);
    });
  });
  return (
    <div class="app-shell" ref={shell}>
      <a
        class="skip-link"
        href="#source"
        onClick={(event) => {
          event.preventDefault();
          focusMode('source');
        }}
      >
        Skip to source
      </a>
      <header class="compact-bar">
        <span class="wordmark">Loom</span>
        <nav aria-label="Workspace views">
          <button aria-pressed={effectiveMode() === 'source'} onClick={() => focusMode('source')}>
            Source
          </button>
          <button aria-pressed={effectiveMode() === 'pdf'} onClick={() => focusMode('pdf')}>
            PDF
          </button>
          <button
            aria-pressed={effectiveMode() === 'split'}
            disabled={narrow()}
            title={
              narrow() ? 'Split view needs a window at least 1100 pixels wide' : 'Show all panels'
            }
            onClick={() => focusMode('split')}
          >
            Split
          </button>
        </nav>
        <IconButton
          label="Workspace settings"
          icon="settings"
          onClick={() => setDialog('settings')}
        />
      </header>
      <div class="workspace-grid" style={{ 'grid-template-columns': columns() }}>
        <Show when={sidebarVisible()}>
          <aside class="sidebar" aria-label="Project sidebar" tabIndex={-1} data-focus-region>
            <div class="sidebar-brand">
              <span class="brand-mark" aria-hidden="true">
                ◉
              </span>
              <span class="wordmark">Loom</span>
              <IconButton
                label="Collapse sidebar"
                icon="panel"
                onClick={() => update({ sidebarOpen: false })}
              />
            </div>
            <button class="project-selector" onClick={() => setDialog('projects')}>
              <span>
                {projects.project()?.name ?? (example() ? 'Example project' : 'No project open')}
              </span>
              <Icon name="down" />
            </button>
            <Show when={!projects.project()}>
              <div class="file-toolbar">
                <div class="tab-buttons" role="group" aria-label="Sidebar content">
                  <button
                    aria-pressed={layout().tab === 'files'}
                    classList={{ selected: layout().tab === 'files' }}
                    onClick={() => update({ tab: 'files' })}
                  >
                    Files
                  </button>
                  <button
                    aria-pressed={layout().tab === 'chats'}
                    classList={{ selected: layout().tab === 'chats' }}
                    onClick={() => update({ tab: 'chats' })}
                  >
                    Chats
                  </button>
                </div>
                <IconButton
                  label="Search example files"
                  icon="search"
                  active={searchOpen()}
                  onClick={() => {
                    setSearchOpen(!searchOpen());
                    if (searchOpen()) requestAnimationFrame(() => search?.focus());
                    else setQuery('');
                  }}
                />
                <IconButton
                  label={
                    layout().tab === 'files' ? 'Add file — availability' : 'New chat — availability'
                  }
                  icon="plus"
                  onClick={() =>
                    showUnavailable(
                      layout().tab === 'files' ? 'File operations' : 'Agent conversations',
                      layout().tab === 'files'
                        ? 'File creation and project persistence arrive in Phase 2.'
                        : 'OpenCode sessions, models, and conversations arrive in Phase 4. No agent is connected.',
                    )
                  }
                />
              </div>
              <Show when={searchOpen()}>
                <div class="search-field">
                  <Icon name="search" />
                  <input
                    ref={search}
                    aria-label="Search example files"
                    placeholder="Search example files…"
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                  <Show when={query()}>
                    <IconButton
                      label="Clear file search"
                      icon="close"
                      onClick={() => {
                        setQuery('');
                        search.focus();
                      }}
                    />
                  </Show>
                </div>
              </Show>
              <div class="file-list" aria-live="polite">
                <Show
                  when={layout().tab === 'files'}
                  fallback={
                    <div class="sidebar-empty">
                      <Icon name="chat" />
                      <p>No conversations yet</p>
                      <span>Connect an agent in Phase 4.</span>
                    </div>
                  }
                >
                  <Show
                    when={example()}
                    fallback={
                      <div class="sidebar-empty">
                        <Icon name="folder" />
                        <p>Your project starts here</p>
                        <span>Open or create a project to begin.</span>
                        <button class="text-button" onClick={showExample}>
                          View workspace example
                        </button>
                      </div>
                    }
                  >
                    <Show
                      when={'main.tex'.includes(query().toLowerCase())}
                      fallback={
                        <div class="sidebar-empty">
                          <p>No matching example files</p>
                          <button
                            class="text-button"
                            onClick={() => {
                              setQuery('');
                              search?.focus();
                            }}
                          >
                            Clear search
                          </button>
                        </div>
                      }
                    >
                      <button
                        class="file-row selected"
                        onClick={() => {
                          focusMode('split');
                          source?.focus();
                        }}
                      >
                        <Icon name="file" />
                        <span>main.tex</span>
                        <span class="file-badge">example</span>
                      </button>
                    </Show>
                  </Show>
                </Show>
              </div>
            </Show>
            <Show when={projects.project()}>
              <ProjectPanel workspace={projects} />
            </Show>
            <Show when={!projects.project()}>
              <section class="outline">
                <button
                  class="outline-heading"
                  aria-expanded={layout().outlineOpen}
                  onClick={() => update({ outlineOpen: !layout().outlineOpen })}
                >
                  <span classList={{ rotated: !layout().outlineOpen }}>
                    <Icon name="down" size={16} />
                  </span>
                  Outline
                </button>
                <Show when={layout().outlineOpen}>
                  <Show
                    when={example()}
                    fallback={<p class="outline-empty">Sections will appear here.</p>}
                  >
                    <button
                      class="outline-item"
                      onClick={() => {
                        focusMode('source');
                        requestAnimationFrame(() =>
                          document.getElementById('line-19')?.scrollIntoView({ block: 'center' }),
                        );
                      }}
                    >
                      Introduction
                    </button>
                  </Show>
                </Show>
              </section>
            </Show>
            <footer class="sidebar-footer">
              <span class="avatar">L</span>
              <div>
                <span>Local workspace</span>
                <small>No account required</small>
              </div>
              <IconButton
                label="Workspace settings"
                icon="settings"
                onClick={() => setDialog('settings')}
              />
            </footer>
          </aside>
          {separator('sidebar')}
        </Show>
        <Show when={sourceVisible()}>
          <main
            class="source-column"
            id="source"
            aria-label="Source workspace"
            tabIndex={-1}
            data-focus-region
            ref={source}
          >
            <div class="source-toolbar">
              <Show when={!sidebarVisible()}>
                <IconButton
                  label="Restore sidebar"
                  icon="panel"
                  onClick={() => {
                    update({ sidebarOpen: true, mode: 'split' });
                    if (narrow()) setDialog('settings');
                  }}
                />
              </Show>
              <span class="source-tab">
                <Icon name="file" />
                <span>{projects.file()?.path ?? (example() ? 'main.tex' : 'Workspace')}</span>
              </span>
              <span class="readonly-label">
                {projects.project()
                  ? projects.saved()
                    ? 'Saved to disk'
                    : projects.file()?.conflict
                      ? 'Conflict · review required'
                      : 'Unsaved · recovery pending'
                  : example()
                    ? 'Example · read only'
                    : 'Phase 2'}
              </span>
              <button class="tools-button" onClick={() => setDialog('tools')}>
                Tools <Icon name="tools" />
              </button>
            </div>
            <Show when={projects.project()}>
              <div class="document-tabs">
                <For
                  each={projects
                    .tabs()
                    .filter((id) =>
                      projects.project()?.files.some((f) => f.id === id && !f.deleted),
                    )}
                >
                  {(id) => (
                    <button
                      aria-pressed={projects.active() === id}
                      onClick={() => void projects.select(id)}
                    >
                      {projects.project()?.files.find((f) => f.id === id)?.path}
                    </button>
                  )}
                </For>
                <button onClick={() => void projects.flush()}>Save</button>
                <button
                  onClick={() =>
                    document
                      .querySelector('.cm-editor')
                      ?.dispatchEvent(new CustomEvent('loom:find'))
                  }
                >
                  Find / replace
                </button>
                <button onClick={() => setDialog('projects')}>Project</button>
              </div>
            </Show>
            <Show when={projects.error()}>
              <div role="alert" class="project-error">
                {projects.error()}
                <button onClick={() => void projects.flush()}>Retry save</button>
              </div>
            </Show>
            <Show when={projects.file()?.conflict}>
              <section class="conflict-panel" aria-label="File conflict">
                <h3>External changes need review</h3>
                <p>Your text and the disk version are preserved. Choose which version to keep.</p>
                <details>
                  <summary>Compare baseline and disk</summary>
                  <h4>Last synchronized</h4>
                  <pre>{projects.file()?.baseline ?? '(missing)'}</pre>
                  <h4>Current disk</h4>
                  <pre>{projects.file()?.disk ?? '(deleted or binary)'}</pre>
                </details>
                <button
                  onClick={() =>
                    void projects.command({
                      type: 'resolve',
                      fileId: projects.active(),
                      choice: 'local',
                      disk: projects.file()!.disk,
                    })
                  }
                >
                  Keep local text
                </button>
                <button
                  onClick={() =>
                    void projects.command({
                      type: 'resolve',
                      fileId: projects.active(),
                      choice: 'disk',
                      disk: projects.file()!.disk,
                    })
                  }
                >
                  Use disk version
                </button>
              </section>
            </Show>
            <div class="source-content">
              <Show
                when={projects.project()}
                fallback={
                  <>
                    <Show
                      when={example()}
                      fallback={
                        <EmptyState icon="file" title="A place for your next paper">
                          <p>Your source, assistant, and PDF, together.</p>
                          <p>Open a folder or create an ordinary LaTeX project.</p>
                          <button class="primary-button" onClick={() => setDialog('projects')}>
                            Open or create project
                          </button>
                          <button class="text-button" onClick={showExample}>
                            View workspace example
                          </button>
                        </EmptyState>
                      }
                    >
                      <div
                        class="code-view"
                        role="region"
                        aria-label="Read-only LaTeX example"
                        tabIndex={0}
                      >
                        <For each={exampleSource.split('\n')}>
                          {(line, i) => (
                            <div class="code-line" id={`line-${i()}`}>
                              <span class="line-number" aria-hidden="true">
                                {i() + 1}
                              </span>
                              <code>
                                <For each={tokenize(line)}>
                                  {(token) => <span class={token.kind}>{token.text}</span>}
                                </For>
                                {line === '' ? ' ' : ''}
                              </code>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </>
                }
              >
                <Show
                  when={projects.file()?.text !== null}
                  fallback={
                    <EmptyState icon="file" title="Project asset">
                      <p>This asset stays in its original format. Text editing is unavailable.</p>
                    </EmptyState>
                  }
                >
                  <SourceEditor workspace={projects} />
                </Show>
              </Show>
            </div>
            <div class="composer-area">
              <div class="composer">
                <span class="composer-placeholder">Ask anything</span>
                <div class="composer-actions">
                  <IconButton
                    label="Attachments — availability"
                    icon="plus"
                    onClick={() =>
                      showUnavailable(
                        'Attachments',
                        'Images and scientific-content assistance arrive in Phase 6, after the agent integration.',
                      )
                    }
                  />
                  <button
                    class="model-button"
                    onClick={() =>
                      showUnavailable(
                        'Agent not connected',
                        'OpenCode connection and supported model selection arrive in Phase 4. No prompt is sent from this foundation preview.',
                      )
                    }
                  >
                    No agent connected <Icon name="down" size={15} />
                  </button>
                  <button
                    class="send-button"
                    title="Sending requires the Phase 4 agent integration"
                    disabled
                    aria-label="Send unavailable — agent integration in Phase 4"
                  >
                    <Icon name="arrow" size={22} />
                  </button>
                </div>
              </div>
              <div class="composer-caption">
                <span>
                  {example()
                    ? 'Synthetic example · no files on disk'
                    : 'Local workspace · Phase 2 projects'}
                </span>
                <button class="status-button" onClick={() => setDialog('service')}>
                  <span class="status-dot" classList={{ ready: service().state === 'ready' }} />
                  {service().state === 'ready'
                    ? 'Service ready'
                    : service().state === 'starting'
                      ? 'Service starting'
                      : 'Service unavailable'}
                </button>
              </div>
            </div>
          </main>
        </Show>
        <Show when={sourceVisible() && pdfVisible()}>{separator('pdf')}</Show>
        <Show when={pdfVisible()}>
          <section
            class="pdf-column"
            aria-label="PDF preview"
            tabIndex={-1}
            data-focus-region
            ref={pdf}
          >
            <div class="pdf-toolbar">
              <button
                class="build-status"
                onClick={() =>
                  showUnavailable(
                    'LaTeX compilation',
                    'Local TeX tool detection, build status, and a real PDF viewer arrive in Phase 3. The example paper is a static layout reference and has never been compiled.',
                  )
                }
              >
                <Icon name="info" size={17} />
                <span>{example() ? 'Example preview' : 'Not compiled'}</span>
                <Icon name="down" size={14} />
              </button>
              <div class="pdf-actions">
                <IconButton
                  label={effectiveMode() === 'pdf' ? 'Return to workspace' : 'Focus PDF'}
                  icon="expand"
                  onClick={() => focusMode(effectiveMode() === 'pdf' ? 'split' : 'pdf')}
                />
                <IconButton
                  label="Download PDF — availability"
                  icon="download"
                  onClick={() =>
                    showUnavailable(
                      'PDF export',
                      'A compiled PDF can be downloaded after the Phase 3 build and viewer integration. There is no PDF file in this example.',
                    )
                  }
                />
                <IconButton
                  label="Hide PDF panel"
                  icon="close"
                  onClick={() => {
                    update({ pdfOpen: false, mode: 'split' });
                    source?.focus();
                  }}
                />
              </div>
            </div>
            <div class="pdf-scroll">
              <Show
                when={example()}
                fallback={
                  <EmptyState icon="file" title="Your paper, in view">
                    <p>Compiled pages will appear here.</p>
                    <p>Local LaTeX compilation arrives in Phase 3.</p>
                  </EmptyState>
                }
              >
                <div class="paper" aria-label="Static example paper, not a compiled PDF">
                  <div class="paper-title">Untitled</div>
                  <div class="paper-author">Loom Example</div>
                  <div class="paper-date">Reference manuscript</div>
                  <div class="paper-section">1 &nbsp; Introduction</div>
                  <div class="paper-page">1</div>
                </div>
                <p class="paper-disclaimer">Static layout reference · not compiled</p>
              </Show>
            </div>
            <div class="pdf-bottom">
              <span>{example() ? 'Example page 1 of 1' : 'No PDF loaded'}</span>
            </div>
          </section>
        </Show>
      </div>
      <Show when={notice()}>
        <div class="notice" role="status">
          <span>{notice()}</span>
          <IconButton label="Dismiss notification" icon="close" onClick={() => setNotice('')} />
        </div>
      </Show>
      <Modal open={dialog() === 'projects'} title="Projects" onClose={() => setDialog(null)}>
        <p>Source and assets stay in an ordinary folder. Imports create a new copy.</p>
        <div class="project-actions">
          <button disabled={projects.pending()} onClick={() => void projects.choose('open')}>
            Open folder
          </button>
          <button disabled={projects.pending()} onClick={() => void projects.choose('create')}>
            Create project
          </button>
          <button
            disabled={projects.pending()}
            onClick={() => void projects.choose('import-folder')}
          >
            Import folder
          </button>
          <button disabled={projects.pending()} onClick={() => void projects.choose('import-zip')}>
            Import ZIP
          </button>
        </div>
        <Show when={projects.pending()}>
          <p role="status">Waiting for project selection…</p>
        </Show>
        <Show when={projects.error()}>
          <p role="alert">{projects.error()}</p>
        </Show>
        <Show when={projects.project()}>
          <label>
            Editor font size
            <input
              aria-label="Editor font size"
              type="range"
              min="11"
              max="24"
              value={projects.font()}
              onInput={(e) => projects.setFont(Number(e.currentTarget.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={projects.wrap()}
              onChange={(e) => projects.setWrap(e.currentTarget.checked)}
            />{' '}
            Wrap source lines
          </label>
          <ProjectPanel workspace={projects} />
        </Show>
      </Modal>
      <Modal
        title={
          dialog() === 'tools'
            ? 'Workspace tools'
            : dialog() === 'settings'
              ? 'Workspace settings'
              : dialog() === 'service'
                ? 'Desktop service'
                : availability().title
        }
        open={dialog() !== null && dialog() !== 'projects'}
        onClose={() => setDialog(null)}
      >
        <Show when={dialog() === 'availability'}>
          <p>{availability().detail}</p>
          <button class="primary-button" onClick={() => setDialog(null)}>
            Back to workspace
          </button>
        </Show>
        <Show when={dialog() === 'tools' || dialog() === 'settings'}>
          <p class="muted">Phase 2 · local projects</p>
          <div class="settings-section">
            <h3>View</h3>
            <div class="view-buttons">
              <button
                onClick={() => {
                  focusMode('source');
                  setDialog(null);
                }}
              >
                Source <kbd>Ctrl Alt 1</kbd>
              </button>
              <button
                onClick={() => {
                  focusMode('pdf');
                  setDialog(null);
                }}
              >
                PDF <kbd>Ctrl Alt 2</kbd>
              </button>
              <button
                disabled={narrow()}
                title={narrow() ? 'Widen the window to at least 1100px' : 'Show split view'}
                onClick={() => {
                  focusMode('split');
                  setDialog(null);
                }}
              >
                Split <kbd>Ctrl Alt 3</kbd>
              </button>
            </div>
            <Show when={narrow()}>
              <p class="help-text">
                This window uses a focused view. Widen it to 1100px for all three columns.
              </p>
            </Show>
            <label class="check-row">
              <input
                type="checkbox"
                checked={layout().sidebarOpen}
                onChange={(e) => update({ sidebarOpen: e.currentTarget.checked })}
              />
              Show sidebar in split view
            </label>
            <label class="check-row">
              <input
                type="checkbox"
                checked={layout().pdfOpen}
                onChange={(e) => update({ pdfOpen: e.currentTarget.checked })}
              />
              Show PDF in split view
            </label>
          </div>
          <div class="settings-section">
            <h3>Panel widths</h3>
            <label class="range-row">
              Sidebar{' '}
              <input
                aria-label="Sidebar width"
                type="range"
                min="18"
                max="38"
                value={layout().sidebar}
                onInput={(e) => resize('sidebar', Number(e.currentTarget.value) - layout().sidebar)}
              />
              <output>{Math.round(layout().sidebar)}%</output>
            </label>
            <label class="range-row">
              PDF{' '}
              <input
                aria-label="PDF width"
                type="range"
                min="22"
                max="45"
                value={layout().pdf}
                onInput={(e) => resize('pdf', Number(e.currentTarget.value) - layout().pdf)}
              />
              <output>{Math.round(layout().pdf)}%</output>
            </label>
            <p class="help-text">
              Drag dividers, or focus one and press ← / →. Home restores its reference width.
            </p>
          </div>
          <div class="settings-section">
            <h3>Explore the workspace</h3>
            <div class="button-row">
              <button
                class="secondary-button"
                onClick={() => {
                  showExample();
                  setDialog(null);
                }}
              >
                Load read-only example
              </button>
              <button
                class="secondary-button"
                onClick={() => {
                  setExample(false);
                  setQuery('');
                  setDialog(null);
                  setNotice('Example cleared. No files were changed.');
                }}
              >
                Clear example
              </button>
            </div>
            <button
              class="text-button"
              onClick={() => {
                setLayout({ ...defaultLayout });
                setNotice('Reference layout restored.');
              }}
            >
              Reset layout
            </button>
          </div>
          <div class="settings-section">
            <h3>Keyboard</h3>
            <p class="help-text">
              F6 / Shift F6: move between panels.
              <br />
              Ctrl Alt B: toggle sidebar. Tab: move between controls.
              <br />
              Escape: close dialogs. Use ⌘ in place of Ctrl on macOS.
            </p>
          </div>
          <button class="secondary-button" onClick={() => setDialog('service')}>
            Inspect desktop service
          </button>
        </Show>
        <Show when={dialog() === 'service'}>
          <p>Main → restricted preload → utility process</p>
          <dl class="service-details">
            <dt>Connection</dt>
            <dd aria-live="polite">{busy() ? 'Checking…' : service().state}</dd>
            <dt>Utility process PID</dt>
            <dd>{service().pid ?? 'Unavailable'}</dd>
            <dt>Version</dt>
            <dd>{service().version}</dd>
            <dt>Environment</dt>
            <dd>{window.loom ? 'Electron desktop' : 'Browser preview'}</dd>
          </dl>
          <Show when={serviceError()}>
            <p class="inline-error" role="alert">
              {serviceError()}
            </p>
          </Show>
          <div class="button-row">
            <button class="primary-button" disabled={busy()} onClick={() => void checkService()}>
              {busy() ? 'Checking…' : 'Check connection'}
            </button>
            <button
              class="secondary-button"
              disabled={busy() || !window.loom}
              onClick={() => void checkService(true)}
            >
              Restart service
            </button>
          </div>
          <p class="help-text">
            Restarting only restarts Loom’s foundation service. It does not open a project or run
            external tools.
          </p>
        </Show>
      </Modal>
    </div>
  );
}
