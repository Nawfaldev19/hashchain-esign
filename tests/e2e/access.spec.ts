import { expect, test } from '@playwright/test';
import { pathOf, readSigningLinks, signInAs } from './helpers';

test.describe('roles', () => {
  test('a viewer can read everything and change nothing', async ({ page }) => {
    await signInAs(page, 'viewer');
    await expect(page.getByText('Viewer', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New request' })).toBeHidden();

    await page.getByRole('link', { name: 'Wood shop sign-off for Elif Demir' }).click();
    await expect(page.locator('.badge', { hasText: /^Completed$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revoke' })).toBeHidden();

    await page.getByRole('link', { name: 'Templates' }).click();
    await expect(page.getByRole('button', { name: 'New template' })).toBeHidden();
    await page.getByRole('link', { name: 'Wood shop safety agreement' }).click();
    await expect(page.getByText('Read only')).toBeVisible();
    await expect(page.getByLabel('Title')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeHidden();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByText('Only an owner can change these settings.')).toBeVisible();
    await expect(page.getByLabel('Workspace name')).toBeDisabled();
  });

  test('an owner changes the branding, and the signing page shows it', async ({ page }) => {
    await signInAs(page, 'owner');
    await page.getByRole('link', { name: 'Settings' }).click();
    const save = page.getByRole('button', { name: 'Save branding' });
    await expect(save).toBeDisabled();

    await page.getByLabel('Accent colour', { exact: true }).fill('teal');
    await expect(page.getByText('Use a colour like #0F5C5C.')).toBeVisible();
    await expect(save).toBeDisabled();

    await page.getByLabel('Accent colour', { exact: true }).fill('#5B2A86');
    await save.click();
    await expect(page.getByText('Branding saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Accent colour', { exact: true })).toHaveValue('#5B2A86');
  });
});

test.describe('workspaces', () => {
  test('switching workspace shows only that workspace, with its own role', async ({ page }) => {
    await signInAs(page, 'owner');
    await expect(page.getByRole('link', { name: 'Print room hire, Saturday' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Membership for Arjun Patel' })).toBeHidden();

    await page.getByLabel('Workspace').selectOption({ label: 'Tinker Harbor Workshop' });
    await expect(page.getByRole('link', { name: 'Membership for Arjun Patel' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Print room hire, Saturday' })).toBeHidden();
    await expect(page.getByText('Viewer', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New request' })).toBeHidden();
  });

  test('a workspace the user is not in looks like one that does not exist', async ({ page }) => {
    await signInAs(page, 'editor');
    await page.goto('/w/00000000-0000-4000-8000-000000000000/requests');
    await expect(page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
  });

  test('workspace pages send signed-out visitors to the sign-in page and back', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const target = pathOf(page.url()).replace('/requests', '/templates');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: /Agreements that stay/ })).toBeVisible();

    await page.goto(target);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill('jonas@example.com');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email or password is wrong.')).toBeVisible();

    await page.getByLabel('Password').fill('makerspace-demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
    expect(pathOf(page.url())).toBe(target);
  });
});

test.describe('signing links', () => {
  test('an unknown link says so without revealing anything', async ({ page }) => {
    await page.goto('/sign/this-token-does-not-exist');
    await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
  });

  test('a new link replaces the old one, and revoking closes the request', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    await page.getByRole('button', { name: 'Awaiting signatures' }).click();
    await page.getByRole('link', { name: 'Print room hire, Saturday' }).click();

    await page.getByRole('button', { name: 'New link' }).click();
    const [first] = await readSigningLinks(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'New link' }).click();
    const [second] = await readSigningLinks(page);
    await page.getByRole('button', { name: 'Done' }).click();
    expect(second).not.toBe(first);

    const context = await browser.newContext();
    const signer = await context.newPage();
    await signer.goto(pathOf(first ?? ''));
    await expect(signer.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();

    await signer.goto(pathOf(second ?? ''));
    await expect(signer.getByRole('heading', { name: 'Studio day hire' })).toBeVisible();
    await expect(signer.getByText('Here are the hire terms for Saturday.')).toBeVisible();

    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke request' }).click();
    await expect(page.locator('.badge', { hasText: /^Revoked$/ })).toBeVisible();
    await expect(page.getByText('revoked the request')).toBeVisible();

    await signer.reload();
    await expect(signer.getByRole('heading', { name: 'This request was withdrawn' })).toBeVisible();
    await expect(signer.getByText('Here are the hire terms for Saturday.')).toBeHidden();
    await context.close();
  });
});
