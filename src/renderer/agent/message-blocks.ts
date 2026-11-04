export type MessageBlock = {
  kind: 'paragraph' | 'code' | 'heading' | 'quote' | 'list';
  text: string;
  language?: string;
  ordered?: boolean;
};
/** Plain text only: raw model HTML is never executed or injected. */
export function messageBlocks(text: string): MessageBlock[] {
  const lines = text.split('\n'),
    blocks: MessageBlock[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', text: body.join('\n'), language: fence[2].trim().slice(0, 40) });
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({ kind: 'heading', text: line.replace(/^#{1,6}\s+/, '') });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }
    if (/^\s*(?:[-*+] |\d+[.)] )/.test(line)) {
      const body: string[] = [],
        ordered = /^\s*\d/.test(line);
      while (i < lines.length && /^\s*(?:[-*+] |\d+[.)] )/.test(lines[i]))
        body.push(lines[i++].replace(/^\s*(?:[-*+] |\d+[.)] )/, ''));
      blocks.push({ kind: 'list', text: body.join('\n'), ordered });
      continue;
    }
    const body = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(?:`{3,}|~{3,}|#{1,6}\s|>\s?|[-*+] |\d+[.)] )/.test(lines[i])
    )
      body.push(lines[i++]);
    blocks.push({ kind: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}
