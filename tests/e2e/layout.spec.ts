import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signInAs } from './helpers';

/** These run twice: on a desktop viewport and on a phone-sized one. */

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('pages fit the viewport without sideways scrolling', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await signInAs(page, 'owner');
  await expectNoSidewaysScroll(page);

  await page.getByRole('link', { name: 'Wood shop sign-off for Elif Demir' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.getByRole('link', { name: 'Templates' }).click();
  await page.getByRole('link', { name: 'Wood shop safety agreement' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('the theme choice is applied before paint and survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  const lightBackground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .not.toBe(lightBackground);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

test('the system theme is the default when nothing was chosen', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the first Tab stop inside the app is a skip link to the content', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Tab order is a keyboard concern.');
  await signInAs(page, 'viewer');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
