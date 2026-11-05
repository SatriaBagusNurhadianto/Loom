import { expect, it } from 'vitest';
import { diagnosticContext } from '../src/services/agents/diagnostic-context';
import { defaultBuildSettings, type BuildState } from '../src/contracts/latex';
import type { BuildInput } from '../src/services/latex/builds';
const context = {
  snapshot: { id: 'paper', rootId: 'main', sourceRevision: 'current' },
  files: [
    {
      id: 'main',
      path: 'main.tex',
      text: '\\documentclass{article}\n\\begin{document}\n\\UndefinedCommand\n\\end{document}',
    },
    { id: 'env', path: '.env', text: 'CREDENTIAL=do-not-include' },
  ],
} as BuildInput;
const state = {
  projectId: 'paper',
  queued: false,
  settings: defaultBuildSettings,
  tools: [],
  successful: null,
  current: {
    id: 'build-1',
    projectId: 'paper',
    startedAt: '2026-11-05T00:00:00Z',
    finishedAt: '2026-11-05T00:00:01Z',
    hasPdf: false,
    hasSynctex: false,
    tools: [],
    revision: 'current',
    root: 'main.tex',
    status: 'failed',
    settings: defaultBuildSettings,
    log: 'Package epstopdf Warning: Shell escape feature is not enabled.\n./main.tex:3: Undefined control sequence.',
    diagnostics: [
      {
        path: null,
        line: 1,
        column: 0,
        severity: 'warning',
        message: 'Shell escape feature is not enabled.',
      },
      {
        path: 'main.tex',
        line: 3,
        column: 0,
        severity: 'error',
        message: 'Undefined control sequence.',
      },
    ],
  },
} as BuildState;
it('automatically supplies real errors, warnings, locations and current source with stale provenance', () => {
  const result = diagnosticContext(context, state, {
    activeFile: 'main.tex',
    errors: [{ source: 'pdf', message: 'PDF export failed.' }],
    editorDiagnostics: { revision: 'current', items: [] },
  });
  expect(result.build).toMatchObject({
    id: 'build-1',
    matchesSavedSourceAndSettings: true,
    diagnostics: [{ severity: 'error', path: 'main.tex', line: 3 }, { severity: 'warning' }],
  });
  expect(result.build?.logExcerpt).toContain('Undefined control sequence.');
  expect(
    result.sourceExcerpts[0].lines.some((line) => line.text.includes('UndefinedCommand')),
  ).toBe(true);
  expect(result.observedWorkspaceErrors[0].message).toBe('PDF export failed.');
  expect(result.editorDiagnostics?.matchesSavedRevision).toBe(true);
  const changed = { ...context, snapshot: { ...context.snapshot, sourceRevision: 'newer' } };
  expect(diagnosticContext(changed, state).build?.matchesSavedSourceAndSettings).toBe(false);
  expect(
    diagnosticContext(context, {
      ...state,
      settings: { ...defaultBuildSettings, engine: 'xelatex' },
    }).build?.matchesSavedSourceAndSettings,
  ).toBe(false);
});
it('bounds logs and snippets, redacts credentials, excludes unrelated or outside-project files', () => {
  const noisy = {
    ...state,
    current: {
      ...state.current!,
      log:
        'OPENAI_API_KEY="synthetic-secret"\n' +
        'x'.repeat(20000) +
        '\nhttps://user:pass@example.invalid Bearer private-token',
      diagnostics: [
        ...state.current!.diagnostics,
        {
          path: '.env',
          line: 1,
          column: 0,
          severity: 'error' as const,
          message: 'password: "synthetic-password"',
        },
        {
          path: '../../outside.tex',
          line: 1,
          column: 0,
          severity: 'error' as const,
          message: 'File not found.',
        },
      ],
    },
  };
  const result = diagnosticContext(context, noisy);
  const text = JSON.stringify(result);
  for (const secret of [
    'synthetic-secret',
    'synthetic-password',
    'private-token',
    'user:pass',
    'do-not-include',
    '../../outside.tex',
  ])
    expect(text).not.toContain(secret);
  expect(result.build?.logTruncated).toBe(true);
  expect(result.build!.logExcerpt.length).toBeLessThan(12100);
  expect(result.sourceExcerpts.every((excerpt) => excerpt.path === 'main.tex')).toBe(true);
  expect(diagnosticContext(context, { ...state, projectId: 'another-paper' }).build).toBeNull();
  expect(diagnosticContext(context, null).buildStatusAvailable).toBe(false);
});
