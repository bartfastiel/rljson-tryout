import { expect, test } from '@playwright/test';

import {
  breederFilterChips,
  cardListItems,
  speciesFilterChips,
  traitFilterChips,
} from './support.ts';

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

test('shows the trait filter with an entry per seeded trait', async ({
  page,
}) => {
  await page.goto('/#/animals');

  const chips = traitFilterChips(page);
  await expect(chips).toHaveCount(9);
  // Exact match: a loose substring match on "All" also matches trait names
  // that merely contain the letters in sequence, such as "Chronically
  // unlucky".
  await expect(chips.filter({ hasText: /^All$/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('filtering by a trait chip narrows the list and updates the hash', async ({
  page,
}) => {
  await page.goto('/#/animals');
  await expect(cardListItems(page)).toHaveCount(10);

  await traitFilterChips(page)
    .filter({ hasText: 'Has a competitive streak' })
    .click();

  await expect(page).toHaveURL(/#\/animals\?trait=competitive-streak$/);
  const filtered = cardListItems(page);
  await expect(filtered).not.toHaveCount(0);
  await expect(filtered).not.toHaveCount(10);
  await expect(
    traitFilterChips(page).filter({ hasText: 'Has a competitive streak' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('combining a species and a trait filter narrows further', async ({
  page,
}) => {
  await page.goto('/#/animals?species=chicken');
  await expect(cardListItems(page)).not.toHaveCount(0);

  await traitFilterChips(page)
    .filter({ hasText: 'Has a competitive streak' })
    .click();

  await expect(page).toHaveURL(
    /#\/animals\?species=chicken&trait=competitive-streak$/,
  );
  const filtered = cardListItems(page);
  await expect(filtered).toHaveCount(1);
  await expect(filtered.locator('.animal-name')).toHaveText(
    'Henrietta the Egg Champion',
  );
  await expect(
    speciesFilterChips(page).filter({ hasText: 'Chicken' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    traitFilterChips(page).filter({ hasText: 'Has a competitive streak' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('a deep link with a species and a trait query restores both selections', async ({
  page,
}) => {
  await page.goto('/#/animals?species=duck&trait=competitive-streak');

  await expect(
    speciesFilterChips(page).filter({ hasText: 'Duck' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    traitFilterChips(page).filter({ hasText: 'Has a competitive streak' }),
  ).toHaveAttribute('aria-current', 'page');
  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Duck');
  }
});

test('the All trait chip resets only the trait filter', async ({ page }) => {
  await page.goto('/#/animals?species=chicken&trait=competitive-streak');

  await traitFilterChips(page).filter({ hasText: /^All$/ }).click();

  await expect(page).toHaveURL(/#\/animals\?species=chicken$/);
  await expect(
    speciesFilterChips(page).filter({ hasText: 'Chicken' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('a breeder deep link filters immediately and shows the breeder summary', async ({
  page,
}) => {
  await page.goto('/#/animals?breeder=grandma-ducks-farm');

  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  await expect(cards).not.toHaveCount(10);

  const chips = breederFilterChips(page);
  await expect(chips).toHaveCount(2);
  await expect(
    chips.filter({ hasText: "Grandma Duck's Farm" }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(chips.filter({ hasText: /^All$/ })).not.toHaveAttribute(
    'aria-current',
  );
});

test('the breeder summary is absent when no breeder is selected', async ({
  page,
}) => {
  await page.goto('/#/animals');

  await expect(breederFilterChips(page)).toHaveCount(0);
});

test('the All chip in the breeder summary resets only the breeder filter', async ({
  page,
}) => {
  await page.goto(
    '/#/animals?species=dog&breeder=grandma-ducks-farm&trait=fiercely-loyal',
  );
  await expect(breederFilterChips(page).first()).toBeVisible();

  await breederFilterChips(page).filter({ hasText: /^All$/ }).click();

  await expect(page).toHaveURL(/#\/animals\?species=dog&trait=fiercely-loyal$/);
  await expect(breederFilterChips(page)).toHaveCount(0);
  await expect(
    speciesFilterChips(page).filter({ hasText: 'Dog' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    traitFilterChips(page).filter({ hasText: 'Fiercely loyal' }),
  ).toHaveAttribute('aria-current', 'page');
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
