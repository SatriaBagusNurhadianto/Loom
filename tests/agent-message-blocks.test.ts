import { expect, it } from 'vitest';
import { messageBlocks } from '../src/renderer/agent/message-blocks';
it('preserves fenced LaTeX, diff prefixes and HTML as literal code', () => {
  expect(
    messageBlocks(
      'Updated `main.tex`.\n\n```diff\n- old\n+ \\draw (0,0)--(1,1);\n<script>no()</script>\n```',
    ),
  ).toEqual([
    { kind: 'paragraph', text: 'Updated `main.tex`.' },
    {
      kind: 'code',
      language: 'diff',
      text: '- old\n+ \\draw (0,0)--(1,1);\n<script>no()</script>',
    },
  ]);
});
it('supports unfinished streaming fences, headings, lists and quoted context', () => {
  expect(
    messageBlocks(
      '## Result\n- First\n- Second\n\n> Quoted\n> context\n\n~~~latex\n\\begin{tikzpicture}',
    ),
  ).toEqual([
    { kind: 'heading', text: 'Result' },
    { kind: 'list', text: 'First\nSecond', ordered: false },
    { kind: 'quote', text: 'Quoted\ncontext' },
    { kind: 'code', language: 'latex', text: '\\begin{tikzpicture}' },
  ]);
});
