import { expect, test } from '@playwright/test';

import {
  boundingBoxOf,
  cardListItems,
  expectNoHorizontalScroll,
  mainNavigation,
  speciesFilterChips,
  traitFilterChips,
  viewportOf,
} from './support.ts';

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

  // Both filter rows (species, traits) are present on this view; neither
  // must widen the page beyond the viewport.
  await expect(speciesFilterChips(page).first()).toBeVisible();
  await expect(traitFilterChips(page).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('keeps every filter chip at least 44 pixels tall on the animals view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(cardListItems(page)).toHaveCount(10);

  for (const chips of [speciesFilterChips(page), traitFilterChips(page)]) {
    for (const chip of await chips.all()) {
      const box = await boundingBoxOf(chip);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('reads the long background story comfortably on a phone', async ({
  page,
}) => {
  await page.goto('/#/animals/sir-quackington');

  const firstParagraph = page.locator('.animal-story p').first();
  await expect(firstParagraph).toBeVisible();

  const fontSize = await firstParagraph.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  expect(fontSize).toBeGreaterThanOrEqual(17);

  await expectNoHorizontalScroll(page);
});
