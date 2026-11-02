import { serviceRequestSchema } from '../contracts/desktop';

// The utility process owns native service work. Phase 1 only verifies transport.
const port = process.parentPort;
if (!port) throw new Error('The Loom service must run as an Electron utility process.');

port.on('message', (event: { data: unknown }) => {
  const request = serviceRequestSchema.safeParse(event.data);
  if (!request.success) return;
  port.postMessage({ type: 'pong', id: request.data.id, pid: process.pid, version: '0.1.0' });
});
port.postMessage({ type: 'ready', pid: process.pid, version: '0.1.0' });
