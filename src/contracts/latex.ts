import { z } from 'zod';
import { relativePath } from './project';

const id = z.string().min(1).max(80);
export const toolNames = [
  'latexmk',
  'pdflatex',
  'xelatex',
  'lualatex',
  'bibtex',
  'biber',
  'synctex',
  'texlab',
] as const;
export const buildSettingsSchema = z
  .object({
    engine: z.enum(['pdflatex', 'xelatex', 'lualatex']),
    bibliography: z.enum(['auto', 'bibtex', 'biber', 'none']),
    recipe: z.literal('latexmk'),
    autoBuild: z.boolean(),
    delayMs: z.number().int().min(750).max(10000),
  })
  .strict();
export const defaultBuildSettings: BuildSettings = {
  engine: 'pdflatex',
  bibliography: 'auto',
  recipe: 'latexmk',
  autoBuild: false,
  delayMs: 1500,
};
export type BuildSettings = z.infer<typeof buildSettingsSchema>;
export const portableBuildSchema = z
  .object({ version: z.literal(1), root: relativePath, settings: buildSettingsSchema })
  .strict();
export const toolSchema = z
  .object({ name: z.enum(toolNames), available: z.boolean(), version: z.string().max(500) })
  .strict();
const position = z
  .object({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() })
  .strict();
export const locationSchema = z
  .object({
    path: relativePath,
    line: z.number().int().positive(),
    column: z.number().int().nonnegative(),
  })
  .strict();
export type SourceLocation = z.infer<typeof locationSchema>;
export const diagnosticSchema = z
  .object({
    path: relativePath.nullable(),
    line: z.number().int().positive(),
    column: z.number().int().nonnegative(),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string().max(3000),
  })
  .strict();
export type LatexDiagnostic = z.infer<typeof diagnosticSchema>;
export const buildRecordSchema = z
  .object({
    id,
    projectId: id,
    revision: z.string(),
    root: relativePath,
    settings: buildSettingsSchema,
    status: z.enum(['running', 'succeeded', 'failed', 'cancelled', 'interrupted']),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    log: z.string().max(150000),
    diagnostics: z.array(diagnosticSchema).max(500),
    tools: z.array(toolSchema),
    hasPdf: z.boolean(),
    hasSynctex: z.boolean(),
  })
  .strict();
export type BuildRecord = z.infer<typeof buildRecordSchema>;
export const buildStateSchema = z
  .object({
    projectId: id,
    settings: buildSettingsSchema,
    tools: z.array(toolSchema),
    current: buildRecordSchema.nullable(),
    successful: buildRecordSchema.nullable(),
    queued: z.boolean(),
  })
  .strict();
export type BuildState = z.infer<typeof buildStateSchema>;
export const latexCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), projectId: id, detect: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('settings'), projectId: id, settings: buildSettingsSchema }).strict(),
  z.object({ type: z.literal('build'), projectId: id, clean: z.boolean() }).strict(),
  z.object({ type: z.literal('cancel'), projectId: id }).strict(),
  z.object({ type: z.literal('pdf'), projectId: id, buildId: id }).strict(),
  z
    .object({
      type: z.literal('forward'),
      projectId: id,
      buildId: id,
      path: relativePath,
      line: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('reverse'),
      projectId: id,
      buildId: id,
      page: z.number().int().positive(),
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('language'),
      projectId: id,
      fileId: id,
      version: z.number().int().nonnegative(),
      text: z.string().max(8 * 1024 * 1024),
      action: z.enum(['update', 'completion', 'definition']),
      position,
    })
    .strict(),
  z.object({ type: z.literal('structure'), projectId: id }).strict(),
]);
export type LatexCommand = z.infer<typeof latexCommandSchema>;
export const completionSchema = z
  .object({
    label: z.string().max(1000),
    text: z.string().max(20000),
    detail: z.string().max(2000),
    from: position.nullable(),
    to: position.nullable(),
  })
  .strict();
export const structureItemSchema = locationSchema
  .extend({ kind: z.enum(['section', 'label', 'citation', 'figure']), title: z.string().max(1000) })
  .strict();
export type StructureItem = z.infer<typeof structureItemSchema>;
export const latexValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('state'), state: buildStateSchema }).strict(),
  z
    .object({
      kind: z.literal('pdf'),
      buildId: id,
      revision: z.string(),
      data: z.string().max(48 * 1024 * 1024),
    })
    .strict(),
  z
    .object({
      kind: z.literal('forward'),
      page: z.number().int().positive(),
      x: z.number(),
      y: z.number(),
    })
    .strict(),
  locationSchema.extend({ kind: z.literal('reverse') }).strict(),
  z
    .object({
      kind: z.literal('language'),
      version: z.number().int().nonnegative(),
      available: z.boolean(),
      message: z.string().max(1000),
      diagnostics: z.array(diagnosticSchema).max(500),
      completions: z.array(completionSchema).max(200),
      locations: z.array(locationSchema).max(50),
    })
    .strict(),
  z
    .object({ kind: z.literal('structure'), items: z.array(structureItemSchema).max(2000) })
    .strict(),
  z.object({ kind: z.literal('export'), cancelled: z.boolean() }).strict(),
]);
export type LatexValue = z.infer<typeof latexValueSchema>;
export const latexResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: latexValueSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict(),
    })
    .strict(),
]);
export type LatexResult = z.infer<typeof latexResultSchema>;
export const exportPdfSchema = z
  .object({ projectId: id, buildId: id, stale: z.boolean() })
  .strict();
