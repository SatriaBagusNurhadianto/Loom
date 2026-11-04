// Test-only workload shaping. The release file belongs to the disposable build output,
// never to the input fixture. TeX searches its -output-directory for input files too.
export const compileGateReady = 'phase8-gate-ready.txt';
export const compileGateRelease = 'phase8-gate-release.tex';

export function withCompileGate(source: string): string {
  const start = '\\begin{document}';
  if (source.split(start).length !== 2)
    throw new Error('Phase 8 compile gate requires exactly one document start.');
  return source.replace(
    start,
    String.raw`${start}
% Test-only synchronization: real TeX typesetting work until the typing window ends.
\newread\phaseEightRelease
\newwrite\phaseEightReady
\immediate\openout\phaseEightReady=phase8-gate-ready.txt
\immediate\write\phaseEightReady{ready}
\immediate\closeout\phaseEightReady
\newif\ifphaseEightWaiting
\phaseEightWaitingtrue
\loop
  \setbox0=\vbox{\hsize=240pt Synthetic Phase 8 synchronized typesetting workload.
    The native compiler stays busy while editor responsiveness is sampled.\par}
  \openin\phaseEightRelease=phase8-gate-release.tex
  \ifeof\phaseEightRelease\else\phaseEightWaitingfalse\fi
  \closein\phaseEightRelease
\ifphaseEightWaiting\repeat
`,
  );
}
