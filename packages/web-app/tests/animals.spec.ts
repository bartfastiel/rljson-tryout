import { expect, test, type Page } from '@playwright/test';

import {
  animalCountLine,
  animalCounts,
  animalSearchField,
  boundingBoxOf,
  breederFilterChips,
  cardListItems,
  listedCount,
  loadMoreButton,
  speciesFilterChips,
  traitFilterChips,
} from './support.ts';

/**
 * Every request of the animal list (`/api/animals?...`), never a detail
 * (`/api/animals/<id>`).
 */
const animalListRequests = /\/api\/animals\?/;

/**
 * A node with more animals than one page holds, answered from a fixed
 * list of 120 fake animals so that "Load more" can be exercised against
 * the small seed of CI as well as a bigger one. Every other endpoint still
 * reaches the real node.
 */
const mockAnimalPages = async (page: Page, total = 120): Promise<void> => {
  const animals = Array.from({ length: total }, (_, index) => ({
    id: `fake-${index + 1}`,
    hash: `hash-${index + 1}`,
    name: `Fake animal ${index + 1}`,
    speciesId: 'duck',
    speciesName: 'Duck',
    breederId: 'grandma-ducks-farm',
    breederFarmName: "Grandma Duck's Farm",
    bornOn: '2020-01-01',
    priceCents: 100 * (index + 1),
  }));
  await page.route(animalListRequests, async (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    await route.fulfill({
      status: 200,
      json: {
        items: animals.slice(offset, offset + limit),
        total,
        limit,
        offset,
      },
    });
  });
};

test('lists the first page of animals with species name, birth date and price', async ({
  page,
}) => {
  const counts = await animalCounts(page);
  await page.goto('/#/animals');

  const cards = cardListItems(page);
  await expect(cards).toHaveCount(counts.firstPage);
  await expect(animalCountLine(page)).toHaveText(
    `${counts.firstPage} of ${counts.total.toLocaleString('en-US')} animals`,
  );
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-name')).not.toBeEmpty();
    await expect(card.locator('.animal-species')).not.toBeEmpty();
    await expect(card.locator('.animal-born-on')).toContainText('Born ');
    await expect(card.locator('.animal-price')).toContainText('€');
  }
});

test('shows the species filter with an entry per species of the node', async ({
  page,
}) => {
  const speciesCount = await listedCount(page, '/api/species');
  await page.goto('/#/animals');

  const chips = speciesFilterChips(page);
  await expect(chips).toHaveCount(speciesCount + 1);
  for (const name of ['All', 'Chicken', 'Dog', 'Duck']) {
    await expect(
      chips.filter({ hasText: new RegExp(`^${name}$`) }),
    ).toHaveCount(1);
  }
  await expect(chips.filter({ hasText: /^All$/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('filtering by a chip narrows the list and updates the hash', async ({
  page,
}) => {
  const counts = await animalCounts(page);
  await page.goto('/#/animals');
  await expect(cardListItems(page)).toHaveCount(counts.firstPage);

  await speciesFilterChips(page)
    .filter({ hasText: /^Duck$/ })
    .click();

  await expect(page).toHaveURL(/#\/animals\?species=duck$/);
  const filtered = cardListItems(page);
  await expect(filtered).not.toHaveCount(0);
  await expect(animalCountLine(page)).not.toHaveText(
    new RegExp(`of ${counts.total} animals`),
  );
  for (const card of await filtered.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Duck');
  }
  await expect(
    speciesFilterChips(page).filter({ hasText: /^Duck$/ }),
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
    speciesFilterChips(page).filter({ hasText: /^Chicken$/ }),
  ).toHaveAttribute('aria-current', 'page');
});

test('returns to the full list through the All chip', async ({ page }) => {
  const counts = await animalCounts(page);
  await page.goto('/#/animals?species=duck');

  await speciesFilterChips(page).filter({ hasText: /^All$/ }).click();

  await expect(page).toHaveURL(/#\/animals$/);
  await expect(cardListItems(page)).toHaveCount(counts.firstPage);
});

test('shows the trait filter with an entry per trait of the node', async ({
  page,
}) => {
  const traitCount = await listedCount(page, '/api/traits');
  await page.goto('/#/animals');

  const chips = traitFilterChips(page);
  await expect(chips).toHaveCount(traitCount + 1);
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
  const counts = await animalCounts(page);
  await page.goto('/#/animals');
  await expect(cardListItems(page)).toHaveCount(counts.firstPage);

  await traitFilterChips(page)
    .filter({ hasText: 'Has a competitive streak' })
    .click();

  await expect(page).toHaveURL(/#\/animals\?trait=competitive-streak$/);
  const filtered = cardListItems(page);
  await expect(filtered).not.toHaveCount(0);
  await expect(animalCountLine(page)).not.toHaveText(
    new RegExp(`of ${counts.total} animals`),
  );
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
  await expect(
    filtered.filter({ hasText: 'Henrietta the Egg Champion' }),
  ).toHaveCount(1);
  for (const card of await filtered.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Chicken');
  }
  await expect(
    speciesFilterChips(page).filter({ hasText: /^Chicken$/ }),
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
    speciesFilterChips(page).filter({ hasText: /^Duck$/ }),
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
    speciesFilterChips(page).filter({ hasText: /^Chicken$/ }),
  ).toHaveAttribute('aria-current', 'page');
});

test('a breeder deep link filters immediately and shows the breeder summary', async ({
  page,
}) => {
  const counts = await animalCounts(page);
  await page.goto('/#/animals?breeder=grandma-ducks-farm');

  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  await expect(animalCountLine(page)).not.toHaveText(
    new RegExp(`of ${counts.total} animals`),
  );

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
    speciesFilterChips(page).filter({ hasText: /^Dog$/ }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    traitFilterChips(page).filter({ hasText: 'Fiercely loyal' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('searching narrows the list to matching names and species and writes the hash', async ({
  page,
}) => {
  await page.goto('/#/animals');
  const search = animalSearchField(page);
  await expect(search).toBeVisible();
  expect((await boundingBoxOf(search)).height).toBeGreaterThanOrEqual(44);

  await search.fill('quack');

  await expect(page).toHaveURL(/#\/animals\?q=quack$/);
  await expect(animalCountLine(page)).toHaveText('2 of 2 animals');
  const cards = cardListItems(page);
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: 'Sir Quackington' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Quackmore Junior' })).toHaveCount(1);
  await expect(search).toBeFocused();
});

test('a deep link with a search restores the field and the narrowed list', async ({
  page,
}) => {
  await page.goto('/#/animals?q=chicken');

  await expect(animalSearchField(page)).toHaveValue('chicken');
  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Chicken');
  }
});

test('a search and a filter combine, and the chips keep the search', async ({
  page,
}) => {
  await page.goto('/#/animals?species=duck');
  await expect(cardListItems(page)).not.toHaveCount(0);

  await animalSearchField(page).fill('sir');

  await expect(page).toHaveURL(/#\/animals\?species=duck&q=sir$/);
  const cards = cardListItems(page);
  await expect(cards).toHaveCount(1);
  await expect(cards.locator('.animal-name')).toHaveText('Sir Quackington');
  await expect(
    speciesFilterChips(page).filter({ hasText: /^Duck$/ }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    speciesFilterChips(page).filter({ hasText: /^Chicken$/ }),
  ).toHaveAttribute('href', '#/animals?species=chicken&q=sir');

  await speciesFilterChips(page)
    .filter({ hasText: /^Chicken$/ })
    .click();

  await expect(page).toHaveURL(/#\/animals\?species=chicken&q=sir$/);
  await expect(animalSearchField(page)).toHaveValue('sir');
  await expect(page.getByRole('status')).toHaveText(
    'No animals match this filter.',
  );
});

test('clearing the search restores the full list and the bare hash', async ({
  page,
}) => {
  const counts = await animalCounts(page);
  await page.goto('/#/animals?q=sir');
  await expect(cardListItems(page)).toHaveCount(1);

  await animalSearchField(page).fill('');

  await expect(page).toHaveURL(/#\/animals$/);
  await expect(cardListItems(page)).toHaveCount(counts.firstPage);
});

test('a card opened from a searched list links back to that search', async ({
  page,
}) => {
  await page.goto('/#/animals?q=sir');
  await cardListItems(page).first().click();

  await expect(page).toHaveURL(/#\/animals\/sir-quackington\?q=sir$/);
  await page.getByRole('link', { name: 'Back to Animals' }).click();

  await expect(page).toHaveURL(/#\/animals\?q=sir$/);
  await expect(animalSearchField(page)).toHaveValue('sir');
  await expect(cardListItems(page)).toHaveCount(1);
});

test('loads the next page with "Load more" until every animal is shown', async ({
  page,
}) => {
  await mockAnimalPages(page, 120);
  await page.goto('/#/animals');

  const cards = cardListItems(page);
  await expect(cards).toHaveCount(50);
  await expect(animalCountLine(page)).toHaveText('50 of 120 animals');
  const more = loadMoreButton(page);
  await expect(more).toBeVisible();
  expect((await boundingBoxOf(more)).height).toBeGreaterThanOrEqual(44);

  await more.click();

  await expect(cards).toHaveCount(100);
  await expect(animalCountLine(page)).toHaveText('100 of 120 animals');
  await expect(cards.first().locator('.animal-name')).toHaveText(
    'Fake animal 1',
  );
  await expect(cards.nth(50).locator('.animal-name')).toHaveText(
    'Fake animal 51',
  );

  await loadMoreButton(page).click();

  await expect(cards).toHaveCount(120);
  await expect(animalCountLine(page)).toHaveText('120 of 120 animals');
  await expect(loadMoreButton(page)).toHaveCount(0);
});

test('offers no "Load more" when the first page holds every animal', async ({
  page,
}) => {
  await mockAnimalPages(page, 7);
  await page.goto('/#/animals');

  await expect(cardListItems(page)).toHaveCount(7);
  await expect(animalCountLine(page)).toHaveText('7 of 7 animals');
  await expect(loadMoreButton(page)).toHaveCount(0);
});

test('shows an error with a retry button when the node answers 500', async ({
  page,
}) => {
  const counts = await animalCounts(page);
  let nodeIsBroken = true;
  await page.route(animalListRequests, async (route) => {
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

  await expect(cardListItems(page)).toHaveCount(counts.firstPage);
  await expect(alert).toHaveCount(0);
});

test('says so when a filter matches no animal', async ({ page }) => {
  await page.route(animalListRequests, (route) =>
    route.fulfill({
      status: 200,
      json: { items: [], total: 0, limit: 50, offset: 0 },
    }),
  );

  await page.goto('/#/animals');

  await expect(page.getByRole('status')).toHaveText(
    'No animals match this filter.',
  );
  await expect(cardListItems(page)).toHaveCount(0);
  await expect(loadMoreButton(page)).toHaveCount(0);
});

test.describe('in a negative UTC offset time zone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('shows the seeded birth date, not the day before', async ({ page }) => {
    await page.goto('/#/animals?q=sir');

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
