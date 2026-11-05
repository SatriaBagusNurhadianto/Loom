import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import type {
  BuildSettings,
  BuildState,
  LatexCommand,
  LatexValue,
  SourceLocation,
  StructureItem,
} from '../../contracts/latex';
import type { ProjectWorkspace } from '../editor/documents';
export function createLatexWorkspace(
  projects: ProjectWorkspace,
  report: (message: string) => void,
) {
  const [state, setState] = createSignal<BuildState | null>(null);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [mainChoiceRequired, setMainChoiceRequired] = createSignal(false);
  const [items, setItems] = createSignal<StructureItem[]>([]);
  const [languageStatus, setLanguageStatus] = createSignal('TexLab connecting…');
  const [target, setTarget] = createSignal<{
    buildId: string;
    page: number;
    x: number;
    y: number;
    sequence: number;
  } | null>(null);
  let generation = 0,
    disposed = false,
    polling = false,
    statusRequest = 0,
    structureKey = '',
    requestedRevision = '';
  let deferredBuild: ReturnType<typeof setTimeout> | undefined;
  let cancellation = 0;
  let manualIntent: { projectId: string; generation: number; clean: boolean } | null = null;
  function clearManual() {
    clearTimeout(deferredBuild);
    deferredBuild = undefined;
    manualIntent = null;
  }
  function deferManual() {
    clearTimeout(deferredBuild);
    const intent = manualIntent;
    if (!intent) return;
    deferredBuild = setTimeout(() => {
      if (
        intent !== manualIntent ||
        intent.projectId !== projects.project()?.id ||
        intent.generation !== generation
      )
        return;
      if (busy()) deferManual();
      else void compile(intent.clean);
    }, 350);
  }
  const dirty = () => {
    projects.version();
    return !!projects.project()?.files.some((f) => projects.live(f.id)?.dirty);
  };
  const stale = () => {
    const successful = state()?.successful,
      project = projects.project();
    return (
      !!successful &&
      (successful.revision !== project?.sourceRevision ||
        dirty() ||
        successful.settings.engine !== state()?.settings.engine ||
        successful.settings.bibliography !== state()?.settings.bibliography ||
        successful.root !== project?.files.find((f) => f.id === project.rootId)?.path)
    );
  };
  const running = () => state()?.current?.status === 'running';
  async function request(command: LatexCommand, quiet = false): Promise<LatexValue | undefined> {
    if (!window.loom) {
      if (!quiet) setError('LaTeX tools require the Electron desktop application.');
      return;
    }
    const currentGeneration = generation;
    const result = await window.loom.latex(command);
    if (
      disposed ||
      currentGeneration !== generation ||
      projects.project()?.id !== command.projectId
    )
      return;
    if (!result.ok) {
      if (!quiet) setError(result.error.message);
      return;
    }
    if (!quiet) setError('');
    if (result.value.kind === 'state') setState(result.value.state);
    return result.value;
  }
  async function refresh(detect = false) {
    const id = projects.project()?.id;
    if (!id || polling) return;
    polling = true;
    const requestId = ++statusRequest;
    try {
      await request({ type: 'status', projectId: id, detect });
    } finally {
      if (requestId === statusRequest) polling = false;
    }
  }
  const projectIdentity = createMemo(() => projects.project()?.id);
  createEffect(() => {
    const id = projectIdentity();
    untrack(() => {
      ++generation;
      setState(null);
      setError('');
      setItems([]);
      setTarget(null);
      structureKey = '';
      requestedRevision = '';
      clearManual();
      polling = false;
      ++statusRequest;
      if (id) void refresh();
    });
  });
  async function compile(clean = false, automatic = false) {
    if (mainChoiceRequired()) {
      clearManual();
      setError('Choose the main document in PDF settings before creating the PDF.');
      return;
    }
    const id = projects.project()?.id;
    if (!id) {
      setError('Open a paper folder to create its PDF.');
      return;
    }
    if (!automatic)
      manualIntent = { projectId: id, generation, clean: clean || !!manualIntent?.clean };
    if (busy()) {
      if (!automatic) deferManual();
      return;
    }
    const compileGeneration = generation;
    const compileCancellation = cancellation;
    setBusy(true);
    try {
      const saved = await projects.flushPending();
      if (
        disposed ||
        projects.project()?.id !== id ||
        generation !== compileGeneration ||
        compileCancellation !== cancellation
      )
        return;
      if (!saved) {
        const explicit = !automatic || !!manualIntent;
        clearManual();
        if (explicit)
          setError(
            'Your writing could not be saved yet. Resolve the save message, then try again.',
          );
        return;
      }
      await projects.command({ type: 'refresh' });
      if (
        disposed ||
        projects.project()?.id !== id ||
        generation !== compileGeneration ||
        compileCancellation !== cancellation
      )
        return;
      if (mainChoiceRequired()) {
        clearManual();
        setError('Choose the main document in PDF settings before creating the PDF.');
        return;
      }
      if (projects.project()?.files.some((f) => !f.deleted && f.conflict)) {
        const explicit = !automatic || !!manualIntent;
        clearManual();
        if (explicit) setError('Review the external changes before updating the PDF.');
        return;
      }
      if (dirty()) {
        // Typing during save is normal. Auto updates will follow the next pause;
        // a manual request remains pending rather than becoming an error.
        if (manualIntent) deferManual();
        return;
      }
      if (manualIntent?.projectId === id && manualIntent.generation === generation)
        clean ||= manualIntent.clean;
      clearManual();
      const revision = projects.project()?.sourceRevision ?? '';
      const result = await request({ type: 'build', projectId: id, clean });
      if (result?.kind === 'state') requestedRevision = revision;
    } finally {
      setBusy(false);
    }
  }
  const autoIntent = createMemo(() => {
    const revision = projects.project()?.sourceRevision,
      settings = state()?.settings,
      edit = projects.editVersion?.() ?? 0;
    return revision && settings?.autoBuild && !mainChoiceRequired()
      ? `${revision}:${settings.delayMs}:${edit}`
      : '';
  });
  createEffect(() => {
    const intent = autoIntent();
    if (!intent) return;
    const [revision, delay] = intent.split(':');
    if (revision === requestedRevision && !untrack(dirty)) return;
    const timer = setTimeout(() => void compile(false, true), Number(delay));
    onCleanup(() => clearTimeout(timer));
  });
  const structureRevision = createMemo(() => {
    const project = projects.project();
    return project ? `${project.id}:${project.sourceRevision}` : '';
  });
  createEffect(() => {
    const key = structureRevision();
    if (!key) return;
    structureKey = key;
    const projectId = key.split(':')[0];
    const timer = setTimeout(() => {
      void request({ type: 'structure', projectId }, true).then((value) => {
        if (key === structureKey && value?.kind === 'structure') setItems(value.items);
      });
    }, 400);
    onCleanup(() => clearTimeout(timer));
  });
  async function configure(settings: BuildSettings) {
    const projectId = projects.project()?.id;
    if (!projectId || busy()) return false;
    setBusy(true);
    try {
      if (!(await projects.flushPending())) return false;
      const result = await request({ type: 'settings', projectId, settings });
      if (result) {
        await projects.command({ type: 'refresh' });
        report('PDF settings saved with this paper.');
        return true;
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function locate(location: SourceLocation) {
    const file = projects.project()?.files.find((f) => !f.deleted && f.path === location.path);
    if (!file || file.text === null) {
      report('This source location is unavailable in the current project.');
      return;
    }
    await projects.select(file.id);
    await projects.live(file.id)?.ready;
    const text = projects.live(file.id)?.doc.getText('source').toString();
    if (text === undefined) return;
    const lines = text.split('\n');
    const line = Math.max(1, Math.min(location.line, lines.length));
    const offset =
      lines.slice(0, line - 1).reduce((n, value) => n + value.length + 1, 0) +
      Math.min(location.column, lines[line - 1].length);
    await projects.locate(file.id, offset);
  }
  async function previewSource(location: SourceLocation, revision: string): Promise<boolean> {
    const projectId = projects.project()?.id;
    const build = state()?.successful;
    if (
      !projectId ||
      !build ||
      build.revision !== revision ||
      projects.project()?.sourceRevision !== revision ||
      stale()
    )
      return false;
    const value = await request(
      { type: 'forward', projectId, buildId: build.id, path: location.path, line: location.line },
      true,
    );
    if (
      value?.kind !== 'forward' ||
      stale() ||
      projects.project()?.sourceRevision !== revision ||
      state()?.successful?.id !== build.id
    )
      return false;
    setTarget({
      buildId: build.id,
      page: value.page,
      x: value.x,
      y: value.y,
      sequence: (target()?.sequence ?? 0) + 1,
    });
    return true;
  }
  async function forward() {
    const projectId = projects.project()?.id,
      buildId = state()?.successful?.id,
      file = projects.file();
    if (!projectId || !buildId || !file) {
      report('Create the PDF first, then use Show in PDF.');
      return;
    }
    if (stale()) {
      setError(
        'Your latest edits are not in this PDF. Choose Update PDF, then try navigating again.',
      );
      return;
    }
    const text = projects.live(file.id)?.doc.getText('source').toString() ?? '';
    const line = text.slice(0, projects.caret(file.id)?.head ?? 0).split('\n').length;
    const value = await request({ type: 'forward', projectId, buildId, path: file.path, line });
    if (value?.kind === 'forward' && !stale() && state()?.successful?.id === buildId)
      setTarget({
        buildId,
        page: value.page,
        x: value.x,
        y: value.y,
        sequence: (target()?.sequence ?? 0) + 1,
      });
  }
  async function reverse(page: number, x: number, y: number, displayedBuildId?: string) {
    const projectId = projects.project()?.id,
      buildId = state()?.successful?.id;
    if (!projectId || !buildId || (displayedBuildId && displayedBuildId !== buildId)) return;
    if (stale()) {
      setError(
        'Your latest edits are not in this PDF. Choose Update PDF, then try navigating again.',
      );
      return;
    }
    const value = await request({ type: 'reverse', projectId, buildId, page, x, y });
    if (value?.kind === 'reverse' && !stale() && state()?.successful?.id === buildId)
      await locate(value);
  }
  async function exportPdf() {
    const projectId = projects.project()?.id,
      buildId = state()?.successful?.id;
    if (!window.loom || !projectId || !buildId) return;
    const old = stale();
    const result = await window.loom.exportPdf({ projectId, buildId, stale: old });
    if (projects.project()?.id !== projectId) return;
    if (!result.ok) setError(result.error.message);
    else if (result.value.kind === 'export' && !result.value.cancelled)
      report(
        old ? 'Older PDF saved. Choose Update PDF to include your latest writing.' : 'PDF saved.',
      );
  }
  onMount(() => {
    const timer = setInterval(() => {
      if (running() || state()?.queued) void refresh();
    }, 650);
    const unsubscribe = window.loom?.onServiceEvent((event) => {
      if (event.status.state === 'ready') {
        clearManual();
        ++generation;
        polling = false;
        ++statusRequest;
        void refresh();
      } else if (event.status.state === 'unavailable' && projects.project()) {
        clearManual();
        ++generation;
        setError('LaTeX service interrupted. Reconnect to recover the last successful PDF.');
      }
    });
    onCleanup(() => {
      clearInterval(timer);
      unsubscribe?.();
    });
  });
  onCleanup(() => {
    disposed = true;
    clearManual();
    ++generation;
  });
  return {
    state,
    mainChoiceRequired,
    setMainChoiceRequired,
    error,
    busy,
    items,
    target,
    languageStatus,
    setLanguageStatus,
    stale,
    running,
    request,
    refresh,
    compile,
    configure,
    locate,
    forward,
    previewSource,
    reverse,
    exportPdf,
    cancel: () => {
      ++cancellation;
      clearManual();
      const projectId = projects.project()?.id;
      if (projectId) return request({ type: 'cancel', projectId });
    },
  };
}
export type LatexWorkspace = ReturnType<typeof createLatexWorkspace>;
