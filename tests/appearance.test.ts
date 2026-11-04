import { expect, it } from 'vitest';
import {
  applyAppearance,
  defaultAppearance,
  readAppearance,
} from '../src/renderer/appearance/preferences';
it('validates saved appearance without trusting unsupported or out-of-range settings', () => {
  expect(readAppearance(null)).toEqual(defaultAppearance);
  expect(readAppearance('{broken')).toEqual(defaultAppearance);
  expect(readAppearance(JSON.stringify({ ...defaultAppearance, opacity: 0 }))).toEqual(
    defaultAppearance,
  );
  expect(readAppearance(JSON.stringify({ ...defaultAppearance, version: 99 }))).toEqual(
    defaultAppearance,
  );
  const saved = {
    ...defaultAppearance,
    scheme: 'system',
    theme: 'ocean',
    diff: 'blue-amber',
    contrast: 110,
  } as const;
  expect(readAppearance(JSON.stringify(saved))).toEqual(saved);
});
it('resolves system appearance and maps each choice onto shared runtime tokens', () => {
  const values = new Map<string, string>();
  const root = {
    dataset: {},
    style: { setProperty: (key: string, value: string) => values.set(key, value) },
  } as unknown as HTMLElement;
  const preference = {
    ...defaultAppearance,
    scheme: 'system',
    theme: 'ocean',
    opacity: 90,
  } as const;
  applyAppearance(preference, false, root);
  expect(root.dataset.scheme).toBe('light');
  expect(values.get('--theme-base')).toBe('#eaf2f5');
  expect(values.get('--appearance-opacity')).toBe('90%');
  applyAppearance(preference, true, root);
  expect(root.dataset.scheme).toBe('dark');
  expect(values.get('--theme-base')).toBe('#14212a');
});
