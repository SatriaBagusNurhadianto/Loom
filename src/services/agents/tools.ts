import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ProjectService } from '../project/projects';
import { BuildService } from '../latex/builds';
import { projectStructure } from '../latex/language';
const rpc = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
/** Small stateless Streamable HTTP MCP surface; never an agent execution loop. */
export class AgentTools {
  private server: Server | null = null;
  readonly token = randomBytes(32).toString('hex');
  url = '';
  constructor(
    private projects: ProjectService,
    private builds: BuildService,
    private projectId: string,
  ) {}
  async start() {
    this.server = createServer(async (req, res) => {
      const supplied = Buffer.from(req.headers.authorization ?? ''),
        expected = Buffer.from('Bearer ' + this.token);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected) ||
        req.url !== '/mcp'
      ) {
        res.writeHead(401).end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) throw new Error('Request too large.');
          chunks.push(chunk);
        }
        const call = rpc.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (call.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        let result: unknown;
        if (call.method === 'initialize')
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'loom-paper', version: '0.1.0' },
          };
        else if (call.method === 'ping') result = {};
        else if (call.method === 'tools/list')
          result = {
            tools: [
              {
                name: 'paper_structure',
                description: 'Inspect sections and source locations in the open paper.',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              },
              {
                name: 'pdf_status',
                description:
                  'Inspect Loom saved-source build revision, status and diagnostics. Does not execute a build.',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              },
              {
                name: 'build_pdf',
                description:
                  'Schedule a PDF build through Loom from saved source; returns build identity/status. Poll pdf_status to inspect actual completion. Unsaved author text is excluded until saved.',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              },
            ],
          };
        else if (call.method === 'tools/call') {
          const p = z
            .object({
              name: z.enum(['paper_structure', 'pdf_status', 'build_pdf']),
              arguments: z.object({}).strict().optional(),
            })
            .parse(call.params);
          const context = await this.projects.run(async () => {
            await this.projects.refresh();
            return this.projects.buildContext(this.projectId);
          });
          let value: unknown;
          if (p.name === 'paper_structure') value = projectStructure(context);
          else if (p.name === 'pdf_status') value = await this.builds.status(this.projectId);
          else {
            if (context.snapshot.files.some((f) => !f.deleted && (!f.saved || f.conflict)))
              throw new Error('Save or resolve the paper before building.');
            value = this.builds.request(this.projectId, false);
          }
          result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32601, message: 'Unknown tool method.' },
            }),
          );
          return;
        }
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            error: 'Loom tool request failed. Check the open paper, save state and tool arguments.',
          }),
        );
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Paper tools could not start.');
    this.url = `http://127.0.0.1:${address.port}/mcp`;
    return this;
  }
  async close() {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = null;
  }
}
