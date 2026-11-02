import { createSignal, onCleanup, onMount } from 'solid-js';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type {
  ProjectChoice,
  ProjectCommand,
  ProjectResult,
  ProjectSnapshot,
} from '../../contracts/project';
import { layoutSchema, type Layout } from '../workspace/layout';
export type Caret = { anchor: number; head: number; scroll: number };
export type LiveDocument = {
  doc: Y.Doc;
  persistence: IndexeddbPersistence;
  ready: Promise<void>;
  undo: Y.UndoManager;
  baseline: string | null;
  dirty: boolean;
  initialized: boolean;
};
export function createProjectWorkspace(report: (message: string) => void) {
  const [project, setProject] = createSignal<ProjectSnapshot | null>(null),
    [active, setActive] = createSignal(''),
    [tabs, setTabs] = createSignal<string[]>([]),
    [pending, setPending] = createSignal(false),
    [error, setError] = createSignal(''),
    [version, setVersion] = createSignal(0),
    [font, setFont] = createSignal(14),
    [wrap, setWrap] = createSignal(true),
    [storedLayout, setStoredLayout] = createSignal<Layout | null>(null);
  const docs = new Map<string, LiveDocument>(),
    timers = new Map<string, ReturnType<typeof setTimeout>>(),
    carets = new Map<string, Caret>();
  let disposed = false,
    preferencesTimer: ReturnType<typeof setTimeout> | undefined,
    queue: Promise<unknown> = Promise.resolve(),
    loading = new Set<string>();
  const file = () => project()?.files.find((f) => f.id === active()),
    live = (id: string) => docs.get(id);
  function accept(snapshot: ProjectSnapshot | null, ack?: { id: string; text: string }) {
    if (!snapshot) return;
    if (project()?.id !== snapshot.id) {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const d of docs.values()) {
        void d.persistence.destroy();
        d.doc.destroy();
      }
      docs.clear();
      loading.clear();
      carets.clear();
      setActive('');
      setTabs([]);
      setFont(14);
      setWrap(true);
      setStoredLayout(null);
      try {
        const p = JSON.parse(snapshot.preferences ?? '{}');
        if (typeof p.font === 'number' && p.font >= 11 && p.font <= 24) setFont(p.font);
        if (typeof p.wrap === 'boolean') setWrap(p.wrap);
        if (Array.isArray(p.tabs))
          setTabs(
            p.tabs.filter(
              (id: unknown) => typeof id === 'string' && snapshot.files.some((f) => f.id === id),
            ),
          );
        if (typeof p.active === 'string') setActive(p.active);
        const layout = layoutSchema.safeParse(p.layout);
        if (layout.success) setStoredLayout(layout.data);
        if (p.carets && typeof p.carets === 'object')
          for (const [id, c] of Object.entries(p.carets)) {
            const v = c as Caret;
            if (
              Number.isSafeInteger(v.anchor) &&
              Number.isSafeInteger(v.head) &&
              v.anchor >= 0 &&
              v.head >= 0 &&
              Number.isFinite(v.scroll)
            )
              carets.set(id, v);
          }
      } catch {
        /* Defaults preserve usability. */
      }
    }
    for (const f of snapshot.files) {
      const d = docs.get(f.id);
      if (!d || !d.initialized || !f.loaded) continue;
      if (ack?.id === f.id && d.doc.getText('source').toString() === ack.text) d.dirty = false;
      if (!d.dirty) {
        Y.applyUpdate(d.doc, Uint8Array.from(f.update), 'service');
        d.baseline = f.baseline;
        d.doc.transact(() => d.doc.getMap('bridge').set('baseline', f.baseline), 'service');
      }
    }
    setProject(snapshot);
    setVersion((v) => v + 1);
    if (!snapshot.files.some((f) => f.id === active() && !f.deleted)) {
      const first =
        snapshot.files.find((f) => f.id === snapshot.rootId && !f.deleted) ??
        snapshot.files.find((f) => !f.deleted && f.text !== null);
      if (first) void select(first.id);
    } else if (!docs.has(active()) && !loading.has(active())) void select(active());
  }
  function request(
    c: ProjectCommand,
    ack?: { id: string; text: string },
  ): Promise<ProjectResult | undefined> {
    const run = async () => {
      if (disposed) return;
      if (!window.loom) {
        setError('Open the Electron app to work with project files.');
        return;
      }
      const result = await window.loom.project(c);
      if (disposed) return;
      if (result.ok) {
        setError('');
        accept(result.value, ack);
      } else setError(result.error.message);
      return result;
    };
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  }
  async function flush(id = active()) {
    const d = docs.get(id);
    if (!d) return;
    clearTimeout(timers.get(id));
    timers.delete(id);
    await d.ready;
    const text = d.doc.getText('source').toString();
    return request(
      {
        type: 'sync',
        fileId: id,
        baseline: d.baseline,
        text,
        update: Array.from(Y.encodeStateAsUpdate(d.doc)),
      },
      { id, text },
    );
  }
  async function flushPending() {
    for (const [id, d] of docs)
      if (d.dirty) {
        const result = await flush(id);
        if (result && !result.ok) return false;
      }
    return true;
  }
  async function command(c: ProjectCommand) {
    if (c.type !== 'sync' && c.type !== 'current' && !(await flushPending())) return;
    return request(c);
  }
  function preferences() {
    clearTimeout(preferencesTimer);
    preferencesTimer = setTimeout(() => {
      if (project())
        void command({
          type: 'preferences',
          value: JSON.stringify({
            active: active(),
            tabs: tabs(),
            font: font(),
            wrap: wrap(),
            layout: storedLayout(),
            carets: Object.fromEntries(carets),
          }),
        });
    }, 300);
  }
  async function select(id: string) {
    const f = project()?.files.find((f) => f.id === id);
    if (!f || f.deleted) return;
    const existing = docs.has(id);
    setActive(id);
    setTabs((old) => (old.includes(id) ? old : [...old, id]));
    if (f.text !== null && !docs.has(id) && !loading.has(id)) {
      loading.add(id);
      const projectId = project()!.id;
      let loaded = f;
      if (!loaded.loaded) {
        const result = await request({ type: 'load', fileId: id });
        if (!result?.ok || !result.value) {
          loading.delete(id);
          return;
        }
        loaded = result.value.files.find((f) => f.id === id)!;
      }
      if (project()?.id !== projectId || disposed) return;
      const doc = new Y.Doc(),
        persistence = new IndexeddbPersistence(`loom:${projectId}:${id}`, doc),
        undo = new Y.UndoManager(doc.getText('source'));
      const d: LiveDocument = {
        doc,
        persistence,
        undo,
        ready: Promise.resolve(),
        baseline: loaded.baseline,
        dirty: false,
        initialized: false,
      };
      docs.set(id, d);
      loading.delete(id);
      d.ready = persistence.whenSynced
        .then(() => {
          if (disposed || docs.get(id) !== d) return;
          const recovered = doc.getMap('bridge').get('baseline');
          const recoveredText = doc.getText('source').toString();
          if (
            (typeof recovered === 'string' || recovered === null) &&
            recoveredText !== recovered
          ) {
            d.baseline = recovered;
            d.dirty = true;
          } else {
            Y.applyUpdate(doc, Uint8Array.from(loaded.update), 'service');
            d.baseline = loaded.baseline;
            doc.transact(() => doc.getMap('bridge').set('baseline', loaded.baseline), 'service');
          }
          d.initialized = true;
          doc.on('update', (_update: Uint8Array, origin: unknown) => {
            setVersion((v) => v + 1);
            if (origin === 'service') return;
            d.dirty = true;
            clearTimeout(timers.get(id));
            timers.set(
              id,
              setTimeout(() => void flush(id), 350),
            );
          });
          if (persistence.db)
            persistence.db.onerror = () =>
              setError('Local recovery storage failed. Save to disk before closing.');
          setVersion((v) => v + 1);
          void flush(id);
        })
        .catch(() => {
          setError('Local recovery storage is unavailable. Keep Loom open and save to disk.');
        });
      setVersion((v) => v + 1);
    }
    if (existing) await command({ type: 'load', fileId: id });
    preferences();
  }
  async function choose(choice: ProjectChoice) {
    if (pending()) return;
    if (!window.loom) {
      setError('Project folders require the Electron desktop app.');
      return;
    }
    setPending(true);
    try {
      if (!(await flushPending())) return;
      await queue;
      const result = await window.loom.chooseProject(choice);
      if (result.ok) {
        accept(result.value);
        if (result.value) report(`Opened ${result.value.name}.`);
      } else setError(result.error.message);
    } finally {
      setPending(false);
    }
  }
  const saved = () => {
    version();
    const f = file(),
      d = docs.get(active());
    return !!f?.saved && (!d || (!d.dirty && d.doc.getText('source').toString() === d.baseline));
  };
  onMount(() => {
    void request({ type: 'current' });
    let refreshing = false;
    const interval = setInterval(async () => {
      if (refreshing || !project() || pending()) return;
      refreshing = true;
      try {
        if (await flushPending()) await request({ type: 'refresh' });
      } finally {
        refreshing = false;
      }
    }, 1000);
    const unsubscribe = window.loom?.onServiceEvent((event) => {
      if (event.status.state === 'ready' && project())
        void (async () => {
          setError('Reconnecting project and recovery state…');
          await request({ type: 'current' });
          for (const id of docs.keys()) await flush(id);
        })();
    });
    let closing = false;
    const close = window.loom?.onCloseRequest(() => {
      if (closing) return;
      closing = true;
      void (async () => {
        try {
          for (const id of docs.keys()) {
            const result = await flush(id);
            if (result && !result.ok) return;
          }
          await queue;
          if ([...docs.values()].some((d) => d.dirty)) {
            setError('Still saving. Wait for the disk acknowledgment and close again.');
            return;
          }
          await window.loom?.completeClose();
        } finally {
          closing = false;
        }
      })();
    });
    onCleanup(() => {
      clearInterval(interval);
      unsubscribe?.();
      close?.();
    });
  });
  onCleanup(() => {
    disposed = true;
    clearTimeout(preferencesTimer);
    for (const t of timers.values()) clearTimeout(t);
    for (const d of docs.values()) {
      void d.persistence.destroy();
      d.doc.destroy();
    }
  });
  return {
    project,
    active,
    tabs,
    file,
    live,
    version,
    pending,
    error,
    saved,
    font,
    wrap,
    storedLayout,
    setStoredLayout: (v: Layout) => {
      setStoredLayout(v);
      preferences();
    },
    setFont: (v: number) => {
      setFont(v);
      preferences();
    },
    setWrap: (v: boolean) => {
      setWrap(v);
      preferences();
    },
    caret: (id: string) => carets.get(id),
    saveCaret: (id: string, c: Caret) => {
      carets.set(id, c);
      preferences();
    },
    select,
    command,
    flush,
    choose,
  };
}
export type ProjectWorkspace = ReturnType<typeof createProjectWorkspace>;
