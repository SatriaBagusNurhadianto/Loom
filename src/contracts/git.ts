import { z } from 'zod';
import { relativePath } from './project';

const projectId = z.string().min(1).max(80);
const gitPath = relativePath;
export const gitCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), projectId }).strict(),
  z
    .object({
      type: z.literal('diff'),
      projectId,
      path: gitPath,
      area: z.enum(['index', 'worktree']),
    })
    .strict(),
]);
export type GitCommand = z.infer<typeof gitCommandSchema>;

const fileSchema = z
  .object({
    path: gitPath,
    index: z.enum([' ', 'A', 'M', 'D', 'R', 'C', 'U', '?', '!']),
    worktree: z.enum([' ', 'A', 'M', 'D', 'R', 'C', 'U', '?', '!']),
    originalPath: gitPath.nullable(),
  })
  .strict();
export const gitStatusSchema = z
  .object({
    kind: z.literal('status'),
    repository: z.boolean(),
    rootName: z.string().max(255).nullable(),
    branch: z.string().max(1024).nullable(),
    upstream: z.string().max(1024).nullable(),
    detached: z.boolean(),
    mergeInProgress: z.boolean(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    files: z.array(fileSchema).max(5000),
    truncated: z.boolean(),
    gitAvailable: z.boolean(),
  })
  .strict();
export const gitDiffSchema = z
  .object({
    kind: z.literal('diff'),
    path: gitPath,
    area: z.enum(['index', 'worktree']),
    text: z.string().max(200_000),
    binary: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
export const gitValueSchema = z.union([gitStatusSchema, gitDiffSchema]);
export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitDiff = z.infer<typeof gitDiffSchema>;
export const gitResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: gitValueSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict(),
    })
    .strict(),
]);
export type GitResult = z.infer<typeof gitResultSchema>;
