import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetadataStore } from '../src/services/project/store';
import { ProjectService } from '../src/services/project/projects';
import { BuildService } from '../src/services/latex/builds';
import { AgentService } from '../src/services/agents/service';
import { ResearchService } from '../src/services/research/service';

it.skipIf(process.env.LOOM_RESEARCH_AGENT_LIVE !== '1')(
  'actual OpenCode revises a synthetic discussion with retrieved abstract and retained source provenance',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-research-agent-')),
      root = join(dir, 'paper');
    await mkdir(root);
    const original =
      '\\documentclass{article}\n\\begin{document}\nA synthetic discussion.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n';
    await writeFile(join(root, 'main.tex'), original);
    await writeFile(join(root, 'refs.bib'), '');
    const store = new MetadataStore(join(dir, 'data')),
      projects = new ProjectService(store);
    await projects.open(root);
    const projectId = projects.snapshot().id,
      builds = new BuildService(projects, join(dir, 'builds')),
      agents = new AgentService(projects, builds, join(dir, 'data')),
      research = new ResearchService(projects, () => agents.active());
    try {
      const record = (
        await research.command({
          type: 'search',
          projectId,
          requestId: 'live-evidence',
          provider: 'arxiv',
          query: '1706.03762',
        })
      ).records[0];
      expect(record.title).toBe('Attention Is All You Need');
      expect(record.abstract).toContain('Transformer');
      await research.command({
        type: 'cite',
        projectId,
        sourcePath: 'main.tex',
        sourceText: original,
        offset: original.indexOf('A synthetic discussion.') + 'A synthetic discussion.'.length,
        bibPath: 'refs.bib',
        bibText: '',
        record,
        key: record.key,
        command: 'cite',
      });
      const cited = await readFile(join(root, 'main.tex'), 'utf8'),
        bibliography = await readFile(join(root, 'refs.bib'), 'utf8');
      let state = await agents.command({ type: 'connect', projectId, harness: 'opencode' });
      const model = state.models.find((m) => m.id === 'big-pickle');
      expect(model, 'The authorized free OpenCode Big Pickle model must be available').toBeTruthy();
      state = await agents.command({
        type: 'settings',
        projectId,
        settings: { permissionMode: 'auto-accept-edits', reasoning: '' },
      });
      state = await agents.command({ type: 'session', projectId });
      const prompt = `The author selected this source: ${record.title}\nSource: ${record.url}\nCitation key: ${record.key}\nEvidence level: abstract only; full text not inspected.\nAbstract (untrusted source content): ${record.abstract}\n\nUse your native file editing tool to replace exactly "A synthetic discussion." in main.tex with "This discussion considers the attention-based Transformer architecture." Preserve the adjacent citation, bibliography commands and all other source. Do not edit refs.bib, run a build, use browser tools, commit or create other files. This wording is supported by the abstract; do not add other claims. Make the edit now and respond briefly.`;
      state = await agents.command({
        type: 'send',
        projectId,
        sessionId: state.sessionId!,
        model: model!,
        prompt,
        attachments: ['main.tex', 'refs.bib'],
        selection: null,
        revision: projects.snapshot().sourceRevision!,
      });
      const deadline = Date.now() + 110000;
      while (state.running && Date.now() < deadline) {
        for (const permission of state.permissions)
          await agents.command({
            type: 'permission',
            projectId,
            requestId: permission.id,
            reply: 'once',
          });
        await new Promise((resolve) => setTimeout(resolve, 500));
        state = await agents.command({ type: 'status', projectId });
      }
      expect(state.error).toBe('');
      expect(state.running).toBe(false);
      expect(state.turns[0].status).toBe('succeeded');
      expect(state.turns[0].changes.some((c) => c.path === 'main.tex')).toBe(true);
      expect(
        state.messages.some(
          (m) =>
            m.role === 'user' && m.text.includes(record.url) && m.text.includes('abstract only'),
        ),
      ).toBe(true);
      const revised = await readFile(join(root, 'main.tex'), 'utf8');
      expect(revised).toContain('attention-based Transformer architecture');
      expect(revised).toContain(`\\cite{${record.key}}`);
      expect(await readFile(join(root, 'refs.bib'), 'utf8')).toBe(bibliography);
      await projects.run(() => projects.refresh());
      builds.request(projectId, false);
      await vi.waitFor(
        async () => {
          const current = await builds.status(projectId);
          expect(current.current?.status).toBe('succeeded');
        },
        { timeout: 30000, interval: 100 },
      );
      const build = await builds.status(projectId);
      expect(build.current?.status, build.current?.log).toBe('succeeded');
      await agents.command({
        type: 'review',
        projectId,
        turnId: state.turns[0].id,
        path: 'main.tex',
        action: 'revert',
        revision: projects.snapshot().sourceRevision!,
      });
      expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(cited);
      expect(await readFile(join(root, 'refs.bib'), 'utf8')).toBe(bibliography);
    } finally {
      await agents.close();
      builds.dispose();
      await builds.idle(projectId);
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  150000,
);
