import { expect, test } from '@playwright/test';

import {
  animalCountLine,
  animalCounts,
  cardListItems,
  listedCount,
  mainNavigation,
} from './support.ts';

test('lists every breeder with farm name, person, city and supplies since', async ({
  page,
}) => {
  await page.goto('/#/breeders');

  const cards = cardListItems(page);
  await expect(cards).toHaveCount(await listedCount(page, '/api/breeders'));
  for (const name of [
    "Grandma Duck's Farm",
    'Gearloose Workshop Hatchery',
    "Daisy's Duckling Nursery",
    'Rockerduck Kennels',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  for (const card of await cards.all()) {
    await expect(card.locator('.breeder-person')).not.toBeEmpty();
    await expect(card.locator('.breeder-city')).not.toBeEmpty();
    await expect(card.locator('.breeder-supplies-since')).toContainText(
      'Supplying since ',
    );
  }
});

test('navigates to the breeders view from the main navigation', async ({
  page,
}) => {
  await page.goto('/#/animals');

  await mainNavigation(page).getByRole('link', { name: 'Breeders' }).click();

  await expect(page).toHaveURL(/#\/breeders$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Breeders' }),
  ).toBeVisible();
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Breeders' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('a card links to the animals list filtered to that breeder', async ({
  page,
}) => {
  await page.goto('/#/breeders');

  const card = cardListItems(page).filter({ hasText: "Grandma Duck's Farm" });
  await card.click();

  await expect(page).toHaveURL(/#\/animals\?breeder=grandma-ducks-farm$/);
  const filtered = cardListItems(page);
  await expect(filtered).not.toHaveCount(0);
  await expect(animalCountLine(page)).not.toHaveText(
    new RegExp(`of ${(await animalCounts(page)).total} animals`),
  );
});

test('shows an error with a retry button when the node answers 500', async ({
  page,
}) => {
  let nodeIsBroken = true;
  await page.route('**/api/breeders', async (route) => {
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

  await page.goto('/#/breeders');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the breeders.');
  await expect(alert).toContainText('500');
  await expect(cardListItems(page)).toHaveCount(0);

  nodeIsBroken = false;
  await alert.getByRole('button', { name: 'Retry' }).click();

  await expect(cardListItems(page)).toHaveCount(
    await listedCount(page, '/api/breeders'),
  );
  await expect(alert).toHaveCount(0);
});

test('says so when the node has no breeders', async ({ page }) => {
  await page.route('**/api/breeders', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto('/#/breeders');

  await expect(page.getByRole('status')).toHaveText('No breeders yet.');
  await expect(cardListItems(page)).toHaveCount(0);
});
