import { expect, type Page } from '@playwright/test';
/** Workspace regressions explicitly pass through the startup library after a restart. */
export async function resumeFromLibrary(page: Page) {
  await expect(page.getByRole('heading', { name: 'Your projects', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Your projects' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  const project = page.locator('.library-project').first();
  if (await project.count()) await project.click();
  else {
    await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
    await page.getByRole('button', { name: 'Load read-only example', exact: true }).click();
  }
}
