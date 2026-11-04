import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { ResearchService } from '../src/services/research/service';
import { bibliography, parseBibtex } from '../src/services/research/bibtex';
import { arxivRecords, retrieve, zoteroRecords } from '../src/services/research/providers';
const bib =
  '@article{old, title={A {Nested} Title}, author={Author}, year=2024, doi={10.1/OLD}, unknown={keep {all} fields}}';
const source =
  '\\documentclass{article}\n\\begin{document}\nClaim.\n\\bibliography{refs}\n\\end{document}\n';
const atom =
  '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.12345v2</id><title>A &amp; B</title><author><name>Jane Doe</name></author><published>2024-01-01</published><summary>Evidence &lt;test&gt;</summary></entry></feed>';
let dir = '',
  store: MetadataStore | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  store?.close();
  store = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
});
async function setup() {
  dir = await mkdtemp(join(tmpdir(), 'loom-references-'));
  const root = join(dir, 'paper');
  await mkdir(root);
  await writeFile(join(root, 'main.tex'), source);
  await writeFile(join(root, 'refs.bib'), bib);
  store = new MetadataStore(join(dir, 'data'));
  const projects = new ProjectService(store);
  await projects.open(root);
  return { projects, research: new ResearchService(projects), root, id: projects.snapshot().id };
}
function citation(id: string) {
  return {
    type: 'cite' as const,
    projectId: id,
    sourcePath: 'main.tex',
    sourceText: source,
    offset: source.indexOf('Claim.') + 6,
    bibPath: 'refs.bib',
    bibText: bib,
    record: arxivRecords(atom).records[0],
    key: 'Doe2024',
    command: 'cite' as const,
  };
}
describe('bibliography and evidence', () => {
  it('preserves raw fields, comments, braces, string macros and concatenation', () => {
    const text =
      '% @invalid{comment}\n@string{prefix="Scientific"}\n@book(key,title=prefix # { {Work}},author="An {Author}",year=2025,odd={a \\} b})';
    const result = parseBibtex(text);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].fields.title).toBe('Scientific {Work}');
    expect(result.entries[0].raw).toContain('odd={a \\} b}');
  });
  it('reports missing, duplicate, incomplete and informational unused entries', () => {
    const result = bibliography([
      {
        path: 'a.bib',
        text: bib + '\n' + bib.replace('old,', 'other,') + '\n@misc{old,title={X}}',
      },
      { path: 'main.tex', text: '\\cite{missing,other}' },
    ]);
    expect(result.warnings).toContain('Missing bibliography key: missing');
    expect(result.records[0].issues).toContain('Duplicate citation key');
    expect(result.records[0].issues).toContain('Duplicate identifier');
    expect(result.records[0].issues).toContain('Unused (informational)');
    expect(result.records[2].issues.join(' ')).toContain('Incomplete');
  });
  it('rejects malformed entries rather than silently rewriting them', () => {
    expect(parseBibtex('@misc{broken, title={unclosed}').errors).toHaveLength(1);
  });
  it('reads arXiv provenance, decoded abstract and portable BibTeX', () => {
    const r = arxivRecords(atom).records[0];
    expect(r.title).toBe('A & B');
    expect(r.abstract).toBe('Evidence <test>');
    expect(r.url).toBe('https://arxiv.org/abs/2401.12345v2');
    expect(parseBibtex(r.bibtex).entries[0].fields.eprint).toBe('2401.12345v2');
    expect(arxivRecords('<feed></feed>').records).toEqual([]);
    expect(arxivRecords(atom.replace('2401.12345v2', 'error')).warnings).toHaveLength(1);
  });
  it('imports Zotero exported unknown fields rather than synthesizing a different entry', () => {
    const result = zoteroRecords([
      {
        key: 'ABC',
        data: { title: 'Work', date: '2024', creators: [{ name: 'Team' }] },
        bibtex: bib,
      },
    ]);
    expect(result.records[0].bibtex).toBe(bib);
    expect(result.records[0].authors).toBe('Team');
    expect(zoteroRecords([{ data: { title: 'Incomplete' } }]).warnings).toHaveLength(1);
  });
  it('uses bounded GET requests and reports rate limits, partial feeds and failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(atom));
    await retrieve('arxiv', 'test claim', new AbortController().signal, fetcher);
    expect(fetcher.mock.calls[0][0].hostname).toBe('export.arxiv.org');
    fetcher.mockResolvedValue(new Response('', { status: 429 }));
    await expect(retrieve('arxiv', 'x', new AbortController().signal, fetcher)).rejects.toThrow(
      'rate limited',
    );
    fetcher.mockRejectedValue(new Error('offline'));
    await expect(retrieve('zotero', 'x', new AbortController().signal, fetcher)).rejects.toThrow(
      'Open Zotero',
    );
  });
});
describe('grouped citation persistence', () => {
  it('appends only one entry, preserves existing bytes and reuses repeated imports', async () => {
    const { research, root, id } = await setup();
    const first = await research.command(citation(id));
    expect(first.message).toContain('Imported');
    const bibAfter = await readFile(join(root, 'refs.bib'), 'utf8'),
      texAfter = await readFile(join(root, 'main.tex'), 'utf8');
    expect(bibAfter.startsWith(bib)).toBe(true);
    expect(texAfter).toContain('Claim.\\cite{Doe2024}');
    const second = await research.command({
      ...citation(id),
      sourceText: texAfter,
      bibText: bibAfter,
      offset: texAfter.indexOf('Claim.'),
    });
    expect(second.message).toContain('existing');
    expect(await readFile(join(root, 'refs.bib'), 'utf8')).toBe(bibAfter);
  });
  it('rejects stale source, collision and undeclared bibliography without writes', async () => {
    const { research, root, id } = await setup();
    await expect(research.command({ ...citation(id), sourceText: 'stale' })).rejects.toThrow(
      'source changed',
    );
    await expect(research.command({ ...citation(id), key: 'old' })).rejects.toThrow(
      'another record',
    );
    await expect(
      research.command({ ...citation(id), bibPath: 'other.bib', bibText: null }),
    ).rejects.toThrow('does not declare');
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(source);
    expect(await readFile(join(root, 'refs.bib'), 'utf8')).toBe(bib);
  });
  it('retains a durable group across an interrupted second write and finishes idempotently', async () => {
    const { projects, research, root, id } = await setup();
    const original = projects.agentRestore.bind(projects);
    let writes = 0;
    vi.spyOn(projects, 'agentRestore').mockImplementation(async (...args) => {
      if (++writes === 2) throw new Error('Interrupted write');
      return original(...args);
    });
    await expect(research.command(citation(id))).rejects.toThrow('Interrupted');
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(source);
    expect(await readFile(join(root, 'refs.bib'), 'utf8')).toContain('Doe2024');
    vi.restoreAllMocks();
    const fresh = new ResearchService(projects);
    expect(
      (await fresh.command({ type: 'recovery', projectId: id, action: 'inspect' })).recovery,
    ).toBe(true);
    await fresh.command({ type: 'recovery', projectId: id, action: 'finish' });
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('\\cite{Doe2024}');
    expect(
      (await fresh.command({ type: 'recovery', projectId: id, action: 'inspect' })).recovery,
    ).toBe(false);
  });
  it('undoes partial imports and refuses recovery over newer human text', async () => {
    const { projects, research, root, id } = await setup();
    const original = projects.agentRestore.bind(projects);
    let writes = 0;
    vi.spyOn(projects, 'agentRestore').mockImplementation(async (...args) => {
      if (++writes === 2) throw new Error('Interrupted');
      return original(...args);
    });
    await expect(research.command(citation(id))).rejects.toThrow();
    vi.restoreAllMocks();
    await writeFile(join(root, 'main.tex'), source + 'new writing');
    await expect(
      research.command({ type: 'recovery', projectId: id, action: 'undo' }),
    ).rejects.toThrow('newer edits');
    expect(await readFile(join(root, 'refs.bib'), 'utf8')).toContain('Doe2024');
    await writeFile(join(root, 'main.tex'), source);
    await research.command({ type: 'recovery', projectId: id, action: 'undo' });
    expect(await readFile(join(root, 'refs.bib'), 'utf8')).toBe(bib);
  });
  it('blocks citation writes while an agent is active', async () => {
    const { projects, id } = await setup();
    await expect(new ResearchService(projects, () => true).command(citation(id))).rejects.toThrow(
      'Stop the agent',
    );
  });
});
