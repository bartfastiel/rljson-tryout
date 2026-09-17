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

  await expect(page).toHaveTitle('Species · Duckburg Pet Shop');
  await expect(page.getByRole('banner')).toContainText('Duckburg Pet Shop');
});

test('shows the node name from /health in the header', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('node-under-test');
});

test('labels the node as unknown when /health fails', async ({ page }) => {
  await page.route('**/health', (route) => route.fulfill({ status: 503 }));

  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('unknown node');
});

test('redirects an empty hash to the species view and marks it current', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveURL(/#\/species$/);
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Species' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Species' }),
  ).toBeVisible();
});

test('redirects a bare #/ to the species view', async ({ page }) => {
  await page.goto('/#/');

  await expect(page).toHaveURL(/#\/species$/);
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
    mainNavigation(page).getByRole('link', { name: 'Species' }),
  ).not.toHaveAttribute('aria-current');

  await page.getByRole('link', { name: 'Back to Species' }).click();

  await expect(page).toHaveURL(/#\/species$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Species' }),
  ).toBeVisible();
});

test('gives every navigation item a tap target of at least 44 by 44 CSS pixels', async ({
  page,
}) => {
  await page.goto('/');
  const links = mainNavigation(page).getByRole('link');
  await expect(links).not.toHaveCount(0);

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
