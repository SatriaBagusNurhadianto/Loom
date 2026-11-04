import { sameRecord, identityMatch } from '../../domain/bibliography';
import type { ResearchValue } from '../../contracts/research';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import type { Reference } from '../../contracts/research';
import type { ProjectWorkspace } from '../editor/documents';
import type { AgentWorkspace } from '../agent/workspace';
import { IconButton, Modal } from '../ui/primitives';
import './references.css';
type Provider = 'local' | 'arxiv' | 'zotero';
type CitationCommand = 'cite' | 'citep' | 'citet' | 'autocite' | 'parencite' | 'textcite';
export function References(props: {
  open: boolean;
  onClose: () => void;
  projects: ProjectWorkspace;
  agent: AgentWorkspace;
  report: (text: string) => void;
}) {
  const [provider, setProvider] = createSignal<Provider>('local'),
    [query, setQuery] = createSignal(''),
    [records, setRecords] = createSignal<Reference[]>([]),
    [local, setLocal] = createSignal<Reference[]>([]),
    [warnings, setWarnings] = createSignal<string[]>([]),
    [selected, setSelected] = createSignal<Reference | null>(null),
    [busy, setBusy] = createSignal(false),
    [saving, setSaving] = createSignal(false),
    [error, setError] = createSignal(''),
    [message, setMessage] = createSignal(''),
    [searched, setSearched] = createSignal(false),
    [recovery, setRecovery] = createSignal(false),
    [key, setKey] = createSignal(''),
    [bibPath, setBibPath] = createSignal(''),
    [command, setCommand] = createSignal<CitationCommand>('cite'),
    [target, setTarget] = createSignal<{
      id: string;
      path: string;
      text: string;
      offset: number;
      claim: string;
    } | null>(null);
  const [reuseTitle, setReuseTitle] = createSignal(false),
    [differentTitle, setDifferentTitle] = createSignal(false);
  const [resources, setResources] = createSignal<string[]>([]),
    [recoveryFiles, setRecoveryFiles] = createSignal<NonNullable<ResearchValue['recoveryFiles']>>(
      [],
    ),
    [keepReviewed, setKeepReviewed] = createSignal(false);
  let generation = 0,
    requestId = '',
    searchInput!: HTMLInputElement;
  const cancel = () => {
    generation++;
    if (requestId) void window.loom?.research({ type: 'cancel', requestId });
    requestId = '';
    setBusy(false);
  };
  const reset = () => {
    cancel();
    setSelected(null);
    setError('');
    setMessage('');
    setRecords([]);
    setWarnings([]);
    setSearched(false);
  };
  const close = () => {
    if (saving()) return;
    cancel();
    props.onClose();
  };
  const bibFiles = () =>
    props.projects.project()?.files.filter((f) => !f.deleted && f.path.endsWith('.bib')) ?? [];
  const choose = (record: Reference) => {
    setSelected(record);
    setReuseTitle(false);
    setDifferentTitle(false);
    setKey(record.key);
    setError('');
    setMessage('');
  };
  async function search() {
    cancel();
    const epoch = generation,
      projectId = props.projects.project()?.id;
    if (!projectId || !window.loom) return;
    setBusy(true);
    setSelected(null);
    setError('');
    setMessage('');
    setRecords([]);
    setWarnings([]);
    setSearched(false);
    requestId = crypto.randomUUID();
    try {
      const result = await props.projects.research(
        {
          type: 'search',
          projectId,
          requestId,
          provider: provider(),
          query: query().trim(),
        },
        () => epoch === generation && props.open && props.projects.project()?.id === projectId,
      );
      if (epoch !== generation || !props.open || props.projects.project()?.id !== projectId) return;
      if (!result?.ok) {
        setError(result && !result.ok ? result.error.message : 'Save the paper before searching.');
        return;
      }
      setRecords(result.value.records);
      setWarnings(result.value.warnings);
      setSearched(true);
      if (provider() === 'local') {
        if (!query().trim()) setLocal(result.value.records);
        setRecovery(result.value.recovery);
        if (result.value.resources) {
          setResources(result.value.resources);
          if (!bibFiles().some((f) => f.path === bibPath()) && result.value.resources[0])
            setBibPath(result.value.resources[0]);
        }
        if (result.value.recoveryFiles) setRecoveryFiles(result.value.recoveryFiles);
      }
    } catch {
      if (epoch === generation) setError('Reference search was interrupted. Retry.');
    } finally {
      if (epoch === generation) {
        setBusy(false);
        requestId = '';
      }
    }
  }
  const formKey = createMemo(() => (props.open ? (props.projects.project()?.id ?? '') : ''));
  createEffect(() => {
    const id = formKey(),
      open = !!id;
    untrack(() => {
      reset();
      if (!open || !id) return;
      setResources([]);
      setRecoveryFiles([]);
      setKeepReviewed(false);
      setProvider('local');
      setQuery('');
      setRecovery(false);
      setLocal([]);
      const file = props.projects.file(),
        text = file ? props.projects.live(file.id)?.doc.getText('source').toString() : undefined,
        caret = file ? props.projects.caret(file.id) : undefined;
      setTarget(
        file?.path.endsWith('.tex') && text !== undefined
          ? {
              id: file.id,
              path: file.path,
              text,
              offset: caret?.head ?? 0,
              claim: caret
                ? text.slice(Math.min(caret.anchor, caret.head), Math.max(caret.anchor, caret.head))
                : '',
            }
          : null,
      );
      const declared = /\\(?:addbibresource(?:\[[^\]]*\])?|bibliography)\s*\{([^},]+)/.exec(
        text ?? '',
      )?.[1];
      setBibPath(
        declared
          ? declared.replace(/\.bib$/, '') + '.bib'
          : (bibFiles()[0]?.path ?? 'references.bib'),
      );
      const existing = /\\(citep|citet|autocite|parencite|textcite)\b/.exec(text ?? '')?.[1];
      setCommand((existing ?? 'cite') as CitationCommand);
      void search();
    });
  });
  onCleanup(cancel);
  const titleCandidate = createMemo(() => {
    const record = selected();
    if (!record || local().some((r) => identityMatch(r, record))) return;
    return local().find((r) => sameRecord(r, record));
  });
  const existing = createMemo(() => {
    const record = selected();
    if (!record) return;
    return (
      local().find((r) => identityMatch(r, record)) ??
      (!differentTitle() ? titleCandidate() : undefined)
    );
  });
  const effectiveKey = () => existing()?.key ?? key();
  const collision = () => local().some((r) => r.key === effectiveKey() && r.id !== existing()?.id);
  const validKey = () => /^[a-zA-Z0-9][a-zA-Z0-9:._+/-]{0,199}$/.test(effectiveKey());
  async function insert() {
    const record = selected(),
      t = target(),
      projectId = props.projects.project()?.id;
    if (!record || !t || !projectId || saving()) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const file = bibFiles().find((f) => f.path === bibPath());
      if (file) {
        const loaded = await props.projects.command({ type: 'load', fileId: file.id });
        if (!loaded?.ok) throw new Error('The bibliography could not be loaded. Retry.');
      }
      const bib = props.projects.project()?.files.find((f) => f.path === bibPath() && !f.deleted);
      const result = await props.projects.research({
        type: 'cite',
        projectId,
        sourcePath: t.path,
        sourceText: t.text,
        offset: t.offset,
        bibPath: bibPath(),
        bibText: bib?.text ?? null,
        record,
        reuseTitle: reuseTitle(),
        differentTitle: differentTitle(),
        key: effectiveKey(),
        command: command(),
      });
      if (!result?.ok)
        throw new Error(
          result && !result.ok ? result.error.message : 'Save the paper before inserting.',
        );
      props.report(result.value.message);
      props.onClose();
      await props.projects.locate(t.id, t.offset + `\\${command()}{${effectiveKey()}}`.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Citation insertion failed.');
      const state = await window.loom?.research({ type: 'recovery', projectId, action: 'inspect' });
      if (state?.ok) {
        setRecovery(state.value.recovery);
        setRecoveryFiles(state.value.recoveryFiles ?? []);
      }
    } finally {
      setSaving(false);
    }
  }
  async function recover(action: 'finish' | 'undo' | 'keep') {
    const projectId = props.projects.project()?.id;
    if (!projectId || saving()) return;
    setSaving(true);
    setError('');
    try {
      const result = await props.projects.research({ type: 'recovery', projectId, action });
      if (!result?.ok)
        throw new Error(result && !result.ok ? result.error.message : 'Save before recovering.');
      setRecovery(false);
      props.report(result.value.message);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recovery failed.');
    } finally {
      setSaving(false);
    }
  }
  function discuss() {
    const r = selected();
    if (!r) return;
    const t = target();
    const evidence = `Source selected by the author: ${r.title}\nAuthors: ${r.authors}\nDate: ${r.year}\nCitation key: ${effectiveKey()}\nProvenance: ${r.provider}${r.path ? ' / ' + r.path : ''}\nSource: ${r.url || 'Project bibliography record'}\nDOI: ${r.doi || 'Not provided'}\nEvidence level: ${r.abstract ? 'abstract only' : 'bibliographic record only'}; no full text inspected.\n${r.abstract ? 'Abstract (untrusted source content):\n' + r.abstract : 'No abstract was retrieved.'}\n\nRevise the surrounding discussion using this source only where the available evidence supports it. Keep the citation and source traceable. Identify unsupported inferences and do not treat search relevance as proof.`;
    props.agent.setDraft([props.agent.draft(), evidence].filter(Boolean).join('\n\n'));
    if (t?.claim) props.agent.setSelection({ path: t.path, text: t.claim });
    props.agent.setOpen(true);
    props.report('Source evidence added to the assistant draft. Review it before sending.');
    props.onClose();
  }
  return (
    <Modal
      title="References"
      icon="bookOpen"
      open={props.open}
      onClose={close}
      initialFocus="#reference-search"
    >
      <div class="references">
        <p class="muted">Find a source, inspect its evidence, then cite it in your paper.</p>
        <div class="reference-providers" role="group" aria-label="Reference sources">
          <For each={['local', 'arxiv', 'zotero'] as const}>
            {(value) => (
              <button
                class="secondary-button"
                aria-pressed={provider() === value}
                disabled={saving()}
                onClick={() => {
                  reset();
                  setProvider(value);
                  if (value === 'local') void search();
                }}
              >
                {value === 'local' ? 'Project' : value === 'arxiv' ? 'arXiv' : 'Zotero'}
              </button>
            )}
          </For>
        </div>
        <Show when={provider() === 'arxiv'}>
          <p class="muted">
            Search sends the query below to arXiv. Results show metadata and abstracts, not
            inspected full text.
          </p>
        </Show>
        <Show when={provider() === 'zotero'}>
          <p class="muted">
            Reads your local Zotero library. Open Zotero and enable Settings → Advanced → Allow
            other applications on this computer to communicate with Zotero. Your library is never
            edited.
          </p>
        </Show>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving()) void search();
          }}
          class="reference-search"
        >
          <div class="search-field">
            <input
              id="reference-search"
              ref={searchInput}
              aria-label="Search references"
              placeholder={
                provider() === 'local' ? 'Title, author, year, DOI or key' : 'Search for papers'
              }
              value={query()}
              disabled={saving()}
              onInput={(e) => {
                cancel();
                setQuery(e.currentTarget.value);
                setSelected(null);
                setRecords([]);
                setSearched(false);
                setError('');
              }}
            />
            <Show when={query()}>
              <IconButton
                label="Clear reference search"
                icon="close"
                disabled={saving()}
                onClick={() => {
                  reset();
                  setQuery('');
                  searchInput.focus();
                  if (provider() === 'local') void search();
                }}
              />
            </Show>
          </div>
          <button
            class="secondary-button"
            disabled={saving() || busy() || (provider() !== 'local' && !query().trim())}
          >
            Search
          </button>
          <Show when={busy()}>
            <button type="button" class="secondary-button" onClick={cancel}>
              Cancel
            </button>
          </Show>
        </form>
        <Show when={target()?.claim}>
          <button
            class="secondary-button"
            disabled={saving()}
            onClick={() => {
              reset();
              setQuery(target()!.claim.slice(0, 500));
              searchInput.focus();
            }}
          >
            Use selected passage as query
          </button>
        </Show>
        <Show when={recovery()}>
          <section class="reference-recovery">
            <h3>Interrupted citation group</h3>
            <p>
              The saved source and bibliography group needs recovery. Newer edits are preserved if
              they prevent replay.
            </p>
            <For each={recoveryFiles()}>
              {(file) => (
                <details>
                  <summary>Saved versions · {file.path}</summary>
                  <For each={['before', 'after', 'current'] as const}>
                    {(version) => (
                      <section>
                        <h4>
                          {version === 'before'
                            ? 'Before insertion'
                            : version === 'after'
                              ? 'Planned insertion'
                              : 'Current file'}
                        </h4>
                        <pre class="reference-saved-version">
                          {(file[version] ?? '(file absent)').slice(0, 20000)}
                        </pre>
                        <button
                          class="secondary-button"
                          disabled={file[version] === null}
                          onClick={() =>
                            void navigator.clipboard.writeText(file[version] ?? '').then(
                              () => setMessage('Full saved version copied.'),
                              () =>
                                setError(
                                  'Clipboard unavailable. Select the saved text to copy it.',
                                ),
                            )
                          }
                        >
                          Copy full {version} version
                        </button>
                      </section>
                    )}
                  </For>
                </details>
              )}
            </For>
            <label class="check-row">
              <input
                type="checkbox"
                checked={keepReviewed()}
                onChange={(e) => setKeepReviewed(e.currentTarget.checked)}
              />
              I reviewed the saved versions and want to keep the current files. The citation may
              need manual repair.
            </label>
            <div class="button-row">
              <button
                class="secondary-button"
                disabled={saving()}
                onClick={() => void recover('finish')}
              >
                Finish insertion
              </button>
              <button
                class="secondary-button"
                disabled={saving()}
                onClick={() => void recover('undo')}
              >
                Undo insertion
              </button>
              <button
                class="secondary-button"
                disabled={saving() || !keepReviewed()}
                onClick={() => void recover('keep')}
              >
                Keep current files
              </button>
            </div>
          </section>
        </Show>
        <Show when={error()}>
          <p class="inline-error" role="alert">
            {error()}
          </p>
        </Show>
        <Show when={message()}>
          <p role="status">{message()}</p>
        </Show>
        <Show when={warnings().length}>
          <details>
            <summary>{warnings().length} bibliography or retrieval notices</summary>
            <ul>
              <For each={warnings()}>{(w) => <li>{w}</li>}</For>
            </ul>
          </details>
        </Show>
        <p class="muted reference-status" role="status">
          {busy()
            ? 'Searching…'
            : searched()
              ? `${records().length} results${provider() === 'arxiv' ? ' · first 30 matches' : provider() === 'zotero' ? ' · first 50 matches' : ''}`
              : 'Enter a query and choose Search.'}
        </p>
        <Show when={searched() && !records().length}>
          <p class="muted">
            {provider() === 'local' && !query()
              ? 'No bibliography records yet. Add a .bib file and declare it in your manuscript to start citing.'
              : 'No matching records. Try a different query.'}
          </p>
        </Show>
        <div class="reference-layout">
          <div class="reference-results" aria-label="Reference results">
            <For each={records().slice(0, 100)}>
              {(r) => (
                <button
                  class="reference-result"
                  aria-pressed={selected()?.id === r.id}
                  disabled={saving()}
                  onClick={() => choose(r)}
                >
                  <strong>{r.title || r.key || 'Untitled record'}</strong>
                  <span>{r.authors || 'Author not provided'}</span>
                  <span>
                    {r.year || 'Date not provided'} · {r.key}
                  </span>
                  <Show when={r.issues.length}>
                    <small>{r.issues.join(' · ')}</small>
                  </Show>
                </button>
              )}
            </For>
            <Show when={records().length > 100}>
              <p class="muted">Showing the first 100 records. Refine the query to find more.</p>
            </Show>
          </div>
          <Show when={selected()}>
            {(r) => (
              <section class="reference-detail" aria-label="Selected reference">
                <h3>{r().title || r().key}</h3>
                <p>
                  {r().authors || 'Author not provided'} · {r().year || 'Date not provided'}
                </p>
                <p class="muted">
                  {r().provider === 'local'
                    ? `Project bibliography · ${r().path}`
                    : r().provider === 'arxiv'
                      ? 'Retrieved from arXiv'
                      : 'Retrieved from local Zotero'}
                  {r().doi ? ` · DOI: ${r().doi}` : ''}
                </p>
                <p class="reference-evidence">
                  {r().abstract
                    ? 'Abstract only · full text not inspected'
                    : 'Bibliographic record only · no abstract retrieved'}
                </p>
                <Show when={r().abstract}>
                  <blockquote>{r().abstract}</blockquote>
                </Show>
                <p class="muted">
                  Search relevance does not establish support for a claim. Inspect the source before
                  relying on it.
                </p>
                <Show when={/^https?:\/\//.test(r().url)}>
                  <button
                    class="secondary-button"
                    disabled={saving()}
                    onClick={() =>
                      void window.loom?.openSource(r().url.replace(/^http:/, 'https:'))
                    }
                  >
                    Open source ↗
                  </button>
                  <p class="muted reference-url">{r().url}</p>
                </Show>
                <label class="form-field">
                  Citation key
                  <input
                    value={effectiveKey()}
                    disabled={!!existing() || saving()}
                    onInput={(e) => setKey(e.currentTarget.value)}
                    aria-invalid={!validKey() || collision()}
                  />
                </label>
                <Show when={existing() && identityMatch(existing()!, r())}>
                  <p class="muted">
                    Already in {existing()!.path}. Reuses {existing()!.key}; no duplicate will be
                    imported.
                  </p>
                </Show>
                <Show when={titleCandidate()}>
                  {(candidate) => (
                    <section class="reference-recovery">
                      <h4>Possible matching title</h4>
                      <p>
                        {candidate().title} · {candidate().authors || 'Author not provided'} ·{' '}
                        {candidate().year || 'Date not provided'} · {candidate().key} in{' '}
                        {candidate().path}
                      </p>
                      <Show when={candidate().doi}>
                        <p>DOI: {candidate().doi}</p>
                      </Show>
                      <label class="check-row">
                        <input
                          type="radio"
                          name="reference-title-choice"
                          checked={reuseTitle() && !differentTitle()}
                          onChange={() => {
                            setReuseTitle(true);
                            setDifferentTitle(false);
                          }}
                        />
                        Same source — reuse the existing entry
                      </label>
                      <label class="check-row">
                        <input
                          type="radio"
                          name="reference-title-choice"
                          checked={differentTitle()}
                          onChange={() => {
                            setReuseTitle(false);
                            setDifferentTitle(true);
                            setKey(r().key);
                          }}
                        />
                        Different source — import with a unique key
                      </label>
                    </section>
                  )}
                </Show>
                <Show when={collision()}>
                  <p class="inline-error">
                    This key belongs to another record. Choose a unique key.
                  </p>
                </Show>
                <Show when={!validKey()}>
                  <p class="inline-error">
                    Use letters, numbers, dots, hyphens or colons in a citation key.
                  </p>
                </Show>
                <label class="form-field">
                  Bibliography file
                  <select
                    aria-label="Bibliography file"
                    disabled={saving() || !!existing()}
                    value={existing()?.path ?? bibPath()}
                    onChange={(e) => setBibPath(e.currentTarget.value)}
                  >
                    <Show when={!bibFiles().length && !resources().length}>
                      <option value={bibPath()}>{bibPath()}</option>
                    </Show>
                    <For each={[...new Set([...resources(), ...bibFiles().map((f) => f.path)])]}>
                      {(path) => (
                        <option value={path}>
                          {path}
                          {!bibFiles().some((f) => f.path === path) ? ' (new file)' : ''}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                <p class="muted">
                  Use the citation command supported by your paper. citep/citet require natbib;
                  autocite/parencite/textcite require biblatex.
                </p>
                <label class="form-field">
                  Citation style
                  <select
                    aria-label="Citation style"
                    disabled={saving()}
                    value={command()}
                    onChange={(e) => setCommand(e.currentTarget.value as CitationCommand)}
                  >
                    <For each={['cite', 'citep', 'citet', 'autocite', 'parencite', 'textcite']}>
                      {(c) => (
                        <option value={c}>
                          \{c}
                          {'{key}'}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                <details>
                  <summary>BibTeX preview</summary>
                  <pre>
                    {r().bibtex.replace(/^(@[a-z]+\s*[{(])\s*[^,]+,/i, `$1${effectiveKey()},`)}
                  </pre>
                </details>
                <p class="muted">
                  {target()
                    ? `Insert \\${command()}{${effectiveKey()}} at the saved cursor in ${target()!.path}. Existing bibliography fields stay unchanged.`
                    : 'Open a .tex file and place the cursor to insert a citation.'}
                </p>
                <div class="button-row">
                  <button
                    class="primary-button"
                    disabled={
                      saving() ||
                      busy() ||
                      recovery() ||
                      !target() ||
                      !validKey() ||
                      collision() ||
                      props.agent.busy() ||
                      props.agent.state()?.running ||
                      (!!existing() && !identityMatch(existing()!, r()) && !reuseTitle())
                    }
                    onClick={() => void insert()}
                  >
                    {saving() ? 'Saving…' : existing() ? 'Insert citation' : 'Import and cite'}
                  </button>
                  <button
                    class="secondary-button"
                    disabled={saving() || props.agent.busy() || props.agent.state()?.running}
                    onClick={discuss}
                  >
                    Discuss with agent
                  </button>
                </div>
                <Show when={props.agent.state()?.running}>
                  <p class="muted">
                    Stop the agent before importing or preparing another revision.
                  </p>
                </Show>
              </section>
            )}
          </Show>
        </div>
      </div>
    </Modal>
  );
}
