import { z } from 'zod';
import { relativePath } from './project';

const projectId = z.string().min(1).max(80);
const gitPath = relativePath;
export const gitRemoteSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((value) => {
    if (/[\u0000-\u0020]/.test(value)) return false;
    if (value.startsWith('https://')) {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !!url.hostname &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }
    if (value.startsWith('file://')) {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'file:' &&
          (!url.hostname || url.hostname === 'localhost') &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }
    return (
      /^(?:git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+|ssh:\/\/git@[A-Za-z0-9.-]+\/[A-Za-z0-9._/-]+)$/.test(
        value,
      ) && !value.includes('..')
    );
  }, 'Use an HTTPS URL without embedded credentials or a standard SSH Git remote.');
export const gitCloneRequestSchema = z.object({ url: gitRemoteSchema }).strict();
export const gitCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), projectId }).strict(),
  z
    .object({
      type: z.literal('diff'),
      projectId,
      path: gitPath,
      area: z.enum(['index', 'worktree', 'base', 'ours', 'theirs']),
    })
    .strict(),
  z.object({ type: z.enum(['stage', 'unstage']), projectId, path: gitPath }).strict(),
  z
    .object({
      type: z.literal('resolve'),
      projectId,
      path: gitPath,
      choice: z.enum(['working', 'ours', 'theirs']),
    })
    .strict(),
  z
    .object({
      type: z.literal('commit'),
      projectId,
      message: z.string().min(1).max(2000),
      expectedIndexTree: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    })
    .strict(),
  z.object({ type: z.enum(['fetch', 'pull', 'push']), projectId }).strict(),
  z.object({ type: z.literal('preflight'), projectId }).strict(),
  z
    .object({ type: z.literal('archive'), projectId, expectedRevision: z.string().min(1).max(128) })
    .strict(),
  z
    .object({
      type: z.literal('branch'),
      projectId,
      name: z.string().min(1).max(200),
      action: z.enum(['create', 'switch']),
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
    indexTree: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
      .nullable(),
    branches: z.array(z.string().max(1024)).max(500),
  })
  .strict();
export const gitDiffSchema = z
  .object({
    kind: z.literal('diff'),
    path: gitPath,
    area: z.enum(['index', 'worktree', 'base', 'ours', 'theirs']),
    text: z.string().max(200_000),
    binary: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
export const sourcePreflightSchema = z
  .object({
    kind: z.literal('preflight'),
    revision: z.string().min(1).max(128),
    included: z.array(gitPath).max(2000),
    excluded: z.array(z.object({ path: gitPath, reason: z.string().max(160) }).strict()).max(2000),
    warnings: z.array(z.string().max(500)).max(100),
  })
  .strict();
export const sourceArchiveSchema = z
  .object({
    kind: z.literal('archive'),
    revision: z.string().min(1).max(128),
    included: z.array(gitPath).max(2000),
    excluded: z.array(z.object({ path: gitPath, reason: z.string().max(160) }).strict()).max(2000),
    bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength <= 64 * 1024 * 1024),
  })
  .strict();
export const gitValueSchema = z.union([
  gitStatusSchema,
  gitDiffSchema,
  sourcePreflightSchema,
  sourceArchiveSchema,
]);
export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitDiff = z.infer<typeof gitDiffSchema>;
export type SourcePreflight = z.infer<typeof sourcePreflightSchema>;
export type SourceArchive = z.infer<typeof sourceArchiveSchema>;
export type GitValue = z.infer<typeof gitValueSchema>;
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
export const sourceExportRequestSchema = z
  .object({ projectId, revision: z.string().min(1).max(128) })
  .strict();
export type SourceExportRequest = z.infer<typeof sourceExportRequestSchema>;
export const sourceExportResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      value: z
        .object({
          cancelled: z.boolean(),
          included: z.number().int().nonnegative(),
          excluded: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict(),
    })
    .strict(),
]);
