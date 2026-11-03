import { portableBuildSchema, type BuildSettings } from '../../contracts/latex';
import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { unzipSync } from 'fflate';
import { relativePath, type ProjectCommand, type ProjectSnapshot } from '../../contracts/project';
import { MetadataStore } from './store';
import { reconcile, textChanges } from './reconcile';
type RecordFile = {
  id: string;
  path: string;
  baseline: string | null;
  state: number[];
  binary: boolean;
  deleted: boolean;
  inode: string;
  conflict: boolean;
  disk: string | null;
  diskKind?: 'text' | 'binary' | 'missing';
  diskRevision?: string | null;
  overrideHash?: string;
  recovery?: number[];
};
type Project = {
  id: string;
  name: string;
  rootId: string | null;
  files: RecordFile[];
  preferences: string | null;
  buildSettings?: BuildSettings;
  buildConfigError?: string;
};
const hash = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const MAX_FILE = 8 * 1024 * 1024;
export class ProjectService {
  private root = '';
  private loadedId = '';
  private project: Project | null = null;
  private documents = new Map<string, Y.Doc>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly store: MetadataStore) {}
  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  private persist(): void {
    if (this.project) this.store.save(this.root, JSON.stringify(this.project));
  }
  private doc(file: RecordFile): Y.Doc {
    let doc = this.documents.get(file.id);
    if (!doc) {
      doc = new Y.Doc();
      if (file.state.length) Y.applyUpdate(doc, Uint8Array.from(file.state));
      this.documents.set(file.id, doc);
    }
    return doc;
  }
  private setText(file: RecordFile, text: string): void {
    const doc = this.doc(file);
    const live = doc.getText('source');
    const old = live.toString();
    if (old === text) {
      file.state = Array.from(Y.encodeStateAsUpdate(doc));
      return;
    }
    const changes = textChanges(old, text).sort((a, b) => b.from - a.from);
    doc.transact(() => {
      for (const change of changes) {
        live.delete(change.from, change.to - change.from);
        live.insert(change.from, change.text);
      }
    }, 'filesystem');
    file.state = Array.from(Y.encodeStateAsUpdate(doc));
  }
  private async safe(path: string): Promise<string> {
    relativePath.parse(path);
    const target = resolve(this.root, path);
    if (!target.startsWith(this.root + sep)) throw new Error('Path is outside this project.');
    let current = this.root;
    for (const segment of path.split('/')) {
      current = join(current, segment);
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw new Error('Symbolic links are not editable project paths.');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    return target;
  }
  private async scan(): Promise<
    Map<string, { text: string | null; inode: string; revision: string }>
  > {
    const found = new Map<string, { text: string | null; inode: string; revision: string }>();
    let total = 0;
    const walk = async (dir: string) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name.startsWith('.loom-save-')) continue;
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) {
          if (found.size >= 2000) throw new Error('This pilot supports up to 2,000 project files.');
          const stat = await fs.stat(path);
          let text: string | null = null;
          let revision = `stat:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
          if (stat.size <= MAX_FILE) {
            total += stat.size;
            if (total > 32 * 1024 * 1024)
              throw new Error('This pilot supports up to 32 MiB of indexed project content.');
            const bytes = await fs.readFile(
              await this.safe(relative(this.root, path).split(sep).join('/')),
            );
            revision = hash(bytes);
            try {
              const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
              if (!decoded.includes('\0')) text = decoded;
            } catch {
              /* Binary assets stay on disk. */
            }
          }
          found.set(relative(this.root, path).split(sep).join('/'), {
            text,
            revision,
            inode: `${stat.dev}:${stat.ino}`,
          });
        }
      }
    };
    await walk(this.root);
    return found;
  }
  async open(path: string): Promise<ProjectSnapshot> {
    const root = await fs.realpath(path);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Choose a project folder.');
    this.persist();
    const previous = {
      root: this.root,
      project: this.project,
      documents: this.documents,
      loadedId: this.loadedId,
    };
    this.documents = new Map();
    this.root = root;
    this.loadedId = '';
    try {
      const stored = this.store.load(root);
      this.project = stored
        ? JSON.parse(stored)
        : { id: randomUUID(), name: basename(root), rootId: null, files: [], preferences: null };
      await this.refresh();
      try {
        const config = portableBuildSchema.parse(
          JSON.parse(await fs.readFile(await this.safe('loom.build.json'), 'utf8')),
        );
        const rootFile = this.project!.files.find(
          (f) => !f.deleted && f.path === config.root && f.path.endsWith('.tex'),
        );
        if (!rootFile)
          throw new Error('Configured root is missing. Select a root and save build settings.');
        this.project!.rootId = rootFile.id;
        this.project!.buildSettings = config.settings;
        delete this.project!.buildConfigError;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          this.project!.buildConfigError =
            'Invalid loom.build.json. Select the root and save build settings to repair it.';
        else {
          delete this.project!.buildSettings;
          delete this.project!.buildConfigError;
        }
      }
      this.persist();
      this.store.set('lastProject', root);
      for (const doc of previous.documents.values()) doc.destroy();
      return this.snapshot();
    } catch (error) {
      for (const doc of this.documents.values()) doc.destroy();
      this.root = previous.root;
      this.project = previous.project;
      this.documents = previous.documents;
      this.loadedId = previous.loadedId;
      throw error;
    }
  }

  async current(): Promise<ProjectSnapshot | null> {
    if (!this.project) {
      const last = this.store.get('lastProject');
      if (last) {
        try {
          return await this.open(last);
        } catch {
          throw new Error('The last project is unavailable. Open its folder to reconnect.');
        }
      }
    }
    return this.project ? this.snapshot() : null;
  }
  nativeLocation() {
    return this.project ? { projectId: this.project.id, path: this.root } : null;
  }
  async createFile(path: string, projectId: string): Promise<ProjectSnapshot | null> {
    await this.current();
    if (this.project?.id !== projectId)
      throw new Error('The open project changed. Choose the file location again.');
    const target = resolve(path);
    if (!target.startsWith(this.root + sep))
      throw new Error('Choose a location inside the open project folder.');
    return this.command({ type: 'create', path: relative(this.root, target).split(sep).join('/') });
  }
  async create(path: string): Promise<ProjectSnapshot> {
    await fs.mkdir(path, { recursive: false });
    await fs.writeFile(
      join(path, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\n\n\\end{document}\n',
      { flag: 'wx' },
    );
    return this.open(path);
  }
  async importFolder(source: string, destination: string): Promise<ProjectSnapshot> {
    const src = await fs.realpath(source);
    if (resolve(destination).startsWith(src + sep) || resolve(destination) === src)
      throw new Error('Choose a destination outside the source folder.');
    await fs.mkdir(destination, { recursive: false });
    for (const entry of await fs.readdir(src))
      await fs.cp(join(src, entry), join(destination, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: async (path) =>
          !(await fs.lstat(path)).isSymbolicLink() && basename(path) !== '.git',
      });
    return this.open(destination);
  }
  async importZip(source: string, destination: string): Promise<ProjectSnapshot> {
    const bytes = await fs.readFile(source);
    if (bytes.length > 64 * 1024 * 1024) throw new Error('ZIP exceeds the 64 MiB import limit.');
    let total = 0,
      count = 0;
    const entries = unzipSync(bytes, {
      filter: (file) => {
        relativePath.parse(file.name.replace(/\/$/, ''));
        total += file.originalSize;
        if (++count > 2000 || total > 128 * 1024 * 1024)
          throw new Error('ZIP exceeds project import limits.');
        return true;
      },
    });
    await fs.mkdir(destination, { recursive: false });
    for (const [path, data] of Object.entries(entries)) {
      if (path.endsWith('/')) {
        await fs.mkdir(join(destination, path), { recursive: true });
        continue;
      }
      await fs.mkdir(dirname(join(destination, path)), { recursive: true });
      await fs.writeFile(join(destination, path), data, { flag: 'wx' });
    }
    return this.open(destination);
  }
  async refresh(): Promise<void> {
    if (!this.project) return;
    const disk = await this.scan();
    for (const file of this.project.files) {
      let found = disk.get(file.path);
      if (!found && !file.deleted) {
        const renamed = [...disk].find(
          ([path, v]) =>
            v.inode === file.inode &&
            !this.project!.files.some((f) => f.path === path && !f.deleted),
        );
        if (renamed) {
          file.path = renamed[0];
          found = renamed[1];
        }
      }
      file.diskKind = found ? (found.text === null ? 'binary' : 'text') : 'missing';
      file.diskRevision = found?.revision ?? null;
      if (file.deleted) {
        if (found) {
          disk.delete(file.path);
          file.deleted = false;
          file.conflict = true;
          file.disk = found.text;
        }
        continue;
      }
      if (!found) {
        file.conflict = true;
        file.disk = null;
        continue;
      }
      disk.delete(file.path);
      file.inode = found.inode;
      if (file.binary) {
        continue;
      }
      const local = this.doc(file).getText('source').toString();
      file.disk = found.text;
      if (found.text === null) {
        file.conflict = true;
        continue;
      }
      if (found.text === file.baseline) {
        if (!file.conflict) continue;
        if (local === found.text) file.conflict = false;
        continue;
      }
      const merged = reconcile(file.baseline ?? '', local, found.text);
      if (merged === null) {
        file.conflict = true;
        continue;
      }
      this.setText(file, merged);
      file.baseline = found.text;
      file.conflict = false;
    }
    for (const [path, found] of disk) {
      const file: RecordFile = {
        id: randomUUID(),
        path,
        baseline: found.text,
        state: [],
        binary: found.text === null,
        deleted: false,
        inode: found.inode,
        conflict: false,
        disk: found.text,
        diskKind: found.text === null ? 'binary' : 'text',
        diskRevision: found.revision,
      };
      if (found.text !== null) this.setText(file, found.text);
      this.project.files.push(file);
    }
    if (!this.project.rootId) {
      const roots = this.project.files.filter(
        (f) => !f.deleted && f.baseline?.includes('\\documentclass'),
      );
      if (roots.length === 1) this.project.rootId = roots[0].id;
    }
    this.persist();
    this.store.index(
      this.root,
      this.project.files
        .filter((f) => !f.deleted)
        .map((f) => ({
          id: f.id,
          path: f.path,
          content: f.binary ? '' : this.doc(f).getText('source').toString(),
        })),
    );
  }
  private async save(file: RecordFile): Promise<void> {
    if (file.binary || file.deleted || file.conflict) return;
    const text = this.doc(file).getText('source').toString();
    if (text === file.baseline) return;
    const target = await this.safe(file.path);
    let bytes: Buffer | null = null;
    try {
      bytes = await fs.readFile(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const expected = file.overrideHash ?? (file.baseline === null ? null : hash(file.baseline));
    const diskHash = bytes === null ? null : hash(bytes);
    if (diskHash !== expected) {
      file.conflict = true;
      file.diskRevision = diskHash;
      file.disk = bytes?.toString('utf8') ?? null;
      this.persist();
      return;
    }
    this.persist();
    const temp = join(dirname(target), `.loom-save-${randomUUID()}`);
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      let latest: Buffer | null = null;
      try {
        latest = await fs.readFile(target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if ((latest === null ? null : hash(latest)) !== diskHash) {
        file.conflict = true;
        file.diskRevision = latest === null ? null : hash(latest);
        file.disk = latest?.toString('utf8') ?? null;
        this.persist();
        return;
      }
      try {
        await fs.chmod(temp, (await fs.stat(target)).mode);
      } catch {
        /* New file. */
      }
      await fs.rename(temp, target);
      const dir = await fs.open(dirname(target), 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      delete file.overrideHash;
      file.diskKind = 'text';
      file.diskRevision = hash(text);
      file.baseline = text;
      file.disk = text;
      const stat = await fs.stat(target);
      file.inode = `${stat.dev}:${stat.ino}`;
      this.persist();
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async command(command: ProjectCommand): Promise<ProjectSnapshot | null> {
    if (command.type === 'current') return this.current();
    if (!this.project) await this.current();
    if (!this.project) throw new Error('Open a project first.');
    if (command.type === 'load') this.loadedId = command.fileId;
    if (command.type === 'sync') {
      this.loadedId = command.fileId;
      const file = this.project.files.find((f) => f.id === command.fileId);
      if (!file || file.binary) throw new Error('Text file is unavailable.');
      Y.applyUpdate(this.doc(file), Uint8Array.from(command.update));
      if (command.baseline !== file.baseline && command.text !== command.baseline) {
        const merged = reconcile(command.baseline ?? '', command.text, file.baseline ?? '');
        this.setText(file, merged ?? command.text);
        if (merged === null) {
          file.conflict = true;
          file.disk = file.baseline;
        }
      }
      file.state = Array.from(Y.encodeStateAsUpdate(this.doc(file)));
      this.persist();
    }
    await this.refresh();
    if (command.type === 'search') {
      const hits = this.store.hits(this.root, command.query);
      return {
        ...this.snapshot(),
        matches: [...new Set(hits.map((hit) => hit.fileId))],
        hits,
      };
    }
    if (command.type === 'preferences') {
      this.project.preferences = command.value;
      this.persist();
      return this.snapshot();
    }
    if (command.type === 'create') {
      const path = await this.safe(command.path);
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, '', { flag: 'wx' });
      await this.refresh();
    } else if ('fileId' in command) {
      const file = this.project.files.find((f) => f.id === command.fileId);
      if (!file) throw new Error('File is no longer in this project.');
      if (command.type === 'root') {
        if (file.deleted || !file.path.endsWith('.tex'))
          throw new Error('Select a .tex root document.');
        this.project.rootId = file.id;
      }
      if (command.type === 'rename') {
        if (file.deleted || file.conflict) throw new Error('Resolve this file before renaming.');
        const target = await this.safe(command.path);
        try {
          await fs.lstat(target);
          throw new Error('A file already exists at that path.');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.rename(await this.safe(file.path), target);
        file.path = command.path;
      }
      if (command.type === 'delete') {
        if (file.conflict) throw new Error('Resolve this file before deletion.');
        const bytes = await fs.readFile(await this.safe(file.path));
        file.recovery = Array.from(bytes);
        this.persist();
        await fs.unlink(await this.safe(file.path));
        file.deleted = true;
        if (this.project.rootId === file.id) this.project.rootId = null;
      }
      if (command.type === 'restore') {
        if (!file.deleted && !(file.conflict && file.diskKind === 'missing' && file.recovery))
          throw new Error('This file has no deleted recovery copy.');
        const bytes =
          file.recovery ?? Array.from(Buffer.from(this.doc(file).getText('source').toString()));
        await fs.mkdir(dirname(await this.safe(file.path)), { recursive: true });
        await fs.writeFile(await this.safe(file.path), Uint8Array.from(bytes), { flag: 'wx' });
        file.deleted = false;
        file.baseline = file.binary ? null : Buffer.from(bytes).toString('utf8');
        file.conflict = false;
      }
      if (command.type === 'resolve') {
        if (!file.conflict) throw new Error('This conflict has already changed.');
        if (file.disk !== command.disk || (file.diskRevision ?? null) !== command.diskRevision)
          throw new Error('The disk changed again. Review the latest conflict.');
        if (command.choice === 'disk') {
          if (file.diskKind === 'binary') {
            file.binary = true;
            file.baseline = null;
          } else if (file.disk === null) {
            file.deleted = true;
          } else {
            this.setText(file, file.disk);
            file.baseline = file.disk;
          }
        } else {
          if (file.diskKind === 'binary') {
            if (file.diskRevision?.startsWith('stat:'))
              throw new Error(
                'This replacement exceeds the text size limit. Keep the disk asset or recover the source to another file.',
              );
            file.overrideHash = file.diskRevision ?? undefined;
          }
          file.baseline = file.disk;
        }
        file.conflict = false;
      }
    }
    this.persist();
    for (const file of this.project.files) await this.save(file);
    return this.snapshot();
  }
  async configureBuild(projectId: string, settings: BuildSettings) {
    const context = this.buildContext(projectId);
    const root = context.files.find((f) => f.id === context.snapshot.rootId)?.path;
    if (!root) throw new Error('Choose a root .tex document before saving build settings.');
    const target = await this.safe('loom.build.json');
    const temp = await this.safe(`.loom-save-${randomUUID()}`);
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ version: 1, root, settings }, null, 2) + '\n');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, target);
      this.project!.buildSettings = settings;
      delete this.project!.buildConfigError;
      await this.refresh();
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  /** Internal only: native roots never cross the renderer bridge. Call inside run(). */
  buildContext(projectId: string) {
    if (!this.project || this.project.id !== projectId)
      throw new Error('The open project changed.');
    const snapshot = this.snapshot();
    return {
      settings: this.project.buildSettings,
      configError: this.project.buildConfigError,
      root: this.root,
      snapshot,
      files: this.project.files
        .filter((f) => !f.deleted)
        .map((f) => ({
          id: f.id,
          path: f.path,
          revision: f.binary ? f.diskRevision : hash(this.doc(f).getText('source').toString()),
          text: f.binary ? null : this.doc(f).getText('source').toString(),
        })),
    };
  }
  snapshot(): ProjectSnapshot {
    const p = this.project!;
    return {
      id: p.id,
      name: p.name,
      rootId: p.rootId,
      preferences: p.preferences,
      sourceRevision: hash(
        JSON.stringify([
          p.rootId,
          p.files
            .filter((f) => !f.deleted)
            .map((f) => [
              f.path,
              f.binary ? f.diskRevision : hash(this.doc(f).getText('source').toString()),
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ]),
      ),
      files: p.files.map((f) => {
        const text = f.binary ? null : this.doc(f).getText('source').toString();
        return {
          id: f.id,
          path: f.path,
          loaded: f.id === this.loadedId,
          text: f.binary ? null : f.id === this.loadedId ? text : '',
          update: f.id === this.loadedId ? f.state : [],
          baseline: f.id === this.loadedId ? f.baseline : null,
          disk: f.id === this.loadedId ? f.disk : null,
          diskKind: f.diskKind ?? (f.disk === null ? 'missing' : 'text'),
          diskRevision: f.id === this.loadedId ? (f.diskRevision ?? null) : null,
          conflict: f.conflict,
          deleted: f.deleted,
          revision: hash(text ?? ''),
          saved: !f.conflict && !f.deleted && text === f.baseline,
        };
      }),
    };
  }
}
