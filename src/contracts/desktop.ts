import {
  projectResultSchema,
  type ProjectChoice,
  type ProjectCommand,
  type ProjectResult,
} from './project';
import { z } from 'zod';

export const channels = {
  closeRequest: 'loom:window:close-request',
  closeReady: 'loom:window:close-ready',
  status: 'loom:service:status',
  restart: 'loom:service:restart',
  event: 'loom:service:event',
  project: 'loom:project:command',
  chooseProject: 'loom:project:choose',
} as const;

export const operationErrorSchema = z
  .object({
    code: z.enum([
      'INVALID_REQUEST',
      'FORBIDDEN',
      'SERVICE_UNAVAILABLE',
      'TIMEOUT',
      'INVALID_RESPONSE',
      'BUSY',
    ]),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();
export type OperationError = z.infer<typeof operationErrorSchema>;
export type Result<T> = { ok: true; value: T } | { ok: false; error: OperationError };

export const serviceStatusSchema = z
  .object({
    state: z.enum(['ready', 'starting', 'unavailable']),
    pid: z.number().int().positive().nullable(),
    version: z.string().min(1).max(80),
  })
  .strict()
  .refine((status) => (status.state === 'ready') === (status.pid !== null), {
    message: 'Only a ready service has a process ID.',
  });
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export const statusResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: serviceStatusSchema }).strict(),
  z.object({ ok: z.literal(false), error: operationErrorSchema }).strict(),
]);
export const serviceEventSchema = z
  .object({
    type: z.literal('service-status'),
    status: serviceStatusSchema,
    error: operationErrorSchema.optional(),
  })
  .strict();
export type ServiceEvent = z.infer<typeof serviceEventSchema>;

// No project paths, file access, shell execution, or arbitrary IPC are exposed.
export interface LoomDesktop {
  project(command: ProjectCommand): Promise<ProjectResult>;
  chooseProject(choice: ProjectChoice): Promise<ProjectResult>;
  onCloseRequest(listener: () => void): () => void;
  completeClose(): Promise<void>;
  getStatus(): Promise<Result<ServiceStatus>>;
  restartService(): Promise<Result<ServiceStatus>>;
  onServiceEvent(listener: (event: ServiceEvent) => void): () => void;
}

export const emptyRequestSchema = z.object({}).strict();
export const serviceRequestSchema = z
  .object({
    type: z.literal('ping'),
    id: z.string().min(1).max(80),
  })
  .strict();
export const serviceMessageSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('project-result'), id: z.string(), result: projectResultSchema })
    .strict(),
  z
    .object({
      type: z.literal('ready'),
      pid: z.number().int().positive(),
      version: z.string().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal('pong'),
      id: z.string().min(1).max(80),
      pid: z.number().int().positive(),
      version: z.string().min(1).max(80),
    })
    .strict(),
]);
export type ServiceMessage = z.infer<typeof serviceMessageSchema>;

export function failure(
  code: OperationError['code'],
  message: string,
  retryable = true,
): Result<never> {
  return { ok: false, error: { code, message, retryable } };
}
