import { expect, test } from '@playwright/test';

import {
  bodyBackgroundLuminance,
  boundingBoxOf,
  mainNavigation,
} from './support.ts';

test('loads with the application name in the tab title and the header', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Animals · Duckburg Pet Shop');
  await expect(page.getByRole('banner')).toContainText('Duckburg Pet Shop');
});

test('shows the node name from /status in the header', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('node-under-test');
});

test('labels the node as unknown when /status fails', async ({ page }) => {
  await page.route('**/status', (route) => route.fulfill({ status: 503 }));

  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('unknown node');
});

test('redirects an empty hash to the animals view and marks it current', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveURL(/#\/animals$/);
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Animals' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Animals' }),
  ).toBeVisible();
});

test('redirects a bare #/ to the animals view', async ({ page }) => {
  await page.goto('/#/');

  await expect(page).toHaveURL(/#\/animals$/);
});

test('shows a not found page with a way back for an unknown route', async ({
  page,
}) => {
  await page.goto('/#/treasure');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Page not found' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Page not found · Duckburg Pet Shop');
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Animals' }),
  ).not.toHaveAttribute('aria-current');
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Species' }),
  ).not.toHaveAttribute('aria-current');
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Breeders' }),
  ).not.toHaveAttribute('aria-current');
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Invoices' }),
  ).not.toHaveAttribute('aria-current');
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Network' }),
  ).not.toHaveAttribute('aria-current');

  await page.getByRole('link', { name: 'Back to Animals' }).click();

  await expect(page).toHaveURL(/#\/animals$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Animals' }),
  ).toBeVisible();
});

test('gives every navigation item a tap target of at least 44 by 44 CSS pixels', async ({
  page,
}) => {
  await page.goto('/');
  const links = mainNavigation(page).getByRole('link');
  await expect(links).toHaveCount(5);

  for (const link of await links.all()) {
    const box = await boundingBoxOf(link);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test('renders a light background by default', async ({ page }) => {
  await page.goto('/');

  expect(await bodyBackgroundLuminance(page)).toBeGreaterThan(0.5);
});

test.describe('with a dark colour scheme preference', () => {
  test.use({ colorScheme: 'dark' });

  test('renders a dark background', async ({ page }) => {
    await page.goto('/');

    expect(await bodyBackgroundLuminance(page)).toBeLessThan(0.1);
  });
});

test('keeps the header above the page when the node badge wraps under the title', async ({
  page,
}) => {
  // Narrow enough that the title, the live indicator and the badge of
  // `node-under-test` do not share one row, whatever font the machine has.
  await page.setViewportSize({ width: 340, height: 780 });
  await page.goto('/#/invoices');
  const badge = page.getByRole('banner').locator('.node-badge-active');
  await expect(badge).toBeVisible();

  const header = await boundingBoxOf(page.getByRole('banner'));
  const badgeBox = await boundingBoxOf(badge);
  const main = await boundingBoxOf(page.getByRole('main'));

  expect(badgeBox.y).toBeGreaterThanOrEqual(header.y);
  expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(
    header.y + header.height,
  );
  expect(main.y).toBeGreaterThanOrEqual(header.y + header.height);
  await page.getByRole('link', { name: 'New invoice' }).click();
  await expect(page).toHaveURL(/#\/invoices\/new$/);
});
