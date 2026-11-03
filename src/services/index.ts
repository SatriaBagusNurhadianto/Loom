import { latexCommandSchema, latexResultSchema, type LatexValue } from '../contracts/latex';
import { BuildService } from './latex/builds';
import { TexlabClient, projectStructure } from './latex/language';
import { join } from 'node:path';
import { serviceRequestSchema } from '../contracts/desktop';
import { projectCommandSchema } from '../contracts/project';
import { ProjectService } from './project/projects';
import { MetadataStore } from './project/store';
import { z } from 'zod';
const port = process.parentPort;
if (!port) throw new Error('The Loom service requires a parent port.');
const projects = new ProjectService(new MetadataStore(process.argv[2]));
const builds = new BuildService(projects, join(process.argv[2], 'builds'));
const language = new TexlabClient();
const latexRequest = z
  .object({ type: z.literal('latex'), id: z.string(), command: latexCommandSchema })
  .strict();
let languageQueue: Promise<unknown> = Promise.resolve();

const native = z.union([
  z
    .object({
      type: z.literal('native-create-file'),
      path: z.string().min(1),
      projectId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.enum(['native-open', 'native-create', 'native-import-folder', 'native-import-zip']),
      path: z.string().min(1),
      destination: z.string().optional(),
    })
    .strict(),
]);
const request = z
  .object({ type: z.literal('project'), id: z.string(), command: z.unknown() })
  .strict();
port.on('message', (event: { data: unknown }) => {
  const ping = serviceRequestSchema.safeParse(event.data);
  if (ping.success) {
    port.postMessage({ type: 'pong', id: ping.data.id, pid: process.pid, version: '0.1.0' });
    return;
  }
  const latex = latexRequest.safeParse(event.data);
  if (latex.success) {
    const { id, command } = latex.data;
    const execute = async () => {
      try {
        // Check project identity through the serialized boundary, then release it.
        const context = await projects.run(async () => {
          await projects.current();
          return projects.buildContext(command.projectId);
        });
        let value: LatexValue;
        if (command.type === 'status')
          value = { kind: 'state', state: await builds.status(command.projectId, command.detect) };
        else if (command.type === 'settings')
          value = {
            kind: 'state',
            state: await builds.settings(command.projectId, command.settings),
          };
        else if (command.type === 'build')
          value = { kind: 'state', state: builds.request(command.projectId, command.clean) };
        else if (command.type === 'cancel')
          value = { kind: 'state', state: builds.cancel(command.projectId) };
        else if (command.type === 'pdf')
          value = await builds.pdf(command.projectId, command.buildId);
        else if (command.type === 'forward' || command.type === 'reverse')
          value = await builds.mapping(command);
        else if (command.type === 'language') value = await language.execute(context, command);
        else value = { kind: 'structure', items: projectStructure(context) };
        port.postMessage({
          type: 'latex-result',
          id,
          result: latexResultSchema.parse({ ok: true, value }),
        });
      } catch (error) {
        port.postMessage({
          type: 'latex-result',
          id,
          result: {
            ok: false,
            error: {
              code: 'LATEX_ERROR',
              message: error instanceof Error ? error.message : 'LaTeX operation failed.',
              retryable: true,
            },
          },
        });
      }
    };
    if (command.type === 'language') {
      languageQueue = languageQueue.then(execute, execute);
    } else void execute();
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
        if (c.type === 'native-create-file') value = await projects.createFile(c.path, c.projectId);
        else if (c.type === 'native-open') value = await projects.open(c.path);
        else if (c.type === 'native-create') value = await projects.create(c.path);
        else if (c.type === 'native-import-folder')
          value = await projects.importFolder(c.path, c.destination!);
        else value = await projects.importZip(c.path, c.destination!);
      } else value = await projects.command(projectCommandSchema.parse(parsed.data.command));
      const location = projects.nativeLocation();
      if (location) port.postMessage({ type: 'project-context', ...location });
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
