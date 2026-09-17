import { expect, test } from '@playwright/test';

import { cardListItems, speciesFilterChips } from './support.ts';

test('lists the ten animals with species name, birth date and price', async ({
  page,
}) => {
  await page.goto('/#/animals');

  const cards = cardListItems(page);
  await expect(cards).toHaveCount(10);
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-name')).not.toBeEmpty();
    await expect(card.locator('.animal-species')).not.toBeEmpty();
    await expect(card.locator('.animal-born-on')).toContainText('Born ');
    await expect(card.locator('.animal-price')).toContainText('€');
  }
});

test('shows the species filter with an entry per seeded species', async ({
  page,
}) => {
  await page.goto('/#/animals');

  const chips = speciesFilterChips(page);
  await expect(chips).toHaveCount(4);
  for (const name of ['All', 'Chicken', 'Dog', 'Duck']) {
    await expect(chips.filter({ hasText: name })).toHaveCount(1);
  }
  await expect(chips.filter({ hasText: 'All' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('filtering by a chip narrows the list and updates the hash', async ({
  page,
}) => {
  await page.goto('/#/animals');
  await expect(cardListItems(page)).toHaveCount(10);

  await speciesFilterChips(page).filter({ hasText: 'Duck' }).click();

  await expect(page).toHaveURL(/#\/animals\?species=duck$/);
  const filtered = cardListItems(page);
  await expect(filtered).not.toHaveCount(0);
  await expect(filtered).not.toHaveCount(10);
  for (const card of await filtered.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Duck');
  }
  await expect(
    speciesFilterChips(page).filter({ hasText: 'Duck' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('a deep link with a species query filters immediately', async ({
  page,
}) => {
  await page.goto('/#/animals?species=chicken');

  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Chicken');
  }
  await expect(
    speciesFilterChips(page).filter({ hasText: 'Chicken' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('returns to the full list through the All chip', async ({ page }) => {
  await page.goto('/#/animals?species=duck');

  await speciesFilterChips(page).filter({ hasText: 'All' }).click();

  await expect(page).toHaveURL(/#\/animals$/);
  await expect(cardListItems(page)).toHaveCount(10);
});

test('shows an error with a retry button when the node answers 500', async ({
  page,
}) => {
  let nodeIsBroken = true;
  await page.route('**/api/animals*', async (route) => {
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

  await page.goto('/#/animals');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the animals.');
  await expect(alert).toContainText('500');
  await expect(cardListItems(page)).toHaveCount(0);

  nodeIsBroken = false;
  await alert.getByRole('button', { name: 'Retry' }).click();

  await expect(cardListItems(page)).toHaveCount(10);
  await expect(alert).toHaveCount(0);
});

test('says so when a species filter matches no animal', async ({ page }) => {
  await page.route('**/api/animals*', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto('/#/animals');

  await expect(page.getByRole('status')).toHaveText(
    'No animals match this filter.',
  );
  await expect(cardListItems(page)).toHaveCount(0);
});

test.describe('in a negative UTC offset time zone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('shows the seeded birth date, not the day before', async ({ page }) => {
    await page.goto('/#/animals');

    // Sir Quackington's bornOn is the date-only string "2019-08-08".
    // Parsing that as UTC midnight and rendering it in a viewer's time zone
    // eight hours behind UTC would show 2019-08-07 instead.
    const card = cardListItems(page).filter({ hasText: 'Sir Quackington' });
    const expected = await page.evaluate(() =>
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
        new Date(2019, 7, 8),
      ),
    );

    await expect(card.locator('.animal-born-on')).toHaveText(
      `Born ${expected}`,
    );
  });
});
