import { Zip, ZipDeflate } from 'fflate';
import { dirname, join } from 'node:path/posix';
import { relativePath } from '../../contracts/project';
import type { SourceArchive, SourcePreflight } from '../../contracts/git';

const expandedLimit = 128 * 1024 * 1024;
const compressedLimit = 64 * 1024 * 1024;
const generated =
  /\.(?:aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex\.gz|blg|bcf|run\.xml|nav|snm|vrb)$/i;
const excludedPattern =
  /(^|\/)(?:\.git|\.loom|\.codex|\.opencode|userData|recovery|conversations|metadata\.sqlite|node_modules|\.cache|coverage|release|artifacts|out|dist|\.turbo|\.ssh|credentials|secrets)(\/|$)|(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519)$/i;
const hasUnsafeName = (path: string) => !relativePath.safeParse(path).success;

function selection(files: Map<string, Buffer>) {
  const included: string[] = [];
  const excluded: SourcePreflight['excluded'] = [];
  let total = 0;
  const portableNames = new Map<string, { part: string; path: string }>();
  for (const [path, bytes] of files) {
    if (hasUnsafeName(path))
      throw new Error(
        'A project path is unsafe for a portable archive. Resolve it in the project before exporting.',
      );
    if (excludedPattern.test(path)) {
      excluded.push({ path, reason: 'Private state or generated folder' });
      continue;
    }
    if (generated.test(path)) {
      excluded.push({ path, reason: 'Disposable compiler output' });
      continue;
    }
    const segments = path.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const part = segments.slice(0, i).join('/');
      const portable = part.normalize('NFC').toLowerCase();
      const prior = portableNames.get(portable);
      if (prior && prior.part !== part)
        throw new Error(
          `Source export paths collide on common filesystems: ${prior.path} and ${path}. Rename one before exporting.`,
        );
      portableNames.set(portable, { part, path });
    }
    total += bytes.byteLength;
    if (total > expandedLimit)
      throw new Error('Source export exceeds the 128 MiB expanded archive limit.');
    included.push(path);
  }
  if (!included.length) throw new Error('There are no portable project files to export.');
  if (included.length > 2000) throw new Error('Source export supports at most 2,000 files.');
  return { included, excluded };
}

function preflightWarnings(files: Map<string, Buffer>, included: string[]) {
  const sources = new Map<string, string>();
  for (const path of included) {
    if (!/\.(?:tex|bib)$/i.test(path)) continue;
    const bytes = files.get(path);
    if (!bytes || bytes.byteLength > 8 * 1024 * 1024 || bytes.includes(0)) continue;
    sources.set(path, bytes.toString('utf8'));
  }
  const latex = [...sources].filter(([path]) => /\.tex$/i.test(path));
  const allLatex = latex.map(([, source]) => source).join('\n');
  const labels = new Set(
    [...allLatex.matchAll(/\\label\s*\{\s*([^{}]+?)\s*\}/g)].map((m) => m[1]!),
  );
  const references = [
    ...allLatex.matchAll(/\\(?:ref|eqref|pageref|autoref|cref|Cref)\s*\{\s*([^{}]+?)\s*\}/g),
  ].map((m) => m[1]!);
  const missingLabels = [...new Set(references.filter((key) => !labels.has(key)))];
  const bibKeys = new Set<string>();
  for (const [path, source] of sources)
    if (/\.bib$/i.test(path))
      for (const match of source.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)) bibKeys.add(match[1]!);
  const citations = [
    ...allLatex.matchAll(/\\cite\w*\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]+)\}/g),
  ].flatMap((m) => m[1]!.split(',').map((key) => key.trim()));
  const missingCitations = [...new Set(citations.filter((key) => key && !bibKeys.has(key)))];
  const includedSet = new Set(included);
  const missingBibliography = new Set<string>();
  for (const [, source] of latex) {
    for (const match of source.matchAll(/\\(?:bibliography|addbibresource)\s*\{([^{}]+)\}/g)) {
      for (const item of match[1]!.split(',').map((entry) => entry.trim())) {
        if (/[\\$#]/.test(item)) continue;
        const path = item.toLowerCase().endsWith('.bib') ? item : `${item}.bib`;
        if (!includedSet.has(path)) missingBibliography.add(item);
      }
    }
  }
  const graphicsDirs: string[] = [];
  for (const match of allLatex.matchAll(/\\graphicspath\s*\{((?:\s*\{[^{}]*\}\s*)+)\}/g))
    for (const dir of match[1]!.matchAll(/\{([^{}]*)\}/g))
      if (!/[\\$#]/.test(dir[1]!)) graphicsDirs.push(dir[1]!);
  const missingAssets = new Set<string>();
  const dynamicAsset = { value: false };
  for (const [sourcePath, source] of latex) {
    for (const match of source.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)) {
      const raw = match[1]!.trim();
      if (/[\\$#]/.test(raw)) {
        dynamicAsset.value = true;
        continue;
      }
      const bases = [join(dirname(sourcePath), raw), ...graphicsDirs.map((dir) => join(dir, raw))];
      const candidates = bases.flatMap((base) =>
        /\.[A-Za-z0-9]+$/.test(base)
          ? [base]
          : ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg'].map(
              (extension) => `${base}${extension}`,
            ),
      );
      if (!candidates.some((candidate) => includedSet.has(candidate))) missingAssets.add(raw);
    }
    for (const match of source.matchAll(/\\(?:input|include)\s*\{([^{}]+)\}/g)) {
      const raw = match[1]!.trim();
      if (/[\\$#]/.test(raw)) {
        dynamicAsset.value = true;
        continue;
      }
      const base = join(dirname(sourcePath), raw);
      if (!includedSet.has(base) && !includedSet.has(`${base}.tex`)) missingAssets.add(raw);
    }
  }
  const warnings: string[] = [
    'Static preflight supports literal LaTeX references and BibTeX keys; custom macros and dynamic dependencies may be missed.',
    'This check cannot prove that a publisher will accept the submission or that the science is correct.',
    'Review the included file list for secrets: filename rules do not detect every credential or private datum.',
  ];
  if (missingLabels.length)
    warnings.push(
      `Unresolved labels in supported literal syntax: ${missingLabels.slice(0, 20).join(', ')}${missingLabels.length > 20 ? '…' : ''}`,
    );
  if (missingCitations.length)
    warnings.push(
      `Unresolved citation keys in supported literal syntax: ${missingCitations.slice(0, 20).join(', ')}${missingCitations.length > 20 ? '…' : ''}`,
    );
  if (missingAssets.size)
    warnings.push(
      `Missing local figure or included source files in supported literal syntax: ${[...missingAssets].slice(0, 20).join(', ')}${missingAssets.size > 20 ? '…' : ''}`,
    );
  if (missingBibliography.size)
    warnings.push(
      `Missing bibliography files in supported literal syntax: ${[...missingBibliography].slice(0, 20).join(', ')}${missingBibliography.size > 20 ? '…' : ''}`,
    );
  if (dynamicAsset.value)
    warnings.push(
      'Some figure or source dependencies use dynamic syntax and could not be checked.',
    );
  if (!included.some((path) => /\.tex$/i.test(path)))
    warnings.push('No .tex source file was found in the exported project.');
  return warnings.map((warning) => (warning.length <= 500 ? warning : `${warning.slice(0, 496)}…`));
}

export function sourcePreflight(files: Map<string, Buffer>, revision: string): SourcePreflight {
  const { included, excluded } = selection(files);
  return {
    kind: 'preflight',
    revision,
    included,
    excluded,
    warnings: preflightWarnings(files, included),
  };
}

export function sourceArchive(files: Map<string, Buffer>, revision: string): SourceArchive {
  const report = sourcePreflight(files, revision);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    size += chunk.byteLength;
    if (size > compressedLimit)
      throw new Error('Source archive exceeds the 64 MiB compressed export limit.');
    chunks.push(chunk);
  });
  for (const path of report.included) {
    const entry = new ZipDeflate(path, { level: 6 });
    zip.add(entry);
    entry.push(files.get(path)!, true);
  }
  zip.end();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'archive', revision, included: report.included, excluded: report.excluded, bytes };
}
