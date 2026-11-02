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
      update: z.array(z.number().int().min(0).max(255)).max(32_000_000),
    })
    .strict(),
  z.object({ type: z.literal('refresh') }).strict(),
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
      disk: z.string().nullable(),
    })
    .strict(),
  z.object({ type: z.literal('preferences'), value: z.string().max(20000) }).strict(),
]);
export type ProjectCommand = z.infer<typeof projectCommandSchema>;
export const projectFileSchema = z
  .object({
    id,
    path: relativePath,
    text: z.string().nullable(),
    update: z.array(z.number()),
    baseline: z.string().nullable(),
    disk: z.string().nullable(),
    conflict: z.boolean(),
    deleted: z.boolean(),
    revision: z.string(),
    saved: z.boolean(),
  })
  .strict();
export type ProjectFile = z.infer<typeof projectFileSchema>;
export const projectSnapshotSchema = z
  .object({
    id,
    name: z.string(),
    rootId: id.nullable(),
    files: z.array(projectFileSchema),
    preferences: z.string().nullable(),
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
