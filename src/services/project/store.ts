import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export class MetadataStore {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'metadata.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    if (version > 2) {
      this.db.close();
      throw new Error('This metadata database needs a newer Loom version.');
    }
    if (version === 0)
      this.db.exec(
        'BEGIN; CREATE TABLE projects (path TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1; COMMIT;',
      );
    if (version < 2)
      this.db.exec(
        'BEGIN; CREATE TABLE file_index (project TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(project,id)); CREATE INDEX file_index_project ON file_index(project); PRAGMA user_version=2; COMMIT;',
      );
  }
  index(project: string, files: Array<{ id: string; path: string; content: string }>): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM file_index WHERE project=?').run(project);
      const insert = this.db.prepare('INSERT INTO file_index VALUES (?,?,?,?)');
      for (const f of files) insert.run(project, f.id, f.path, f.content);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  search(project: string, query: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT id FROM file_index WHERE project=? AND (instr(lower(path),lower(?))>0 OR instr(lower(content),lower(?))>0) ORDER BY path LIMIT 2000',
        )
        .all(project, query, query) as { id: string }[]
    ).map((r) => r.id);
  }
  hits(
    project: string,
    query: string,
  ): Array<{ fileId: string; path: string; line: number; offset: number; snippet: string }> {
    const ids = this.search(project, query);
    const result: Array<{
      fileId: string;
      path: string;
      line: number;
      offset: number;
      snippet: string;
    }> = [];
    for (const id of ids) {
      const row = this.db
        .prepare('SELECT path,content FROM file_index WHERE project=? AND id=?')
        .get(project, id) as { path: string; content: string };
      let start = 0,
        count = 0;
      const lower = row.content.toLowerCase(),
        needle = query.toLowerCase();
      let offset = lower.indexOf(needle, start);
      if (offset < 0)
        result.push({ fileId: id, path: row.path, line: 1, offset: 0, snippet: row.path });
      while (offset >= 0 && count++ < 20 && result.length < 200) {
        const line = row.content.slice(0, offset).split('\n').length;
        const from = row.content.lastIndexOf('\n', offset - 1) + 1,
          to = row.content.indexOf('\n', offset);
        result.push({
          fileId: id,
          path: row.path,
          line,
          offset,
          snippet: row.content.slice(from, to < 0 ? undefined : to).slice(0, 200),
        });
        start = offset + Math.max(1, needle.length);
        offset = lower.indexOf(needle, start);
      }
      if (result.length >= 200) break;
    }
    return result;
  }
  get(key: string): string | null {
    return (
      (
        this.db.prepare('SELECT value FROM preferences WHERE key=?').get(key) as
          { value: string } | undefined
      )?.value ?? null
    );
  }
  set(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO preferences VALUES (?,?)').run(key, value);
  }
  load(path: string): string | null {
    return (
      (
        this.db.prepare('SELECT value FROM projects WHERE path=?').get(path) as
          { value: string } | undefined
      )?.value ?? null
    );
  }
  save(path: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO projects VALUES (?,?)').run(path, value);
  }
  close(): void {
    this.db.close();
  }
}
