import { describe, expect, it } from 'vitest';
import { defaultLayout, layoutKey, loadLayout, saveLayout } from '../src/renderer/workspace/layout';

describe('layout preferences', () => {
  it('restores a validated layout without sharing the default object', () => {
    const loaded = loadLayout({
      getItem: () => JSON.stringify({ ...defaultLayout, sidebar: 25, mode: 'pdf' }),
    });
    expect(loaded.layout.sidebar).toBe(25);
    expect(loaded.layout.mode).toBe('pdf');
    expect(loaded.warning).toBeNull();
    expect(loadLayout({ getItem: () => null }).layout).not.toBe(defaultLayout);
  });
  it.each([
    '{bad',
    JSON.stringify({ ...defaultLayout, version: 2 }),
    JSON.stringify({ ...defaultLayout, sidebar: 38, pdf: 45 }),
    JSON.stringify({ ...defaultLayout, sidebar: -5 }),
  ])('recovers from invalid storage %s', (raw) => {
    const result = loadLayout({ getItem: () => raw });
    expect(result.layout).toEqual(defaultLayout);
    expect(result.warning).toContain('Default layout restored');
  });
  it('preserves the session when storage is blocked or full', () => {
    expect(
      loadLayout({
        getItem: () => {
          throw new Error('blocked');
        },
      }).layout,
    ).toEqual(defaultLayout);
    expect(
      saveLayout(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        defaultLayout,
      ),
    ).toBe(false);
  });
  it('writes only valid versioned presentation preferences', () => {
    let saved = '';
    expect(
      saveLayout(
        {
          setItem: (key, value) => {
            expect(key).toBe(layoutKey);
            saved = value;
          },
        },
        defaultLayout,
      ),
    ).toBe(true);
    expect(JSON.parse(saved)).toEqual(defaultLayout);
  });
});
