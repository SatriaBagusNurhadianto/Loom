import type { LatexCommand, LatexResult } from '../contracts/latex';
import type { ProjectResult } from '../contracts/project';
import {
  failure,
  serviceMessageSchema,
  type Result,
  type ServiceEvent,
  type ServiceStatus,
} from '../contracts/desktop';

export interface ServiceTransport {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: () => void): void;
  onError(listener: () => void): void;
  kill(): void;
}
type Pending = {
  resolve: (result: Result<ServiceStatus>) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Bounded, generation-aware service transport, independent of Electron for testing. */
export class ServiceController {
  private transport: ServiceTransport | undefined;
  private generation = 0;
  private nextId = 0;
  projectLocation: { projectId: string; path: string } | null = null;
  private status: ServiceStatus = { state: 'unavailable', pid: null, version: '0.1.0' };
  private listeners = new Set<(event: ServiceEvent) => void>();
  private projectPending = new Map<
    string,
    { resolve: (result: ProjectResult) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private latexPending = new Map<
    string,
    { resolve: (result: LatexResult) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private pending = new Map<string, Pending>();
  private startup: Promise<Result<ServiceStatus>> | undefined;
  private startupResolve: ((result: Result<ServiceStatus>) => void) | undefined;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly spawn: () => ServiceTransport,
    private readonly timeoutMs = 5_000,
  ) {}

  subscribe(listener: (event: ServiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(error?: ServiceEvent['error']): void {
    const event: ServiceEvent = {
      type: 'service-status',
      status: { ...this.status },
      ...(error ? { error } : {}),
    };
    for (const listener of this.listeners) listener(event);
  }

  private finishStartup(result: Result<ServiceStatus>): void {
    clearTimeout(this.startupTimer);
    this.startupResolve?.(result);
    this.startupResolve = undefined;
    this.startup = undefined;
  }

  private unavailable(
    code: 'TIMEOUT' | 'SERVICE_UNAVAILABLE' | 'INVALID_RESPONSE',
    message: string,
    terminate = true,
  ): Result<never> {
    // Retire ownership before terminating: kill may synchronously emit more events.
    // A failed kill must not leave this generation able to resolve newer requests.
    ++this.generation;
    const transport = this.transport;
    this.transport = undefined;
    this.projectLocation = null;
    if (terminate && transport) {
      try {
        transport.kill();
      } catch {
        // Continue resolving callers and clearing timers even if native teardown fails.
      }
    }
    const result = failure(code, message);
    this.status = { state: 'unavailable', pid: null, version: '0.1.0' };
    this.finishStartup(result);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(result);
    }
    this.pending.clear();
    for (const pending of this.projectPending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(result);
    }
    this.projectPending.clear();
    for (const pending of this.latexPending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(result);
    }
    this.latexPending.clear();
    if (!result.ok) this.publish(result.error);
    return result;
  }

  start(): Promise<Result<ServiceStatus>> {
    if (this.startup) return this.startup;
    if (this.status.state === 'ready')
      return Promise.resolve({ ok: true, value: { ...this.status } });
    const generation = ++this.generation;
    this.status = { state: 'starting', pid: null, version: '0.1.0' };
    this.publish();
    const startup = new Promise<Result<ServiceStatus>>((resolve) => {
      this.startupResolve = resolve;
    });
    this.startup = startup;
    this.startupTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.unavailable('TIMEOUT', 'The local service did not start. Restart it to retry.');
    }, this.timeoutMs);
    try {
      const transport = this.spawn();
      this.transport = transport;
      transport.onMessage((message) => {
        if (generation !== this.generation || this.status.state === 'unavailable') return;
        const parsed = serviceMessageSchema.safeParse(message);
        if (!parsed.success) {
          this.unavailable(
            'INVALID_RESPONSE',
            'The local service sent an invalid response. Restart it to recover.',
          );
          return;
        }
        const data = parsed.data;
        if (data.type === 'latex-result') {
          const pending = this.latexPending.get(data.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.latexPending.delete(data.id);
            pending.resolve(data.result);
          }
          return;
        }
        if (data.type === 'project-context') {
          this.projectLocation = { projectId: data.projectId, path: data.path };
          return;
        }
        if (data.type === 'project-result') {
          const pending = this.projectPending.get(data.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.projectPending.delete(data.id);
            pending.resolve(data.result);
          }
          return;
        }
        if (data.type === 'ready') {
          if (this.status.state !== 'starting') return;
          this.status = { state: 'ready', pid: data.pid, version: data.version };
          this.finishStartup({ ok: true, value: { ...this.status } });
          this.publish();
        } else {
          const pending = this.pending.get(data.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(data.id);
          pending.resolve({
            ok: true,
            value: { ...this.status, pid: data.pid, version: data.version },
          });
        }
      });
      transport.onExit(() => {
        if (generation !== this.generation || this.status.state === 'unavailable') return;
        this.unavailable(
          'SERVICE_UNAVAILABLE',
          'The local service stopped. Restart it to reconnect.',
          false,
        );
      });
      transport.onError(() => {
        if (generation !== this.generation || this.status.state === 'unavailable') return;
        this.unavailable(
          'SERVICE_UNAVAILABLE',
          'The local service encountered an error. Restart it to reconnect.',
        );
      });
    } catch {
      this.unavailable(
        'SERVICE_UNAVAILABLE',
        'The local service could not start. Restart it to retry.',
      );
    }
    return startup;
  }

  async getStatus(): Promise<Result<ServiceStatus>> {
    if (this.startup) return this.startup;
    if (this.status.state !== 'ready' || !this.transport)
      return { ok: true, value: { ...this.status } };
    if (this.pending.size >= 32)
      return failure('BUSY', 'Too many service checks are running. Try again shortly.');
    const id = `${this.generation}:${++this.nextId}`;
    return new Promise<Result<ServiceStatus>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(
          this.unavailable(
            'TIMEOUT',
            'The local service did not respond. Restart it to reconnect.',
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      try {
        this.transport!.postMessage({ type: 'ping', id });
      } catch {
        this.unavailable(
          'SERVICE_UNAVAILABLE',
          'The local service connection failed. Restart it to reconnect.',
        );
      }
    });
  }

  async project(command: unknown): Promise<ProjectResult> {
    const ready = await this.start();
    if (!ready.ok) return ready;
    if (this.projectPending.size >= 32) return failure('BUSY', 'Too many project operations.');
    const id = `${this.generation}:project:${++this.nextId}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.unavailable(
          'TIMEOUT',
          'Project operation interrupted. Restart the service and reopen the project to recover.',
        );
      }, 30000);
      this.projectPending.set(id, { resolve, timer });
      try {
        this.transport!.postMessage({ type: 'project', id, command });
      } catch {
        this.unavailable(
          'SERVICE_UNAVAILABLE',
          'Project connection interrupted. Restart to recover.',
        );
      }
    });
  }

  async latex(command: LatexCommand): Promise<LatexResult> {
    const ready = await this.start();
    if (!ready.ok) return ready;
    if (this.latexPending.size >= 16)
      return failure('BUSY', 'Too many LaTeX requests. Try again shortly.');
    const id = `${this.generation}:latex:${++this.nextId}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.latexPending.delete(id);
        resolve(failure('TIMEOUT', 'LaTeX request timed out. Retry or reconnect the service.'));
      }, 25000);
      this.latexPending.set(id, { resolve, timer });
      try {
        this.transport!.postMessage({ type: 'latex', id, command });
      } catch {
        this.unavailable('SERVICE_UNAVAILABLE', 'LaTeX connection interrupted.');
      }
    });
  }
  restart(): Promise<Result<ServiceStatus>> {
    if (this.startup) return this.startup;
    this.stop();
    return this.start();
  }

  stop(): void {
    this.unavailable('SERVICE_UNAVAILABLE', 'The local service connection was closed.');
  }
}
