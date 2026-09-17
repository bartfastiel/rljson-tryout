import { expect, test } from '@playwright/test';

import {
  animalDetailTraitChips,
  cardListItems,
  speciesFilterChips,
  traitFilterChips,
} from './support.ts';

test("a card links to the animal's detail page", async ({ page }) => {
  await page.goto('/#/animals');

  const firstCard = cardListItems(page).first();
  const name = await firstCard.locator('.animal-name').innerText();

  await firstCard.click();

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
});

test('renders the name, species, facts and full story of the long seeded animal', async ({
  page,
}) => {
  await page.goto('/#/animals/sir-quackington');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Sir Quackington' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Sir Quackington · Duckburg Pet Shop');

  const speciesLink = page
    .locator('.animal-facts')
    .getByRole('link', { name: 'Duck', exact: true });
  await expect(speciesLink).toBeVisible();

  const story = page.locator('.animal-story');
  await expect(story).toBeVisible();

  const paragraphs = story.locator('p');
  const paragraphCount = await paragraphs.count();
  expect(paragraphCount).toBeGreaterThan(1);

  let totalLength = 0;
  for (const text of await paragraphs.allInnerTexts()) {
    totalLength += text.length;
  }
  expect(totalLength).toBeGreaterThanOrEqual(4000);
});

test('links the species fact to the filtered animals list', async ({
  page,
}) => {
  await page.goto('/#/animals/sir-quackington');

  await page
    .locator('.animal-facts')
    .getByRole('link', { name: 'Duck', exact: true })
    .click();

  await expect(page).toHaveURL(/#\/animals\?species=duck$/);
  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Duck');
  }
});

test('shows trait chips and tapping one filters the animals list', async ({
  page,
}) => {
  await page.goto('/#/animals/sir-quackington');

  const chips = animalDetailTraitChips(page);
  await expect(chips).toHaveCount(4);
  const loyalChip = chips.filter({ hasText: 'Fiercely loyal' });
  await expect(loyalChip).toBeVisible();
  const box = await loyalChip.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await loyalChip.click();

  await expect(page).toHaveURL(/#\/animals\?trait=fiercely-loyal$/);
  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  await expect(
    traitFilterChips(page).filter({ hasText: 'Fiercely loyal' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('shows the not-found view for an unknown animal id', async ({ page }) => {
  await page.goto('/#/animals/no-such-animal');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Page not found' }),
  ).toBeVisible();
  await expect(page.getByText('no-such-animal')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Animals' }).click();

  await expect(page).toHaveURL(/#\/animals$/);
  await expect(cardListItems(page)).toHaveCount(10);
});

test('shows an error with a retry button when the node answers 500', async ({
  page,
}) => {
  let nodeIsBroken = true;
  await page.route('**/api/animals/sir-quackington', async (route) => {
    if (nodeIsBroken) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'store unavailable',
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto('/#/animals/sir-quackington');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the animal.');
  await expect(alert).toContainText('500');

  nodeIsBroken = false;
  await alert.getByRole('button', { name: 'Retry' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Sir Quackington' }),
  ).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test('the back link returns to the filtered list the detail was opened from', async ({
  page,
}) => {
  await page.goto('/#/animals?species=duck');
  await speciesFilterChips(page).filter({ hasText: 'Duck' }).first().waitFor();

  const firstDuckCard = cardListItems(page).first();
  await firstDuckCard.click();

  await expect(page).toHaveURL(/#\/animals\/[^?]+\?species=duck$/);

  await page.getByRole('link', { name: /Back to Animals/ }).click();

  await expect(page).toHaveURL(/#\/animals\?species=duck$/);
  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Duck');
  }
});

test('the back link returns to the full list when opened without a filter', async ({
  page,
}) => {
  await page.goto('/#/animals');

  await cardListItems(page).first().click();
  await expect(page).toHaveURL(/#\/animals\/[^?]+$/);

  await page.getByRole('link', { name: /Back to Animals/ }).click();

  await expect(page).toHaveURL(/#\/animals$/);
  await expect(cardListItems(page)).toHaveCount(10);
});
