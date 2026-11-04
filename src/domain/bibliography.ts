import type { Reference } from '../contracts/research';
export type BibEntry = {
  type: string;
  key: string;
  fields: Record<string, string>;
  raw: string;
  start: number;
  end: number;
};
/** Read-only scanner: offsets and raw entries retain comments, macros and unknown fields. */
export function parseBibtex(text: string) {
  const entries: BibEntry[] = [],
    errors: string[] = [];
  const macros: Record<string, string> = {
    jan: 'January',
    feb: 'February',
    mar: 'March',
    apr: 'April',
    may: 'May',
    jun: 'June',
    jul: 'July',
    aug: 'August',
    sep: 'September',
    oct: 'October',
    nov: 'November',
    dec: 'December',
  };
  let i = 0;
  const skip = () => {
    while (i < text.length) {
      if (/\s/.test(text[i])) i++;
      else if (text[i] === '%') {
        while (i < text.length && text[i] !== '\n') i++;
      } else break;
    }
  };
  const value = () => {
    let result = '';
    while (i < text.length) {
      skip();
      const c = text[i];
      let part = '';
      if (c === '{' || c === '"') {
        i++;
        let depth = c === '{' ? 1 : 0;
        while (i < text.length) {
          const ch = text[i++];
          if (ch === '\\' && i < text.length) {
            part += ch + text[i++];
            continue;
          }
          if (ch === '{') depth++;
          if (ch === '}') {
            if (c === '{' && --depth === 0) break;
            if (c === '"') depth--;
          }
          if (ch === '"' && c === '"' && depth === 0) break;
          part += ch;
        }
      } else {
        const start = i;
        while (i < text.length && !/[\s,#})]/.test(text[i])) i++;
        const token = text.slice(start, i);
        part = macros[token.toLowerCase()] ?? token;
      }
      result += part;
      skip();
      if (text[i] !== '#') break;
      i++;
    }
    return result;
  };
  while (i < text.length) {
    skip();
    if (text[i] !== '@') {
      i++;
      continue;
    }
    const start = i++;
    const typeMatch = /^[a-z]+/i.exec(text.slice(i));
    if (!typeMatch) continue;
    const type = typeMatch[0].toLowerCase();
    i += type.length;
    skip();
    const open = text[i++];
    if (open !== '{' && open !== '(') continue;
    const close = open === '{' ? '}' : ')';
    if (type === 'comment' || type === 'preamble') {
      let depth = 1,
        quoted = false;
      while (i < text.length && depth) {
        const c = text[i++];
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '"') quoted = !quoted;
        if (!quoted) {
          if (c === open) depth++;
          if (c === close) depth--;
        }
      }
      continue;
    }
    skip();
    let key = '';
    const fields: Record<string, string> = {};
    if (type !== 'string') {
      const from = i;
      while (i < text.length && text[i] !== ',' && text[i] !== close) i++;
      key = text.slice(from, i).trim();
      if (text[i] === ',') i++;
    }
    let valid = true,
      closed = false;
    while (i < text.length) {
      skip();
      if (text[i] === close) {
        closed = true;
        i++;
        break;
      }
      if (text[i] === ',') {
        i++;
        continue;
      }
      const field = /^[a-z][a-z0-9_-]*/i.exec(text.slice(i));
      if (!field) {
        valid = false;
        break;
      }
      i += field[0].length;
      skip();
      if (text[i++] !== '=') {
        valid = false;
        break;
      }
      fields[field[0].toLowerCase()] = value();
    }
    if (!valid || !closed) {
      errors.push(
        `Unparsed bibliography entry near character ${start + 1}; edit the original file before importing.`,
      );
      while (i < text.length && text[i] !== '@') i++;
      continue;
    }
    if (type === 'string') Object.assign(macros, fields);
    else entries.push({ type, key, fields, raw: text.slice(start, i), start, end: i });
  }
  return { entries, errors };
}
export const normalizeDoi = (doi: string) =>
  doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
export const normalizeArxiv = (id: string) =>
  id
    .trim()
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/\.pdf$/, '')
    .replace(/v\d+$/, '')
    .toLowerCase();
export function identifiers(record: Reference) {
  const entry = parseBibtex(record.bibtex).entries[0];
  return [
    record.doi ? 'doi:' + normalizeDoi(record.doi) : '',
    entry?.fields.eprint &&
    /^(?:arxiv)$/i.test(entry.fields.archiveprefix ?? entry.fields.eprinttype ?? '') &&
    /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(entry.fields.eprint)
      ? 'arxiv:' + normalizeArxiv(entry.fields.eprint)
      : '',
    /arxiv\.org\/abs\//.test(record.url) ? 'arxiv:' + normalizeArxiv(record.url) : '',
  ].filter(Boolean);
}
export const normalizedTitle = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
export const identityMatch = (a: Reference, b: Reference) =>
  (a.provider === 'local' && b.provider === 'local' && a.id === b.id) ||
  identifiers(a).some((id) => identifiers(b).includes(id));
export const sameRecord = (a: Reference, b: Reference) => {
  if (identityMatch(a, b)) return true;
  if (identifiers(a).length && identifiers(b).length) return false;
  return !!normalizedTitle(a.title) && normalizedTitle(a.title) === normalizedTitle(b.title);
};
/** Literal TeX dependency graph, using the same project-root working directory as builds. */
export function manuscriptResources(
  files: Array<{ id: string; path: string; text: string | null }>,
  rootId: string | null,
) {
  const root = files.find((f) => f.id === rootId),
    resources = new Set<string>(),
    reachable = new Set<string>(),
    texts: string[] = [];
  const normalize = (path: string, extension: string) => {
    if (path.trim().startsWith('/') || path.includes('\\')) return '';
    const parts: string[] = [];
    for (const part of path.trim().split('/')) {
      if (part === '.' || !part) continue;
      if (part === '..') {
        if (!parts.length) return '';
        parts.pop();
      } else parts.push(part);
    }
    const name = parts.join('/');
    return /^[\p{L}\p{N} _./+-]+$/u.test(name)
      ? name + (name.endsWith(extension) ? '' : extension)
      : '';
  };
  const walk = (file: typeof root) => {
    if (!file || reachable.has(file.path)) return;
    reachable.add(file.path);
    const text = (file.text ?? '').replace(/(?<!\\)%[^\n]*/g, '');
    texts.push(text);
    for (const m of text.matchAll(
      /\\(?:addbibresource(?:\[[^\]]*\])?|bibliography)\s*\{([^}]+)\}/g,
    ))
      for (const value of m[1].split(',')) {
        const path = normalize(value, '.bib');
        if (path) resources.add(path);
      }
    for (const m of text.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)) {
      const path = normalize(m[1], '.tex');
      walk(files.find((f) => f.path === path));
    }
  };
  walk(root);
  return { resources: [...resources], reachable: [...reachable], text: texts.join('\n') };
}
export function bibliography(files: Array<{ path: string; text: string | null }>) {
  const records: Reference[] = [],
    warnings: string[] = [];
  const cited = new Set<string>();
  for (const f of files.filter((f) => f.path.endsWith('.tex')))
    for (const m of (f.text ?? '')
      .replace(/(?<!\\)%[^\n]*/g, '')
      .matchAll(/\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\s*\[[^\]]*\])*\s*\{([^}]+)\}/g))
      for (const k of m[1].split(',')) cited.add(k.trim());
  for (const file of files.filter((f) => f.path.endsWith('.bib'))) {
    const parsed = parseBibtex(file.text ?? '');
    warnings.push(...parsed.errors.map((e) => `${file.path}: ${e}`));
    for (const e of parsed.entries)
      records.push({
        id: `${file.path}:${e.start}`,
        provider: 'local',
        path: file.path,
        key: e.key,
        title: e.fields.title ?? '',
        authors: e.fields.author ?? e.fields.editor ?? '',
        year: e.fields.year ?? e.fields.date ?? '',
        doi: e.fields.doi ?? '',
        url: e.fields.url ?? (e.fields.doi ? 'https://doi.org/' + normalizeDoi(e.fields.doi) : ''),
        abstract: e.fields.abstract ?? '',
        bibtex: e.raw,
        issues: [],
      });
  }
  const keys = new Map<string, number>(),
    ids = new Map<string, number>();
  const recordIds = new Map<Reference, string[]>();
  for (const r of records) {
    keys.set(r.key, (keys.get(r.key) ?? 0) + 1);
    const values = [...new Set(identifiers(r))];
    recordIds.set(r, values);
    for (const id of values) ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  for (const r of records) {
    if (!r.key) r.issues.push('Missing citation key');
    if ((keys.get(r.key) ?? 0) > 1) r.issues.push('Duplicate citation key');
    if (recordIds.get(r)!.some((id) => (ids.get(id) ?? 0) > 1))
      r.issues.push('Duplicate identifier');
    if (!r.title || !r.authors || !r.year)
      r.issues.push('Incomplete metadata: title, author or year missing');
    if (!cited.has('*') && !cited.has(r.key)) r.issues.push('Unused (informational)');
  }
  for (const key of cited)
    if (key !== '*' && !keys.has(key)) warnings.push(`Missing bibliography key: ${key}`);
  return { records, warnings };
}
export function bibEscape(text: string) {
  return text
    .replace(
      /[\\{}%&#_$~^]/g,
      (c) =>
        ({
          '\\': '\\textbackslash{}',
          '{': '\\{',
          '}': '\\}',
          '~': '\\textasciitilde{}',
          '^': '\\textasciicircum{}',
        })[c] ?? '\\' + c,
    )
    .replace(/[\r\n]+/g, ' ');
}
export function makeBibtex(
  record: Pick<Reference, 'title' | 'authors' | 'year' | 'doi' | 'url'>,
  key: string,
  extra: Record<string, string> = {},
) {
  const fields = {
    title: record.title,
    author: record.authors,
    year: record.year,
    ...(record.doi ? { doi: normalizeDoi(record.doi) } : {}),
    url: record.url,
    ...extra,
  };
  return `@misc{${key},\n${Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${bibEscape(v)}}`)
    .join(',\n')}\n}`;
}
