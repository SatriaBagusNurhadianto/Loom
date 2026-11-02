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
    if (version > 1) throw new Error('This metadata database needs a newer Loom version.');
    if (version === 0)
      this.db.exec(
        'BEGIN; CREATE TABLE projects (path TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1; COMMIT;',
      );
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
