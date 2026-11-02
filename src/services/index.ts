import { serviceRequestSchema } from '../contracts/desktop';
import { projectCommandSchema } from '../contracts/project';
import { ProjectService } from './project/projects';
import { MetadataStore } from './project/store';
import { z } from 'zod';
const port = process.parentPort;
if (!port) throw new Error('The Loom service requires a parent port.');
const projects = new ProjectService(new MetadataStore(process.argv[2]));
const native = z
  .object({
    type: z.enum(['open', 'create', 'import-folder', 'import-zip']),
    path: z.string().min(1),
    destination: z.string().optional(),
  })
  .strict();
const request = z
  .object({ type: z.literal('project'), id: z.string(), command: z.unknown() })
  .strict();
port.on('message', (event: { data: unknown }) => {
  const ping = serviceRequestSchema.safeParse(event.data);
  if (ping.success) {
    port.postMessage({ type: 'pong', id: ping.data.id, pid: process.pid, version: '0.1.0' });
    return;
  }
  const parsed = request.safeParse(event.data);
  if (!parsed.success) return;
  void projects.run(async () => {
    try {
      const n = native.safeParse(parsed.data.command);
      let value;
      if (n.success) {
        const c = n.data;
        if (c.type === 'open') value = await projects.open(c.path);
        else if (c.type === 'create') value = await projects.create(c.path);
        else if (c.type === 'import-folder')
          value = await projects.importFolder(c.path, c.destination!);
        else value = await projects.importZip(c.path, c.destination!);
      } else value = await projects.command(projectCommandSchema.parse(parsed.data.command));
      port.postMessage({ type: 'project-result', id: parsed.data.id, result: { ok: true, value } });
    } catch (error) {
      port.postMessage({
        type: 'project-result',
        id: parsed.data.id,
        result: {
          ok: false,
          error: {
            code: 'PROJECT_ERROR',
            message: error instanceof Error ? error.message : 'Project operation failed.',
            retryable: true,
          },
        },
      });
    }
  });
});
port.postMessage({ type: 'ready', pid: process.pid, version: '0.1.0' });
