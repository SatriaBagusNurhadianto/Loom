import { describe, expect, it, vi } from 'vitest';
import {
  emptyRequestSchema,
  serviceEventSchema,
  serviceMessageSchema,
  serviceStatusSchema,
  statusResultSchema,
} from '../src/contracts/desktop';
import { ServiceController, type ServiceTransport } from '../src/main/service-controller';

class FakeTransport implements ServiceTransport {
  messages: unknown[] = [];
  killed = false;
  killCount = 0;
  message: (message: unknown) => void = () => {};
  exit: () => void = () => {};
  error: () => void = () => {};
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  onMessage(listener: (message: unknown) => void): void {
    this.message = listener;
  }
  onExit(listener: () => void): void {
    this.exit = listener;
  }
  onError(listener: () => void): void {
    this.error = listener;
  }
  kill(): void {
    this.killed = true;
    ++this.killCount;
  }
  ready(pid = 42): void {
    this.message({ type: 'ready', pid, version: '0.1.0' });
  }
  pong(): void {
    const request = this.messages.at(-1) as { id: string };
    this.message({ type: 'pong', id: request.id, pid: 42, version: '0.1.0' });
  }
}

describe('validated desktop contracts', () => {
  it('rejects extra capabilities, invalid process IDs, and malformed messages', () => {
    expect(emptyRequestSchema.safeParse({ path: '/etc/passwd' }).success).toBe(false);
    expect(
      serviceStatusSchema.safeParse({ state: 'ready', pid: -1, version: '0.1.0' }).success,
    ).toBe(false);
    expect(
      serviceStatusSchema.safeParse({ state: 'ready', pid: null, version: '0.1.0' }).success,
    ).toBe(false);
    expect(serviceMessageSchema.safeParse({ type: 'exec', command: 'echo secret' }).success).toBe(
      false,
    );
    expect(
      serviceMessageSchema.safeParse({ type: 'pong', id: '', pid: 42, version: '0.1.0' }).success,
    ).toBe(false);
    expect(
      statusResultSchema.safeParse({
        ok: false,
        error: { code: 'UNKNOWN', message: 'bad', retryable: true },
      }).success,
    ).toBe(false);
    expect(
      serviceEventSchema.safeParse({
        type: 'service-status',
        status: { state: 'unavailable', pid: null, version: '0.1.0' },
      }).success,
    ).toBe(true);
  });
});

describe('utility process lifecycle', () => {
  it('waits for readiness, coalesces startup, and checks a correlated round trip', async () => {
    const transport = new FakeTransport();
    const service = new ServiceController(() => transport);
    const startup = service.start();
    expect(service.start()).toBe(startup);
    transport.ready();
    expect(await startup).toEqual({
      ok: true,
      value: { state: 'ready', pid: 42, version: '0.1.0' },
    });
    const ping = service.getStatus();
    expect(transport.messages).toHaveLength(1);
    transport.message({ type: 'pong', id: 'unrelated', pid: 42, version: '0.1.0' });
    transport.pong();
    expect((await ping).ok).toBe(true);
    service.stop();
  });

  it('resolves interrupted requests and ignores events from the old child after restart', async () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    const transports = [first, second];
    const service = new ServiceController(() => transports.shift()!);
    const start = service.start();
    first.ready();
    await start;
    const interrupted = service.getStatus();
    const restart = service.restart();
    expect(await interrupted).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(first.killed).toBe(true);
    first.ready(999);
    first.exit();
    second.ready(43);
    expect(await restart).toMatchObject({ ok: true, value: { state: 'ready', pid: 43 } });
    service.stop();
  });

  it('reports service crashes and allows explicit recovery', async () => {
    const transport = new FakeTransport();
    const service = new ServiceController(() => transport);
    const events: string[] = [];
    const unsubscribe = service.subscribe((event) => {
      events.push(event.status.state);
    });
    const start = service.start();
    transport.ready();
    await start;
    const ping = service.getStatus();
    transport.exit();
    expect(await ping).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', retryable: true },
    });
    expect(await service.getStatus()).toMatchObject({
      ok: true,
      value: { state: 'unavailable', pid: null },
    });
    expect(events).toEqual(['starting', 'ready', 'unavailable']);
    unsubscribe();
    service.stop();
    expect(transport.killCount).toBe(0);
    expect(events).toHaveLength(3);
  });

  it('times out a stalled startup and rejects a late readiness message', async () => {
    const transport = new FakeTransport();
    const service = new ServiceController(() => transport, 10);
    expect(await service.start()).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(transport.killed).toBe(true);
    transport.ready();
    expect(await service.getStatus()).toMatchObject({ ok: true, value: { state: 'unavailable' } });
    service.stop();
    expect(transport.killCount).toBe(1);
  });

  it('times out a stalled ping and closes the unresponsive process', async () => {
    const transport = new FakeTransport();
    const service = new ServiceController(() => transport, 10);
    const start = service.start();
    transport.ready();
    await start;
    expect(await service.getStatus()).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(transport.killed).toBe(true);
    service.stop();
    expect(transport.killCount).toBe(1);
  });

  it('rejects malformed child output and resolves all waiting callers', async () => {
    const transport = new FakeTransport();
    const service = new ServiceController(() => transport);
    const start = service.start();
    transport.ready();
    await start;
    const pending = service.getStatus();
    transport.message({ type: 'pong', pid: 'invalid' });
    expect(await pending).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
    expect(transport.killed).toBe(true);
    service.stop();
    expect(transport.killCount).toBe(1);
  });

  it('bounds pending requests and resolves them during shutdown', async () => {
    const transport = new FakeTransport();
    const service = new ServiceController(() => transport);
    const start = service.start();
    transport.ready();
    await start;
    const pending = Array.from({ length: 32 }, () => service.getStatus());
    expect(await service.getStatus()).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    service.stop();
    expect((await Promise.all(pending)).every((result) => !result.ok)).toBe(true);
  });

  it('returns a recoverable failure when spawning fails', async () => {
    const service = new ServiceController(() => {
      throw new Error('synthetic spawn error');
    });
    expect(await service.start()).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    service.stop();
  });

  it('handles child errors without leaving startup pending', async () => {
    const transport = new FakeTransport();
    const service = new ServiceController(() => transport);
    const start = service.start();
    transport.error();
    expect(await start).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(transport.killCount).toBe(1);
    service.stop();
    expect(transport.killCount).toBe(1);
  });

  it('resolves pending requests when sending fails', async () => {
    const transport = new FakeTransport();
    transport.postMessage = () => {
      throw new Error('closed');
    };
    const service = new ServiceController(() => transport);
    const start = service.start();
    transport.ready();
    await start;
    expect(await service.getStatus()).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(transport.killCount).toBe(1);
    service.stop();
    expect(transport.killCount).toBe(1);
  });

  it.each(['error', 'send'] as const)(
    'retires the child on %s failure, clears queued work, and ignores stale events',
    async (failurePath) => {
      vi.useFakeTimers();
      try {
        const first = new FakeTransport();
        const second = new FakeTransport();
        const transports = [first, second];
        const service = new ServiceController(() => transports.shift()!);
        const startup = service.start();
        first.ready();
        await startup;
        const pending = [service.getStatus(), service.getStatus()];
        if (failurePath === 'error') first.error();
        else {
          first.postMessage = () => {
            throw new Error('synthetic send failure');
          };
          pending.push(service.getStatus());
        }
        expect(await Promise.all(pending)).toEqual(
          pending.map(() =>
            expect.objectContaining({
              ok: false,
              error: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
            }),
          ),
        );
        expect(first.killCount).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        first.ready(999);
        first.pong();
        first.exit();
        first.error();
        expect(await service.getStatus()).toMatchObject({
          ok: true,
          value: { state: 'unavailable', pid: null },
        });
        const restart = service.restart();
        first.ready(999);
        first.pong();
        first.exit();
        first.error();
        second.ready(43);
        expect(await restart).toMatchObject({ ok: true, value: { state: 'ready', pid: 43 } });
        expect(first.killCount).toBe(1);
        service.stop();
        expect(second.killCount).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(['error', 'send'] as const)(
    'settles %s failures and permits recovery even when termination throws',
    async (failurePath) => {
      const first = new FakeTransport();
      const second = new FakeTransport();
      first.kill = () => {
        ++first.killCount;
        throw new Error('synthetic termination failure');
      };
      const transports = [first, second];
      const service = new ServiceController(() => transports.shift()!);
      const startup = service.start();
      first.ready();
      await startup;
      const pending = service.getStatus();
      if (failurePath === 'error') expect(() => first.error()).not.toThrow();
      else {
        first.postMessage = () => {
          throw new Error('synthetic send failure');
        };
        expect(await service.getStatus()).toMatchObject({
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE' },
        });
      }
      expect(await pending).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
      expect(first.killCount).toBe(1);
      const restart = service.restart();
      first.ready(999);
      first.exit();
      second.ready(43);
      expect(await restart).toMatchObject({ ok: true, value: { state: 'ready', pid: 43 } });
      expect(() => service.stop()).not.toThrow();
    },
  );
});
