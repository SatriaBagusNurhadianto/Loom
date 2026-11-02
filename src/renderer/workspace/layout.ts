import { z } from 'zod';
export const layoutKey = 'loom.workspace-layout.v1';
export const layoutSchema = z
  .object({
    version: z.literal(1),
    sidebar: z.number().min(18).max(38),
    pdf: z.number().min(22).max(45),
    sidebarOpen: z.boolean(),
    pdfOpen: z.boolean(),
    outlineOpen: z.boolean(),
    mode: z.enum(['split', 'source', 'pdf']),
    tab: z.enum(['files', 'chats']),
  })
  .strict()
  .refine((v) => v.sidebar + v.pdf <= 75);
export type Layout = z.infer<typeof layoutSchema>;
export const defaultLayout: Layout = {
  version: 1,
  sidebar: 30,
  pdf: 27,
  sidebarOpen: true,
  pdfOpen: true,
  outlineOpen: true,
  mode: 'split',
  tab: 'files',
};
export function loadLayout(storage: Pick<Storage, 'getItem'>): {
  layout: Layout;
  warning: string | null;
} {
  try {
    const saved = storage.getItem(layoutKey);
    if (!saved) return { layout: { ...defaultLayout }, warning: null };
    const result = layoutSchema.safeParse(JSON.parse(saved));
    if (!result.success) throw new Error('Invalid layout');
    return { layout: result.data, warning: null };
  } catch {
    return {
      layout: { ...defaultLayout },
      warning: 'Saved layout could not be read. Default layout restored.',
    };
  }
}
export function saveLayout(storage: Pick<Storage, 'setItem'>, layout: Layout): boolean {
  try {
    storage.setItem(layoutKey, JSON.stringify(layoutSchema.parse(layout)));
    return true;
  } catch {
    return false;
  }
}
