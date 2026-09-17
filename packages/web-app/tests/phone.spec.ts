import { expect, test } from '@playwright/test';

import {
  addAnimalToInvoice,
  animalCounts,
  boundingBoxOf,
  breederFilterChips,
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
  await expect(cardListItems(page)).toHaveCount(
    (await animalCounts(page)).firstPage,
  );

  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForFunction(() => window.scrollY === 200);

  const box = await boundingBoxOf(mainNavigation(page));
  expect(box.y + box.height).toBeCloseTo(500, 0);
});

test('does not scroll horizontally at 375 pixels', async ({ page }) => {
  await page.goto('/');
  await expect(cardListItems(page)).toHaveCount(
    (await animalCounts(page)).firstPage,
  );

  await expectNoHorizontalScroll(page);
});

test('does not scroll horizontally on the animals view at 360 by 780 pixels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(cardListItems(page)).toHaveCount(
    (await animalCounts(page)).firstPage,
  );

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
  await expect(cardListItems(page)).toHaveCount(
    (await animalCounts(page)).firstPage,
  );

  for (const chips of [speciesFilterChips(page), traitFilterChips(page)]) {
    for (const chip of await chips.all()) {
      const box = await boundingBoxOf(chip);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('keeps all three filter groups usable at 360 pixels when a breeder is active', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/#/animals?breeder=grandma-ducks-farm');
  await expect(cardListItems(page)).not.toHaveCount(0);

  await expect(speciesFilterChips(page).first()).toBeVisible();
  await expect(traitFilterChips(page).first()).toBeVisible();
  await expect(breederFilterChips(page)).toHaveCount(2);
  await expectNoHorizontalScroll(page);

  for (const chips of [
    speciesFilterChips(page),
    traitFilterChips(page),
    breederFilterChips(page),
  ]) {
    for (const chip of await chips.all()) {
      const box = await boundingBoxOf(chip);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('keeps all five navigation entries tappable with their labels readable at 360 pixels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/#/invoices');
  await expect(cardListItems(page).first()).toBeVisible();

  const links = mainNavigation(page).getByRole('link');
  await expect(links).toHaveCount(5);
  for (const [index, name] of [
    'Animals',
    'Species',
    'Breeders',
    'Invoices',
    'Network',
  ].entries()) {
    const link = links.nth(index);
    await expect(link).toHaveText(name);
    const box = await boundingBoxOf(link);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const label = link.locator('span');
    await expect(label).toBeVisible();
    const labelBox = await boundingBoxOf(label);
    expect(labelBox.width).toBeLessThanOrEqual(box.width);
    const labelIsClipped = await label.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    expect(labelIsClipped).toBe(false);
  }
  await expectNoHorizontalScroll(page);
});

test('does not scroll horizontally on the invoice form at 360 pixels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/#/invoices/new');
  await addAnimalToInvoice(page, 'Sir Quackington');
  await addAnimalToInvoice(page, 'Henrietta the Egg Champion');

  await expect(
    page.getByRole('list', { name: 'Invoice items' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expectNoHorizontalScroll(page);
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
