import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export type DemoRole = 'owner' | 'editor' | 'viewer';

/** Signs in from the start page with one of the seeded demo accounts. */
export async function signInAs(page: Page, role: DemoRole): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: `Continue as ${role}` }).click();
  await expect(page.getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible();
}

/** Reads the signing links shown once after a request or a new link is made. */
export async function readSigningLinks(page: Page): Promise<string[]> {
  const inputs = page.getByRole('textbox', { name: /^Signing link for / });
  await expect(inputs.first()).toBeVisible();
  return inputs.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).value),
  );
}

export function pathOf(url: string): string {
  return new URL(url).pathname;
}
