import { expect, test } from '@playwright/test';

import {
  boundingBoxOf,
  mainNavigation,
  speciesCards,
  viewportOf,
} from './support.ts';

test('shows the navigation as a sidebar instead of a bottom bar', async ({
  page,
}) => {
  await page.goto('/');
  const navigation = mainNavigation(page);
  await expect(navigation).toBeVisible();

  const box = await boundingBoxOf(navigation);
  const viewport = viewportOf(page);
  expect(box.x).toBe(0);
  expect(box.width).toBeLessThan(viewport.width / 3);
  expect(box.height).toBeGreaterThan(box.width);
  expect(box.y + box.height).toBeCloseTo(viewport.height, 0);

  const main = await boundingBoxOf(page.getByRole('main'));
  expect(main.x).toBeGreaterThanOrEqual(box.x + box.width);
});

test('lays the species cards out in more than one column', async ({ page }) => {
  await page.goto('/');
  const cards = speciesCards(page);
  await expect(cards).toHaveCount(3);

  const first = await boundingBoxOf(cards.nth(0));
  const second = await boundingBoxOf(cards.nth(1));
  expect(second.y).toBe(first.y);
  expect(second.x).toBeGreaterThan(first.x + first.width);
});
