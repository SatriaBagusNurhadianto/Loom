import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import {
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { LatexWorkspace } from './workspace';
GlobalWorkerOptions.workerSrc = workerUrl;

/** Paginated virtualization: one page/canvas/text layer is mounted at any time. */
export function PdfViewer(props: {
  latex: LatexWorkspace;
  onSource: () => void;
  position: { page: number; zoom: number; scroll: number };
  savePosition: (position: { page: number; zoom: number; scroll: number }) => void;
}) {
  const [pdf, setPdf] = createSignal<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = createSignal(props.position.page);
  const [zoom, setZoom] = createSignal(props.position.zoom);
  const [width, setWidth] = createSignal(400);
  const [loading, setLoading] = createSignal(false);
  const [rendering, setRendering] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pageSize, setPageSize] = createSignal({ width: 612, height: 792, scale: 1 });
  const [loadedBuild, setLoadedBuild] = createSignal('');
  let scroller!: HTMLDivElement,
    canvas!: HTMLCanvasElement,
    text!: HTMLDivElement,
    sheet!: HTMLDivElement;
  let rememberedScroll = props.position.scroll;
  let selectedPoint: { x: number; y: number; page: number } | null = null;
  let generation = 0;
  const canMap = () =>
    !loading() &&
    !rendering() &&
    loadedBuild() === props.latex.state()?.successful?.id &&
    !props.latex.stale();
  const persist = () =>
    props.savePosition({
      page: pageNumber(),
      zoom: zoom(),
      scroll: scroller?.scrollTop ?? rememberedScroll,
    });
  onMount(() => {
    const observer = new ResizeObserver(() => setWidth(Math.max(180, scroller.clientWidth - 40)));
    observer.observe(scroller);
    onCleanup(() => observer.disconnect());
  });
  const buildKey = createMemo(() => {
    const state = props.latex.state();
    return state?.successful ? `${state.projectId}:${state.successful.id}` : '';
  });
  createEffect(() => {
    const key = buildKey();
    if (!key) return;
    const [projectId, buildId] = key.split(':');
    const current = ++generation;
    let task: ReturnType<typeof getDocument> | undefined;
    setLoading(true);
    setError('');
    void props.latex.request({ type: 'pdf', projectId, buildId }).then(async (value) => {
      if (current !== generation) return;
      if (value?.kind !== 'pdf') {
        setError('The PDF could not be loaded. Recompile or reconnect and retry.');
        setLoading(false);
        return;
      }
      const data = Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0));
      task = getDocument({ data, useSystemFonts: true });
      try {
        const document = await task.promise;
        if (current !== generation) {
          void task?.destroy();
          return;
        }
        rememberedScroll = scroller.scrollTop || rememberedScroll;
        setPageNumber((n) => Math.max(1, Math.min(n, document.numPages)));
        setPdf(document);
        setLoadedBuild(buildId);
        setLoading(false);
      } catch {
        if (current === generation) {
          setError('PDF.js could not read this PDF. Recompile and check the build log.');
          setLoading(false);
        }
      }
    });
    onCleanup(() => {
      ++generation;
      void task?.destroy();
    });
  });
  createEffect(() => {
    const document = pdf(),
      number = pageNumber(),
      availableWidth = width(),
      factor = zoom();
    const target = props.latex.target();
    if (!document) return;
    let disposed = false,
      render: RenderTask | undefined,
      layer: TextLayer | undefined,
      page: PDFPageProxy | undefined;
    const surface = window.document.createElement('canvas');
    surface.setAttribute('aria-label', `Rendered PDF page ${number}`);
    canvas.replaceWith(surface);
    canvas = surface;
    const textSurface = window.document.createElement('div');
    textSurface.className = 'textLayer';
    text.replaceWith(textSurface);
    text = textSurface;
    setRendering(true);
    setError('');
    selectedPoint = null;
    void document
      .getPage(number)
      .then(async (p) => {
        page = p;
        if (disposed) return;
        const original = p.getViewport({ scale: 1 });
        const scale = Math.max(0.1, availableWidth / original.width) * factor;
        const viewport = p.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          Math.sqrt(8_000_000 / (viewport.width * viewport.height)),
        );
        surface.width = Math.max(1, Math.floor(viewport.width * ratio));
        surface.height = Math.max(1, Math.floor(viewport.height * ratio));
        surface.style.width = `${viewport.width}px`;
        surface.style.height = `${viewport.height}px`;
        sheet.style.width = `${viewport.width}px`;
        sheet.style.height = `${viewport.height}px`;
        sheet.style.setProperty('--total-scale-factor', String(scale));
        setPageSize({ width: original.width, height: original.height, scale });
        textSurface.replaceChildren();
        render = p.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        layer = new TextLayer({
          textContentSource: p.streamTextContent(),
          viewport,
          container: textSurface,
        });
        await Promise.all([render.promise, layer.render()]);
        if (disposed) return;
        setRendering(false);
        if (target && target.buildId === loadedBuild() && target.page === number)
          scroller.scrollTop = Math.max(0, target.y * scale - scroller.clientHeight * 0.35);
        else scroller.scrollTop = rememberedScroll;
        persist();
      })
      .catch((e: unknown) => {
        if (!disposed && (e as { name?: string }).name !== 'RenderingCancelledException') {
          setRendering(false);
          setError('This page could not be rendered. Try another page or recompile.');
        }
      });
    onCleanup(() => {
      disposed = true;
      render?.cancel();
      layer?.cancel();
      if (render) void render.promise.catch(() => {}).then(() => page?.cleanup());
      else page?.cleanup();
      surface.width = surface.height = 0;
      textSurface.replaceChildren();
    });
  });
  createEffect(() => {
    const target = props.latex.target();
    if (target?.buildId === loadedBuild()) {
      rememberedScroll = 0;
      setPageNumber(Math.max(1, Math.min(target.page, pdf()?.numPages ?? 1)));
    }
  });
  function navigate(value: number) {
    if (!pdf()) return;
    rememberedScroll = 0;
    setPageNumber(Math.max(1, Math.min(Math.floor(value) || 1, pdf()!.numPages)));
    persist();
  }
  function point(event: MouseEvent | PointerEvent) {
    const rect = sheet.getBoundingClientRect(),
      size = pageSize();
    return {
      page: pageNumber(),
      x: Math.max(0, Math.min(size.width, (event.clientX - rect.left) / size.scale)),
      y: Math.max(0, Math.min(size.height, (event.clientY - rect.top) / size.scale)),
    };
  }
  async function showSource(location?: { x: number; y: number; page: number }) {
    const rect = sheet.getBoundingClientRect(),
      container = scroller.getBoundingClientRect();
    const center = {
      page: pageNumber(),
      x: pageSize().width / 2,
      y: Math.min(
        pageSize().height,
        Math.max(0, (container.top - rect.top + scroller.clientHeight / 2) / pageSize().scale),
      ),
    };
    const value = location ?? selectedPoint ?? center;
    if (!canMap()) return;
    await props.latex.reverse(value.page, value.x, value.y, loadedBuild());
    props.onSource();
  }
  onCleanup(persist);
  return (
    <div class="pdf-viewer" aria-label="Compiled PDF viewer">
      <div class="pdf-reading-controls">
        <button
          aria-label="Previous PDF page"
          disabled={!pdf() || pageNumber() <= 1}
          onClick={() => navigate(pageNumber() - 1)}
        >
          ‹
        </button>
        <label>
          Page{' '}
          <input
            aria-label="PDF page number"
            type="number"
            min="1"
            max={pdf()?.numPages ?? 1}
            value={pageNumber()}
            onChange={(e) => navigate(Number(e.currentTarget.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate(Number(e.currentTarget.value));
            }}
          />
        </label>
        <span>of {pdf()?.numPages ?? '…'}</span>
        <button
          aria-label="Next PDF page"
          disabled={!pdf() || pageNumber() >= pdf()!.numPages}
          onClick={() => navigate(pageNumber() + 1)}
        >
          ›
        </button>
        <label class="pdf-zoom-label">
          Zoom{' '}
          <select
            aria-label="PDF zoom"
            disabled={loading()}
            value={zoom()}
            onChange={(e) => {
              rememberedScroll = scroller.scrollTop;
              setZoom(Number(e.currentTarget.value));
              persist();
            }}
          >
            <option value="1">Fit width</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
            <option value="3">300%</option>
          </select>
        </label>
        <button
          class="pdf-source-action"
          disabled={!pdf() || !canMap()}
          onClick={() => void showSource()}
        >
          Show source
        </button>
      </div>
      <div class="pdf-load-status" role="status">
        {loading()
          ? 'Loading PDF…'
          : rendering()
            ? 'Rendering page…'
            : `Page ${pageNumber()} · Select text or double-click a passage to show source`}
      </div>
      <Show when={error()}>
        <div class="pdf-inline-error" role="alert">
          {error()}
          <button onClick={() => void props.latex.compile()}>Update PDF</button>
        </div>
      </Show>
      <div
        class="pdf-scroll compiled-scroll"
        ref={scroller}
        onScroll={() => {
          rememberedScroll = scroller.scrollTop;
          persist();
        }}
        aria-busy={loading() || rendering()}
      >
        <div
          class="pdf-sheet"
          ref={sheet}
          role="document"
          aria-label={`PDF page ${pageNumber()}`}
          onPointerUp={(event) => {
            selectedPoint = point(event);
          }}
          onDblClick={(event) => void showSource(point(event))}
        >
          <canvas ref={canvas} aria-label={`Rendered PDF page ${pageNumber()}`} />
          <div class="textLayer" ref={text} />
          <Show
            when={
              props.latex.target()?.page === pageNumber() &&
              props.latex.target()?.buildId === loadedBuild()
            }
          >
            <div
              class="pdf-source-marker"
              style={{ top: `${(props.latex.target()?.y ?? 0) * pageSize().scale}px` }}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
