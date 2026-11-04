import { z } from 'zod';
import { relativePath, projectSnapshotSchema } from './project';
export const referenceSchema = z
  .object({
    id: z.string().max(1500),
    provider: z.enum(['local', 'arxiv', 'zotero']),
    key: z.string().max(200),
    title: z.string().max(20000),
    authors: z.string().max(20000),
    year: z.string().max(100),
    doi: z.string().max(1000),
    url: z.string().max(2000),
    abstract: z.string().max(100000),
    bibtex: z.string().max(200000),
    path: z.string().max(1024),
    issues: z.array(z.string().max(500)).max(30),
  })
  .strict();
export type Reference = z.infer<typeof referenceSchema>;
export const researchCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('search'),
      projectId: z.string().max(80),
      requestId: z.string().max(80),
      provider: z.enum(['local', 'arxiv', 'zotero']),
      query: z.string().max(500),
    })
    .strict(),
  z.object({ type: z.literal('cancel'), requestId: z.string().max(80) }).strict(),
  z
    .object({
      type: z.literal('cite'),
      projectId: z.string().max(80),
      sourcePath: relativePath,
      sourceText: z.string().max(8 * 1024 * 1024),
      offset: z.number().int().nonnegative(),
      bibPath: relativePath,
      bibText: z
        .string()
        .max(8 * 1024 * 1024)
        .nullable(),
      record: referenceSchema,
      key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._+/-]{0,199}$/),
      command: z.enum(['cite', 'citep', 'citet', 'autocite', 'parencite', 'textcite']),
    })
    .strict(),
  z
    .object({
      type: z.literal('recovery'),
      projectId: z.string().max(80),
      action: z.enum(['inspect', 'finish', 'undo']),
    })
    .strict(),
]);
export type ResearchCommand = z.infer<typeof researchCommandSchema>;
export const researchValueSchema = z
  .object({
    records: z.array(referenceSchema).max(5000),
    warnings: z.array(z.string().max(1000)).max(500),
    snapshot: projectSnapshotSchema.nullable(),
    message: z.string().max(2000),
    recovery: z.boolean(),
  })
  .strict();
export type ResearchValue = z.infer<typeof researchValueSchema>;
export const researchResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: researchValueSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict(),
    })
    .strict(),
]);
export type ResearchResult = z.infer<typeof researchResultSchema>;
