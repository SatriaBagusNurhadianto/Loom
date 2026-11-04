import { z } from 'zod';
export const appearanceSchema = z
  .object({
    version: z.literal(1),
    scheme: z.enum(['system', 'light', 'dark']),
    theme: z.enum(['loom', 'ocean', 'grove', 'ember', 'iris', 'rose']),
    contrast: z.number().int().min(90).max(120),
    opacity: z.number().int().min(80).max(100),
    diff: z.enum(['red-green', 'blue-amber']),
    chatWidth: z.enum(['comfortable', 'wide']),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: Appearance = {
  version: 1,
  scheme: 'dark',
  theme: 'loom',
  contrast: 100,
  opacity: 100,
  diff: 'red-green',
  chatWidth: 'wide',
};
export const appearanceKey = 'loom:appearance:v1';
export const themes = [
  {
    id: 'loom',
    name: 'Loom',
    hint: 'Graphite and blue',
    dark: '#171717',
    light: '#f1f2f5',
    accent: '#81b2ed',
    lightAccent: '#285e9e',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    hint: 'Deep blue and sea glass',
    dark: '#14212a',
    light: '#eaf2f5',
    accent: '#79cbd8',
    lightAccent: '#216878',
  },
  {
    id: 'grove',
    name: 'Grove',
    hint: 'Forest and sage',
    dark: '#19231e',
    light: '#eef2eb',
    accent: '#a1c596',
    lightAccent: '#44683b',
  },
  {
    id: 'ember',
    name: 'Ember',
    hint: 'Warm charcoal and copper',
    dark: '#29201b',
    light: '#f6eee8',
    accent: '#e5b189',
    lightAccent: '#915125',
  },
  {
    id: 'iris',
    name: 'Iris',
    hint: 'Ink and lavender',
    dark: '#221e2b',
    light: '#f1edf7',
    accent: '#b9a6e8',
    lightAccent: '#6d4ba6',
  },
  {
    id: 'rose',
    name: 'Rose',
    hint: 'Plum and rose',
    dark: '#291d26',
    light: '#f7edf1',
    accent: '#e4a1bd',
    lightAccent: '#9b3c68',
  },
] as const;
export function readAppearance(raw: string | null): Appearance {
  try {
    return appearanceSchema.parse(JSON.parse(raw ?? 'null'));
  } catch {
    return { ...defaultAppearance };
  }
}
export function applyAppearance(
  value: Appearance,
  darkSystem: boolean,
  root: HTMLElement = document.documentElement,
) {
  const dark = value.scheme === 'system' ? darkSystem : value.scheme === 'dark';
  const theme = themes.find((theme) => theme.id === value.theme)!;
  root.dataset.scheme = dark ? 'dark' : 'light';
  root.dataset.theme = value.theme;
  root.dataset.diff = value.diff;
  root.dataset.chatWidth = value.chatWidth;
  root.style.setProperty('--theme-base', dark ? theme.dark : theme.light);
  root.style.setProperty('--theme-accent', dark ? theme.accent : theme.lightAccent);
  root.style.setProperty('--appearance-opacity', `${value.opacity}%`);
  root.style.setProperty('--appearance-contrast', `${value.contrast - 90}%`);
}
