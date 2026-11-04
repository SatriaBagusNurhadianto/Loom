import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import type {
  LatexCommand,
  LatexDiagnostic,
  LatexValue,
  SourceLocation,
  StructureItem,
} from '../../contracts/latex';
import type { BuildInput } from './builds';
import { findLatexExecutable, latexEnvironment, spawnOwnedTool } from './tools';
import { relativePath } from '../../contracts/project';
const position = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});
const range = z.object({ start: position, end: position });
const configuration = {
  build: { onSave: false },
  chktex: { onOpenAndSave: false, onEdit: false },
  diagnosticsDelay: 300,
  completion: { matcher: 'prefix' },
};
export class TexlabClient {
  private child?: ChildProcessWithoutNullStreams;
  private input = Buffer.alloc(0);
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private documents = new Map<string, { text: string; version: number }>();
  private diagnostics = new Map<string, LatexDiagnostic[]>();
  private starting?: Promise<void>;
  private context?: BuildInput;
  private generation = 0;
  private failure = '';
  private write(message: unknown) {
    if (!this.child?.stdin.writable) throw new Error('TexLab is disconnected. Retry to reconnect.');
    const bytes = Buffer.from(JSON.stringify(message));
    this.child.stdin.write(`Content-Length: ${bytes.length}\r\n\r\n`);
    this.child.stdin.write(bytes);
  }
  private notify(method: string, params: unknown) {
    this.write({ jsonrpc: '2.0', method, params });
  }
  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.sequence;
    if (this.pending.size >= 16) return Promise.reject(new Error('TexLab is busy. Retry.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('TexLab request timed out. Retry.'));
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  private path(uri: string): string | null {
    try {
      if (!uri.startsWith('file:') || !this.context) return null;
      const path = relative(this.context.root, fileURLToPath(uri)).split(sep).join('/');
      return relativePath.safeParse(path).success &&
        this.context.files.some((f) => f.path === path && f.diskKind === 'text')
        ? path
        : null;
    } catch {
      return null;
    }
  }
  private message(raw: unknown) {
    const parsed = z
      .object({
        id: z.union([z.number(), z.string()]).optional(),
        method: z.string().optional(),
        params: z.unknown().optional(),
        result: z.unknown().optional(),
        error: z.unknown().optional(),
      })
      .safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.method && message.id !== undefined) {
      const params = message.params as { items?: { section?: string }[] } | undefined;
      const result =
        message.method === 'workspace/configuration'
          ? (params?.items ?? []).map((item) =>
              item.section === 'texlab'
                ? configuration
                : item.section?.startsWith('texlab.')
                  ? item.section
                      .slice(7)
                      .split('.')
                      .reduce<unknown>(
                        (value, key) =>
                          value && typeof value === 'object'
                            ? (value as Record<string, unknown>)[key]
                            : null,
                        configuration,
                      )
                  : null,
            )
          : null;
      this.write({ jsonrpc: '2.0', id: message.id, result });
      return;
    }
    if (message.method === 'textDocument/publishDiagnostics') {
      const data = z
        .object({
          uri: z.string(),
          version: z.number().optional(),
          diagnostics: z
            .array(z.object({ range, message: z.string(), severity: z.number().optional() }))
            .max(10000),
        })
        .safeParse(message.params);
      if (!data.success) return;
      const path = this.path(data.data.uri);
      if (!path) return;
      const doc = this.documents.get(data.data.uri);
      if (data.data.version !== undefined && doc && data.data.version !== doc.version) return;
      this.diagnostics.set(
        path,
        data.data.diagnostics.slice(0, 500).map((item) => ({
          path,
          line: item.range.start.line + 1,
          column: item.range.start.character,
          severity: item.severity === 1 ? 'error' : item.severity === 2 ? 'warning' : 'info',
          message: (
            (data.data.version === undefined
              ? 'Unversioned TexLab diagnostic — confirm against current source: '
              : '') + item.message
          ).slice(0, 3000),
        })),
      );
      let diagnosticCount = [...this.diagnostics.values()].reduce(
        (total, items) => total + items.length,
        0,
      );
      for (const [key, items] of this.diagnostics) {
        if (diagnosticCount <= 500) break;
        if (key !== path) {
          this.diagnostics.delete(key);
          diagnosticCount -= items.length;
        }
      }
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error('TexLab could not complete this request.'));
      else pending.resolve(message.result);
    }
  }
  private receive(chunk: Buffer) {
    this.input = Buffer.concat([this.input, chunk]);
    if (this.input.length > 16 * 1024 * 1024) {
      this.dispose();
      return;
    }
    while (true) {
      const end = this.input.indexOf('\r\n\r\n');
      if (end < 0) break;
      const header = this.input.subarray(0, end).toString('ascii');
      const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > 16 * 1024 * 1024) {
        this.dispose();
        return;
      }
      if (this.input.length < end + 4 + length) break;
      const body = this.input.subarray(end + 4, end + 4 + length);
      this.input = this.input.subarray(end + 4 + length);
      try {
        this.message(JSON.parse(body.toString('utf8')));
      } catch {
        this.dispose();
        return;
      }
    }
  }
  private async start(context: BuildInput) {
    if (this.context?.snapshot.id !== context.snapshot.id) this.dispose();
    this.context = context;
    if (this.starting) return this.starting;
    if (this.child) return;
    const generation = this.generation;
    this.starting = (async () => {
      const executable = await findLatexExecutable('texlab');
      if (!executable)
        throw new Error(
          'TexLab is not installed. Install texlab and retry. Source editing remains available.',
        );
      if (generation !== this.generation)
        throw new Error('Project changed while connecting TexLab.');
      const child = spawnOwnedTool(executable, [], context.root, latexEnvironment());
      this.child = child;
      this.failure = '';
      child.stdout.on('data', (chunk: Buffer) => {
        if (generation === this.generation) this.receive(chunk);
      });
      child.stderr.on('data', () => {}); // Never copy manuscript-bearing server logs into app diagnostics.
      child.once('error', () => {
        if (this.child === child) this.dispose();
      });
      child.once('exit', () => {
        if (this.child === child) this.dispose();
      });
      await this.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(context.root).href,
        capabilities: {
          workspace: { configuration: true },
          textDocument: {
            completion: { completionItem: { snippetSupport: true } },
            publishDiagnostics: { versionSupport: true },
          },
        },
        workspaceFolders: [{ uri: pathToFileURL(context.root).href, name: context.snapshot.name }],
      });
      this.notify('initialized', {});
      this.notify('workspace/didChangeConfiguration', { settings: { texlab: configuration } });
      for (const file of context.files) {
        if (
          file.text === null ||
          file.diskKind !== 'text' ||
          !/\.(?:tex|bib|sty|cls)$/.test(file.path)
        )
          continue;
        const uri = pathToFileURL(join(context.root, file.path)).href;
        this.documents.set(uri, { text: file.text, version: 1 });
        this.notify('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: file.path.endsWith('.bib') ? 'bibtex' : 'latex',
            version: 1,
            text: file.text,
          },
        });
      }
    })()
      .catch((e: unknown) => {
        this.failure = e instanceof Error ? e.message : 'TexLab failed to connect.';
        this.dispose();
        throw new Error(this.failure);
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }
  async execute(
    context: BuildInput,
    command: Extract<LatexCommand, { type: 'language' }>,
  ): Promise<LatexValue> {
    const empty = {
      kind: 'language' as const,
      version: command.version,
      diagnostics: [],
      completions: [],
      locations: [],
    };
    try {
      await this.start(context);
      const file = context.files.find(
        (f) => f.id === command.fileId && f.text !== null && f.diskKind === 'text',
      );
      if (!file) throw new Error('Select a text source file.');
      const present = new Set<string>();
      for (const source of context.files) {
        if (
          source.text === null ||
          source.diskKind !== 'text' ||
          !/\.(?:tex|bib|sty|cls)$/.test(source.path)
        )
          continue;
        const sourceUri = pathToFileURL(join(context.root, source.path)).href;
        present.add(sourceUri);
        if (source.id === file.id) continue;
        const existing = this.documents.get(sourceUri);
        if (!existing) {
          this.documents.set(sourceUri, { text: source.text, version: 1 });
          this.notify('textDocument/didOpen', {
            textDocument: {
              uri: sourceUri,
              languageId: source.path.endsWith('.bib') ? 'bibtex' : 'latex',
              version: 1,
              text: source.text,
            },
          });
        } else if (existing.text !== source.text) {
          existing.text = source.text;
          existing.version++;
          this.diagnostics.delete(source.path);
          this.notify('textDocument/didChange', {
            textDocument: { uri: sourceUri, version: existing.version },
            contentChanges: [{ text: source.text }],
          });
        }
      }
      for (const known of this.documents.keys())
        if (!present.has(known)) {
          this.notify('textDocument/didClose', { textDocument: { uri: known } });
          this.documents.delete(known);
        }
      for (const path of this.diagnostics.keys())
        if (!context.files.some((f) => f.path === path)) this.diagnostics.delete(path);
      const uri = pathToFileURL(join(context.root, file.path)).href;
      const old = this.documents.get(uri);
      if (!old) {
        this.documents.set(uri, { text: command.text, version: 1 });
        this.notify('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: file.path.endsWith('.bib') ? 'bibtex' : 'latex',
            version: 1,
            text: command.text,
          },
        });
      } else if (old.text !== command.text) {
        old.text = command.text;
        old.version++;
        this.diagnostics.delete(file.path);
        this.notify('textDocument/didChange', {
          textDocument: { uri, version: old.version },
          contentChanges: [{ text: command.text }],
        });
      }
      if (command.action === 'update') await new Promise((resolve) => setTimeout(resolve, 350));
      const value: Extract<LatexValue, { kind: 'language' }> = {
        ...empty,
        available: true,
        message: 'TexLab connected',
        diagnostics: [...this.diagnostics.values()].flat().slice(0, 500),
      };
      if (command.action === 'completion') {
        const result = await this.request('textDocument/completion', {
          textDocument: { uri },
          position: command.position,
        });
        const items = Array.isArray(result)
          ? result
          : ((result as { items?: unknown[] } | null)?.items ?? []);
        for (const raw of items.slice(0, 200)) {
          const item = z
            .object({
              label: z.string(),
              insertText: z.string().optional(),
              detail: z.string().optional(),
              insertTextFormat: z.number().optional(),
              textEdit: z.object({ newText: z.string(), range }).optional(),
            })
            .safeParse(raw);
          if (!item.success) continue;
          const c = item.data;
          let text = c.textEdit?.newText ?? c.insertText ?? c.label;
          if (c.insertTextFormat === 2)
            text = text.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{?\d+\}?/g, '');
          value.completions.push({
            label: c.label.slice(0, 1000),
            text: text.slice(0, 20000),
            detail: (c.detail ?? '').slice(0, 2000),
            from: c.textEdit?.range.start ?? null,
            to: c.textEdit?.range.end ?? null,
          });
        }
      } else if (command.action === 'definition') {
        const result = await this.request('textDocument/definition', {
          textDocument: { uri },
          position: command.position,
        });
        for (const raw of (Array.isArray(result) ? result : result ? [result] : []).slice(0, 50)) {
          const item = z
            .union([
              z.object({ uri: z.string(), range }),
              z.object({ targetUri: z.string(), targetSelectionRange: range }),
            ])
            .safeParse(raw);
          if (!item.success) continue;
          const target = item.data;
          const path = this.path('uri' in target ? target.uri : target.targetUri);
          const start = 'range' in target ? target.range.start : target.targetSelectionRange.start;
          if (path) value.locations.push({ path, line: start.line + 1, column: start.character });
        }
      }
      return value;
    } catch (e) {
      return {
        ...empty,
        available: false,
        message: e instanceof Error ? e.message.slice(0, 1000) : 'TexLab unavailable.',
      };
    }
  }
  dispose() {
    ++this.generation;
    const child = this.child;
    this.child = undefined;
    child?.stdin.end();
    child?.kill();
    this.input = Buffer.alloc(0);
    this.context = undefined;
    this.documents.clear();
    this.diagnostics.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('TexLab disconnected. Retry.'));
    }
    this.pending.clear();
  }
}
export function projectStructure(context: BuildInput): StructureItem[] {
  const result: StructureItem[] = [];
  for (const file of context.files) {
    if (file.text === null || file.diskKind !== 'text' || !/\.(?:tex|bib|sty|cls)$/.test(file.path))
      continue;
    // Deliberately limited to literal constructs; TexLab owns language intelligence.
    const text = file.text.replace(/(?<!\\)%[^\n]*/g, (comment) => ' '.repeat(comment.length));
    const patterns: [StructureItem['kind'], RegExp][] = [
      ['section', /\\(?:part|chapter|(?:sub)*section)\*?(?:\[[^\]]*\])?\{([^}]*)\}/g],
      ['label', /\\label\{([^}]*)\}/g],
      ['figure', /\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/g],
      ['citation', /@\w+\s*\{\s*([^,\s]+)\s*,/g],
    ];
    for (const [kind, pattern] of patterns)
      for (const match of text.matchAll(pattern)) {
        const before = text.slice(0, match.index);
        result.push({
          kind,
          title: match[1].slice(0, 1000),
          path: file.path,
          line: before.split('\n').length,
          column: before.length - before.lastIndexOf('\n') - 1,
        });
        if (result.length >= 2000) return result;
      }
  }
  return result;
}
