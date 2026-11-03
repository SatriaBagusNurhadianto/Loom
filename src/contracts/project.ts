import { z } from 'zod';
export const relativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) =>
      !p.includes('\\') &&
      !p.includes('\0') &&
      !p.startsWith('/') &&
      p.split('/').every((s) => s !== '..' && s !== '.' && s !== ''),
    'Use a project-relative path.',
  );
const id = z.string().min(1).max(80);
export const projectCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('current') }).strict(),
  z
    .object({
      type: z.literal('sync'),
      fileId: id,
      baseline: z.string().nullable(),
      text: z.string().max(8 * 1024 * 1024),
      update: z.array(z.number().int().min(0).max(255)).max(32_000_000),
    })
    .strict(),
  z.object({ type: z.literal('refresh') }).strict(),
  z.object({ type: z.literal('load'), fileId: id }).strict(),
  z.object({ type: z.literal('search'), query: z.string().max(500) }).strict(),
  z.object({ type: z.literal('create'), path: relativePath }).strict(),
  z.object({ type: z.literal('rename'), fileId: id, path: relativePath }).strict(),
  z.object({ type: z.literal('delete'), fileId: id }).strict(),
  z.object({ type: z.literal('restore'), fileId: id }).strict(),
  z.object({ type: z.literal('root'), fileId: id }).strict(),
  z
    .object({
      type: z.literal('resolve'),
      fileId: id,
      choice: z.enum(['local', 'disk']),
      diskRevision: z.string().nullable(),
      disk: z.string().nullable(),
    })
    .strict(),
  z.object({ type: z.literal('preferences'), value: z.string().max(20000) }).strict(),
]);
export type ProjectCommand = z.infer<typeof projectCommandSchema>;
export const projectFileSchema = z
  .object({
    id,
    loaded: z.boolean(),
    path: relativePath,
    text: z.string().nullable(),
    update: z.array(z.number()),
    baseline: z.string().nullable(),
    disk: z.string().nullable(),
    diskKind: z.enum(['text', 'binary', 'missing']),
    diskRevision: z.string().nullable(),
    conflict: z.boolean(),
    deleted: z.boolean(),
    revision: z.string(),
    saved: z.boolean(),
  })
  .strict();
export type ProjectFile = z.infer<typeof projectFileSchema>;
const matchRangeSchema = z
  .object({
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
  })
  .strict();
export const searchHitSchema = z
  .object({
    fileId: id,
    path: relativePath,
    kind: z.enum(['path', 'content']),
    line: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
    snippet: z.string().max(202),
    ranges: z.array(matchRangeSchema).max(500),
    pathRanges: z.array(matchRangeSchema).max(500),
    approximate: z.boolean(),
  })
  .strict();
export type SearchHit = z.infer<typeof searchHitSchema>;
export const projectSnapshotSchema = z
  .object({
    id,
    name: z.string(),
    rootId: id.nullable(),
    files: z.array(projectFileSchema),
    preferences: z.string().nullable(),
    sourceRevision: z.string().optional(),
    matches: z.array(id).optional(),
    hits: z.array(searchHitSchema).max(200).optional(),
  })
  .strict();
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;
export const projectResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: projectSnapshotSchema.nullable() }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict(),
    })
    .strict(),
]);
export type ProjectResult = z.infer<typeof projectResultSchema>;
export type ProjectChoice = 'open' | 'create' | 'import-folder' | 'import-zip';

export const chooseFileRequestSchema = z
  .object({
    projectId: id,
    directory: relativePath.optional(),
  })
  .strict();
export type ChooseFileRequest = z.infer<typeof chooseFileRequestSchema>;
