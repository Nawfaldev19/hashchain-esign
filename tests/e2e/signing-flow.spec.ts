import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { pathOf, readSigningLinks, signInAs } from './helpers';

/**
 * The main journey, end to end: an editor writes and publishes a template, sends
 * it to two people, both sign through their private links, and staff see the
 * completed request, verify its history and download the signed PDF.
 */
test('write, publish, send, sign twice, verify and download', async ({ page, browser }) => {
  const title = `Kiln room agreement ${String(Date.now())}`;
  await signInAs(page, 'editor');

  await test.step('create a template', async () => {
    await page.getByRole('link', { name: 'Templates' }).click();
    await page.getByRole('button', { name: 'New template' }).click();
    const dialog = page.getByRole('dialog', { name: 'New template' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Description (optional)').fill('Rules for firing the kiln.');
    await dialog.getByRole('button', { name: 'Create and edit' }).click();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText('Never published')).toBeVisible();
  });

  await test.step('build the document and see why it cannot be published yet', async () => {
    const add = page.getByRole('group', { name: 'Add a field' });
    await add.getByRole('button', { name: 'Checkbox' }).click();
    await page
      .getByRole('listitem', { name: 'Field 1: Checkbox' })
      .getByLabel('Question')
      .fill('I will never open a hot kiln');

    await expect(page.getByText('Add at least one signature block.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish version 1' })).toBeDisabled();

    await add.getByRole('button', { name: 'Signature' }).click();
    await page
      .getByRole('listitem', { name: 'Field 2: Signature' })
      .getByLabel('Signer label')
      .fill('Member');
    await add.getByRole('button', { name: 'Signature' }).click();
    await page
      .getByRole('listitem', { name: 'Field 3: Signature' })
      .getByLabel('Signer label')
      .fill('Kiln keeper');

    await page
      .getByRole('listitem', { name: 'Field 1: I will never open a hot kiln' })
      .getByLabel('Filled in by')
      .selectOption({ label: 'Member' });
    await expect(page.getByText('Before this draft can be published:')).toBeHidden();

    await page.getByRole('button', { name: 'Move Kiln keeper up' }).click();
    await expect(page.getByRole('listitem', { name: 'Field 2: Kiln keeper' })).toBeVisible();
  });

  await test.step('save and publish', async () => {
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Unsaved changes')).toBeHidden();
    await page.getByRole('button', { name: 'Publish version 1' }).click();
    await expect(page.getByText(/Version 1 published/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish version 2' })).toBeDisabled();
  });

  let links: string[] = [];
  await test.step('send it to two signers', async () => {
    await page.getByRole('link', { name: 'Requests' }).click();
    await page.getByRole('button', { name: 'New request' }).click();
    const dialog = page.getByRole('dialog', { name: 'New signing request' });
    await dialog.getByLabel('Template').selectOption({ label: `${title} (version 1)` });
    await dialog.getByLabel('Name of the member').fill('Elif Demir');
    await dialog.getByLabel('Email of the member').fill('elif@example.com');
    await dialog.getByLabel('Name of the kiln keeper').fill('Kofi Mensah');
    await dialog.getByLabel('Email of the kiln keeper').fill('kofi@example.com');
    await dialog.getByRole('button', { name: 'Create request' }).click();

    links = await readSigningLinks(page);
    expect(links).toHaveLength(2);
    await dialog.getByRole('button', { name: 'Open the request' }).click();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText('Awaiting signatures')).toBeVisible();
  });

  await test.step('the member signs in a browser with no session', async () => {
    const context = await browser.newContext();
    const signer = await context.newPage();
    const memberLink = links.find((link) => link.length > 0) ?? '';
    await signer.goto(pathOf(memberLink));
    await expect(signer.getByRole('heading', { name: title, level: 1 })).toBeVisible();

    const openedAs = await signer
      .getByText(/^(Elif Demir|Kofi Mensah)$/)
      .first()
      .textContent();
    const isMember = openedAs === 'Elif Demir';
    if (isMember) {
      await signer.getByRole('button', { name: 'Sign document' }).click();
      await expect(signer.getByText('You need to tick this box to continue.')).toBeVisible();
      await signer.getByLabel(/I will never open a hot kiln/).check();
    }
    await signer.getByRole('button', { name: 'Type your name' }).click();
    await signer.getByLabel('Your full name').fill(openedAs ?? 'Signer');
    await signer.getByRole('button', { name: 'Sign document' }).click();
    await expect(signer.getByText(/Your signature is recorded/)).toBeVisible();
    await context.close();
  });

  await test.step('the request shows as partly signed', async () => {
    await page.reload();
    await expect(page.getByText('Partly signed')).toBeVisible();
  });

  await test.step('the second signer draws a signature', async () => {
    const context = await browser.newContext();
    const signer = await context.newPage();
    await signer.goto(pathOf(links[1] ?? ''));
    // Wait for the form to render so the checkbox check below does not race the page load.
    await expect(signer.getByRole('button', { name: 'Sign document' })).toBeVisible();
    const checkbox = signer.getByLabel(/I will never open a hot kiln/);
    if (await checkbox.isVisible()) await checkbox.check();

    const pad = signer.getByTestId('signature-pad');
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox();
    if (!box) throw new Error('The signature pad is not visible.');
    await signer.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6);
    await signer.mouse.down();
    await signer.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.25, { steps: 8 });
    await signer.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.7, { steps: 8 });
    await signer.mouse.up();
    await expect(signer.getByRole('img', { name: 'Your drawn signature' })).toBeVisible();

    await signer.getByRole('button', { name: 'Sign document' }).click();
    await expect(signer.getByText('Everyone has signed. This document is complete.')).toBeVisible();
    await context.close();
  });

  await test.step('staff see it completed, with an intact history', async () => {
    await page.reload();
    await expect(page.locator('.badge', { hasText: /^Completed$/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Drawn signature of / })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revoke' })).toBeHidden();

    await page.getByRole('button', { name: 'Verify history' }).click();
    await expect(
      page.getByText(/The history is intact\. All \d+ events fit the hash chain/),
    ).toBeVisible();
    await expect(page.getByText('collected every signature')).toBeVisible();
  });

  await test.step('the signed copy downloads as a PDF', async () => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^kiln-room-agreement-\d+\.pdf$/);
    const file = await readFile(await download.path());
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.byteLength).toBeGreaterThan(2000);
  });
});
