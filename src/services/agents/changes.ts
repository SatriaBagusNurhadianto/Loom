import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AgentTurn, AgentChange } from '../../contracts/agent';
import { ProjectService } from '../project/projects';
import { reconcile } from '../project/reconcile';

type RecordTurn = {
  view: AgentTurn;
  before: Record<string, string>;
  after: Record<string, string>;
  human: string[];
  unsettled?: boolean;
  external?: boolean;
};
export function decodeText(bytes: Buffer | null): string | null {
  if (!bytes) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}
/** Durable checkpoints precede submission; snapshots are protected app data, never project files. */
export class AgentChanges {
  private turns: RecordTurn[] = [];
  private projectId = '';
  constructor(
    private projects: ProjectService,
    private directory: string,
  ) {
    projects.onHumanWrite = (path) => {
      const turn = this.turns.find((t) => t.view.status === 'running');
      if (turn && !turn.human.includes(path)) {
        turn.human.push(path);
        this.persist();
      }
    };
  }
  async bind(projectId: string) {
    if (projectId === this.projectId) return;
    this.projectId = projectId;
    this.turns = JSON.parse(
      this.projects.store.get(`agent-turns:${projectId}`) ?? '[]',
    ) as RecordTurn[];
    for (const turn of this.turns)
      if (turn.view.status === 'running') turn.view.status = 'interrupted';
    this.persist();
  }
  private persist() {
    this.projects.store.set(`agent-turns:${this.projectId}`, JSON.stringify(this.turns));
  }
  views() {
    return this.turns.map((t) => t.view);
  }
  running() {
    return this.turns.find((t) => t.view.status === 'running');
  }
  private async checkpoint(id: string, name: string, files: Map<string, Buffer>) {
    const folder = join(this.directory, id, name);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const index: Record<string, string> = {};
    for (const [path, bytes] of files) {
      const key = randomUUID();
      const handle = await fs.open(join(folder, key), 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      index[path] = join(id, name, key);
    }
    const handle = await fs.open(folder, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return index;
  }
  async begin(sessionId: string, revision: string, external = false) {
    if (this.running()) throw new Error('Wait for the current request to finish.');
    if (this.turns.length >= 100)
      throw new Error(
        'This pilot retains up to 100 turns per paper. Recovery copies are retained.',
      );
    const context = this.projects.buildContext(this.projectId);
    if (
      context.snapshot.sourceRevision !== revision ||
      context.snapshot.files.some((f) => !f.deleted && (!f.saved || f.conflict))
    )
      throw new Error('Your paper changed while preparing the request. Save and try again.');
    const files = await this.projects.agentFiles(this.projectId);
    if (this.projects.snapshot().sourceRevision !== revision)
      throw new Error('Your paper changed while preparing the request. Try again.');
    const id = randomUUID();
    const before = await this.checkpoint(id, 'before', files);
    const latest = await this.projects.agentFiles(this.projectId);
    if (
      latest.size !== files.size ||
      [...latest].some(([path, bytes]) => !files.get(path)?.equals(bytes))
    )
      throw new Error('The paper changed while preparing recovery. Try again.');
    const turn: RecordTurn = {
      view: {
        id,
        sessionId,
        status: 'running',
        startedAt: new Date().toISOString(),
        revision,
        changes: [],
      },
      before,
      after: {},
      human: [],
      unsettled: true,
      external,
    };
    this.turns.unshift(turn);
    this.persist();
    return turn;
  }
  async observe(turn = this.running()) {
    if (!turn) return;
    const files = await this.projects.agentFiles(this.projectId);
    // Checkpoint each observed state before publishing it. Existing copies remain recoverable.
    const next: Record<string, string> = {};
    const changes: AgentChange[] = [];
    for (const path of new Set([...Object.keys(turn.before), ...files.keys()])) {
      const before = turn.before[path]
        ? await fs.readFile(join(this.directory, turn.before[path]))
        : null;
      const after = files.get(path) ?? null;
      if ((before === null && after === null) || (before && after && before.equals(after)))
        continue;
      if (after) {
        const previous = turn.after[path];
        if (previous && (await fs.readFile(join(this.directory, previous))).equals(after))
          next[path] = previous;
        else
          Object.assign(
            next,
            await this.checkpoint(turn.view.id, randomUUID(), new Map([[path, after]])),
          );
      }
      const a = decodeText(before),
        b = decodeText(after);
      changes.push({
        path,
        before: a?.slice(0, 200000) ?? null,
        after: b?.slice(0, 200000) ?? null,
        kind: before === null ? 'created' : after === null ? 'deleted' : 'modified',
        binary: (before !== null && a === null) || (after !== null && b === null),
        review: 'pending',
        humanTouched: turn.human.includes(path),
      });
    }
    turn.after = next;
    turn.view.changes = changes;
    this.persist();
  }
  async finish(status: AgentTurn['status']) {
    const turn = this.running();
    if (!turn) return;
    await this.observe(turn);
    turn.view.status = status;
    turn.unsettled = false;
    this.persist();
  }
  unsettledExternal() {
    return this.turns.find((t) => t.unsettled && t.external);
  }
  async settleExternal() {
    const turn = this.unsettledExternal();
    if (turn) {
      await this.observe(turn);
      turn.unsettled = false;
      this.persist();
    }
  }
  async recoverInterrupted() {
    const turn = this.turns.find((t) => t.unsettled && !t.external);
    if (turn) {
      // The native supervisor closes owned process groups within 500 ms after service EOF.
      await new Promise((resolve) => setTimeout(resolve, 750));
      await this.observe(turn);
      turn.unsettled = false;
      this.persist();
    }
  }
  async review(turnId: string, path: string, action: 'keep' | 'revert', revision: string) {
    if (this.running() || this.unsettledExternal())
      throw new Error('Reconnect and stop the request before reviewing its changes.');
    const turn = this.turns.find((t) => t.view.id === turnId),
      change = turn?.view.changes.find((c) => c.path === path);
    if (!turn || !change || change.review !== 'pending')
      throw new Error('This change has already been reviewed.');
    if (action === 'keep') {
      change.review = 'kept';
      this.persist();
      return;
    }
    await this.projects.refresh();
    if (this.projects.snapshot().sourceRevision !== revision)
      throw new Error('The paper changed. Review the latest version and try again.');
    if (change.humanTouched)
      throw new Error(
        'You also edited this file during the request. The saved comparison is available; copy the passages you want to restore so your writing is preserved.',
      );
    const before = turn.before[path]
      ? await fs.readFile(join(this.directory, turn.before[path]))
      : null;
    const after = turn.after[path]
      ? await fs.readFile(join(this.directory, turn.after[path]))
      : null;
    const current = (await this.projects.agentFiles(this.projectId)).get(path) ?? null;
    let desired = before;
    if (before && after && current && !current.equals(after)) {
      const a = decodeText(after),
        b = decodeText(current),
        c = decodeText(before);
      const merged = a !== null && b !== null && c !== null ? reconcile(a, b, c) : null;
      if (merged === null)
        throw new Error(
          'Your newer writing overlaps this change. Use the comparison to restore only the passages you want. Both versions are retained.',
        );
      desired = Buffer.from(merged);
    } else if (
      (current === null) !== (after === null) ||
      (current && after && !current.equals(after))
    )
      throw new Error(
        'This file has newer changes. Both versions are retained; review it before reverting.',
      );
    // Recoverable current bytes exist even if the process stops during the restore.
    if (current)
      await this.checkpoint(turn.view.id, 'revert-' + randomUUID(), new Map([[path, current]]));
    await this.projects.agentRestore(this.projectId, path, current, desired);
    change.review = 'reverted';
    this.persist();
  }
}
