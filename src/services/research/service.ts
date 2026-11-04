import {
  referenceSchema,
  type ResearchCommand,
  type ResearchValue,
} from '../../contracts/research';
import { ProjectService } from '../project/projects';
import {
  bibliography,
  parseBibtex,
  sameRecord,
  manuscriptResources,
  identityMatch,
} from '../../domain/bibliography';
import { retrieve } from './providers';
type Journal = { changes: Array<{ path: string; before: string | null; after: string }> };
export class ResearchService {
  private searches = new Map<string, AbortController>();
  private lastArxiv = 0;
  constructor(
    private projects: ProjectService,
    private active: () => boolean = () => false,
    private fetcher: typeof fetch = fetch,
  ) {}
  private empty(): ResearchValue {
    return { records: [], warnings: [], snapshot: null, message: '', recovery: false };
  }
  private bounded(result: { records: ResearchValue['records']; warnings: string[] }) {
    const records: ResearchValue['records'] = [];
    let omitted = 0;
    for (const r of result.records) {
      const parsed = referenceSchema.safeParse(r);
      if (parsed.success && records.length < 5000) records.push(parsed.data);
      else omitted++;
    }
    const warnings = result.warnings.slice(0, 499).map((w) => w.slice(0, 1000));
    if (omitted || result.warnings.length > 499)
      warnings.push(
        `${omitted} records omitted because of size or result limits. Narrow the query; original files remain unchanged.`,
      );
    return { records, warnings };
  }
  private recoveryVersions(
    pending: string | null,
    files: Array<{ path: string; text: string | null }>,
  ) {
    return pending
      ? (JSON.parse(pending) as Journal).changes.map((c) => ({
          ...c,
          current: files.find((f) => f.path === c.path)?.text ?? null,
        }))
      : [];
  }
  async command(command: ResearchCommand): Promise<ResearchValue> {
    if (command.type === 'cancel') {
      this.searches.get(command.requestId)?.abort();
      return this.empty();
    }
    if (command.type === 'search') {
      if (this.searches.size >= 4 || this.searches.has(command.requestId))
        throw new Error('A search is still stopping. Retry shortly.');
      const controller = new AbortController();
      this.searches.set(command.requestId, controller);
      const timer = setTimeout(() => controller.abort(), 18000);
      try {
        await this.projects.run(async () => {
          await this.projects.current();
          this.projects.buildContext(command.projectId);
        });
        if (controller.signal.aborted) throw new Error('Search canceled or timed out.');
        if (command.provider === 'local')
          return this.projects.run(async () => {
            await this.projects.refresh();
            const context = this.projects.buildContext(command.projectId);
            const result = bibliography(context.files);
            const query = command.query.toLowerCase().trim();
            return {
              ...this.empty(),
              ...this.bounded({
                ...result,
                records: result.records.filter((r) =>
                  [r.key, r.title, r.authors, r.year, r.doi]
                    .join(' ')
                    .toLowerCase()
                    .includes(query),
                ),
              }),
              resources: manuscriptResources(context.files, context.snapshot.rootId).resources,
              recoveryFiles: this.recoveryVersions(
                this.projects.store.get('citation:' + command.projectId),
                context.files,
              ),
              recovery: !!this.projects.store.get('citation:' + command.projectId),
            };
          });

        if (command.provider === 'arxiv') {
          if (Date.now() - this.lastArxiv < 3000)
            throw new Error('Wait three seconds between arXiv searches.');
          this.lastArxiv = Date.now();
        }
        const result = await retrieve(
          command.provider,
          command.query,
          controller.signal,
          this.fetcher,
        );
        return { ...this.empty(), ...this.bounded(result) };
      } finally {
        clearTimeout(timer);
        this.searches.delete(command.requestId);
      }
    }
    return this.projects.run(async () => {
      await this.projects.current();
      await this.projects.refresh();
      const context = this.projects.buildContext(command.projectId),
        journalKey = 'citation:' + command.projectId;
      const pending = this.projects.store.get(journalKey);
      if (command.type === 'recovery') {
        if (command.action === 'inspect')
          return {
            ...this.empty(),
            recovery: !!pending,
            recoveryFiles: this.recoveryVersions(pending, context.files),
            message: pending
              ? 'Citation insertion was interrupted. Finish or undo the saved group before inserting another citation.'
              : '',
          };
        if (this.active()) throw new Error('Stop the agent before recovering a citation group.');
        if (pending && command.action !== 'keep')
          await this.apply(
            JSON.parse(pending) as Journal,
            command.projectId,
            command.action === 'undo',
          );
        if (pending && command.action === 'keep')
          this.projects.store.set(
            'citation-history:' + command.projectId + ':' + Date.now(),
            pending,
          );
        this.projects.store.set(journalKey, '');
        return {
          ...this.empty(),
          snapshot: this.projects.snapshot(),
          message:
            command.action === 'undo'
              ? 'Citation group undone.'
              : command.action === 'keep'
                ? 'Current files kept. Review citations and compile the paper.'
                : 'Citation group finished.',
        };
      }
      if (this.active()) throw new Error('Stop the agent before inserting a citation.');
      if (pending) throw new Error('Recover the interrupted citation group first.');
      const source = context.files.find((f) => f.path === command.sourcePath),
        bib = context.files.find((f) => f.path === command.bibPath);
      if (
        !source ||
        !source.path.endsWith('.tex') ||
        source.text !== command.sourceText ||
        command.offset > command.sourceText.length
      )
        throw new Error('The source changed. Close References, place the cursor again and retry.');
      if (
        !command.bibPath.endsWith('.bib') ||
        (bib?.text ?? null) !== command.bibText ||
        bib?.diskKind === 'binary'
      )
        throw new Error(
          'The bibliography changed. Search project references again before inserting.',
        );
      const parsed = parseBibtex(command.record.bibtex);
      const entry = parsed.entries[0];
      if (parsed.errors.length || parsed.entries.length !== 1 || !entry)
        throw new Error('This entry cannot be imported safely. Edit its original BibTeX first.');
      const local = bibliography(context.files);
      if (local.warnings.some((w) => w.includes('Unparsed')))
        throw new Error('Repair unparsed bibliography entries before importing.');
      const definitive = local.records.filter((r) => identityMatch(r, command.record));
      const matches = definitive.length
        ? definitive
        : command.differentTitle
          ? []
          : local.records.filter((r) => sameRecord(r, command.record));
      if (matches.length > 1)
        throw new Error(
          'Multiple existing records match this source. Resolve duplicate records in the bibliography first.',
        );
      const existing = matches[0];
      if (existing && !identityMatch(existing, command.record) && !command.reuseTitle)
        throw new Error(
          'A record has the same title. Confirm that it is the same source before reusing its key.',
        );
      if (existing && existing.key !== command.key)
        throw new Error(`This source already exists as ${existing.key}. Use its existing key.`);
      if (local.records.some((r) => r.key === command.key && r !== existing))
        throw new Error('That citation key belongs to another record. Choose a unique key.');
      const actualBib = existing?.path ?? command.bibPath;
      const graph = manuscriptResources(context.files, context.snapshot.rootId),
        resources = graph.resources;
      if (!graph.reachable.includes(command.sourcePath))
        throw new Error(
          'This source is not reachable from the selected main document through literal input/include commands. Select the main document or add a supported include before citing.',
        );
      if (!resources.includes(actualBib))
        throw new Error(
          `The manuscript does not declare ${actualBib}. Add \\addbibresource{${actualBib}} for biblatex or \\bibliography{${actualBib.replace(/\.bib$/, '')}} for BibTeX, then retry.`,
        );
      const newEntry = entry.raw.replace(/^(@[a-z]+\s*[{(])\s*[^,]+,/i, `$1${command.key},`);
      const citation = `\\${command.command}{${command.key}}`;
      const changes: Journal['changes'] = [];
      if (!existing)
        changes.push({
          path: command.bibPath,
          before: command.bibText,
          after:
            (command.bibText ?? '') +
            ((command.bibText ?? '').endsWith('\n') ? '\n' : '\n\n') +
            `% Imported from ${command.record.provider}; source: ${command.record.url.replace(/[\r\n]/g, ' ')}\n` +
            newEntry +
            '\n',
        });
      changes.push({
        path: command.sourcePath,
        before: command.sourceText,
        after:
          command.sourceText.slice(0, command.offset) +
          citation +
          command.sourceText.slice(command.offset),
      });
      const journal = { changes };
      this.projects.store.set(journalKey, JSON.stringify(journal));
      await this.apply(journal, command.projectId, false);
      this.projects.store.set(journalKey, '');
      return {
        ...this.empty(),
        snapshot: this.projects.snapshot(),
        message: existing
          ? `Cited existing ${existing.key}; no duplicate entry added.`
          : `Imported and cited ${command.key}.`,
      };
    });
  }
  private async apply(journal: Journal, projectId: string, undo: boolean) {
    // Validate the entire group before touching either file; replay is idempotent.
    const current = await this.projects.agentFiles(projectId);
    for (const c of journal.changes) {
      const value = current.get(c.path)?.toString('utf8') ?? null;
      if (value !== c.before && value !== c.after)
        throw new Error(
          'A citation-group file has newer edits. Inspect the saved versions below. Finish/Undo requires those versions; Keep current files preserves your newer work and releases this group.',
        );
    }
    for (const c of undo ? [...journal.changes].reverse() : journal.changes) {
      const expected = current.get(c.path) ?? null,
        desired = undo ? c.before : c.after;
      if ((expected?.toString('utf8') ?? null) === desired) continue;
      await this.projects.agentRestore(
        projectId,
        c.path,
        expected,
        desired === null ? null : Buffer.from(desired),
      );
      this.projects.onHumanWrite?.(c.path);
    }
  }
}
