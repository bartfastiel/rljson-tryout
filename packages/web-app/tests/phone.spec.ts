import { expect, test, type Page } from '@playwright/test';

import {
  boundingBoxOf,
  cardListItems,
  mainNavigation,
  viewportOf,
} from './support.ts';

const expectNoHorizontalScroll = async (page: Page): Promise<void> => {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
};

test('docks the navigation to the bottom edge of the viewport', async ({
  page,
}) => {
  await page.goto('/');
  const navigation = mainNavigation(page);
  await expect(navigation).toBeVisible();

  const box = await boundingBoxOf(navigation);
  const viewport = viewportOf(page);
  expect(box.x).toBe(0);
  expect(box.width).toBe(viewport.width);
  expect(box.y + box.height).toBeCloseTo(viewport.height, 0);
  expect(box.height).toBeLessThan(120);
});

test('keeps the navigation at the bottom while the content scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 500 });
  await page.goto('/');
  await expect(cardListItems(page)).toHaveCount(10);

  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForFunction(() => window.scrollY === 200);

  const box = await boundingBoxOf(mainNavigation(page));
  expect(box.y + box.height).toBeCloseTo(500, 0);
});

test('does not scroll horizontally at 375 pixels', async ({ page }) => {
  await page.goto('/');
  await expect(cardListItems(page)).toHaveCount(10);

  await expectNoHorizontalScroll(page);
});

test('does not scroll horizontally on the animals view at 360 by 780 pixels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(cardListItems(page)).toHaveCount(10);

  await expectNoHorizontalScroll(page);
});
