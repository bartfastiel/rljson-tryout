import { expect, test } from '@playwright/test';

import { cardListItems, expectImageLoaded, listedCount } from './support.ts';

test('lists every species of the node as a card', async ({ page }) => {
  await page.goto('/#/species');

  const cards = cardListItems(page);
  await expect(cards).toHaveCount(await listedCount(page, '/api/species'));
  for (const name of ['Chicken', 'Dog', 'Duck']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  for (const card of await cards.all()) {
    await expect(card.locator('.species-latin-name')).not.toBeEmpty();
    await expect(card.locator('.species-description')).not.toBeEmpty();
  }
});

test('shows the image of every species, named after the species and loaded with real pixels', async ({
  page,
}) => {
  const listed = (await (await page.request.get('/api/species')).json()) as {
    name: string;
    imageUrl: string;
  }[];
  await page.goto('/#/species');

  const images = page.getByRole('main').locator('img.species-image');
  await expect(images).toHaveCount(listed.length);
  for (const species of listed) {
    const image = page.getByRole('img', { name: species.name, exact: true });
    await expect(image).toHaveAttribute('src', species.imageUrl);
    await expectImageLoaded(image);
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(150);
    expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
  }
});

test('serves a species image as PNG and answers 404 for an unknown hash', async ({
  page,
}) => {
  const [species] = (await (await page.request.get('/api/species')).json()) as {
    imageUrl: string;
  }[];

  const image = await page.request.get(species.imageUrl);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  expect(image.headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  );
  expect([...(await image.body()).subarray(0, 4)]).toStrictEqual([
    0x89, 0x50, 0x4e, 0x47,
  ]);

  const unknown = await page.request.get(
    '/api/species/NoSuchSpeciesVersion00/image',
  );
  expect(unknown.status()).toBe(404);
});

test('shows the full description of a species', async ({ page }) => {
  await page.goto('/#/species');

  await expect(
    page.getByText(
      'Not every dog is a Beagle Boy, but every Beagle Boy is a dog.',
    ),
  ).toBeVisible();
});

test('shows an error with a retry button when the node answers 500', async ({
  page,
}) => {
  let nodeIsBroken = true;
  await page.route('**/api/species', async (route) => {
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

  await page.goto('/#/species');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the species.');
  await expect(alert).toContainText('500');
  await expect(cardListItems(page)).toHaveCount(0);

  nodeIsBroken = false;
  await alert.getByRole('button', { name: 'Retry' }).click();

  await expect(cardListItems(page)).toHaveCount(
    await listedCount(page, '/api/species'),
  );
  await expect(alert).toHaveCount(0);
});

test('shows an error when the network fails', async ({ page }) => {
  await page.route('**/api/species', (route) => route.abort('failed'));

  await page.goto('/#/species');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the species.');
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('says so when the node has no species', async ({ page }) => {
  await page.route('**/api/species', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto('/#/species');

  await expect(page.getByRole('status')).toHaveText('No species yet.');
  await expect(cardListItems(page)).toHaveCount(0);
});

test('links a species card to its filtered animals view', async ({ page }) => {
  await page.goto('/#/species');

  await page
    .getByRole('heading', { level: 2, name: 'Duck' })
    .locator('..')
    .getByRole('link', { name: 'See animals' })
    .click();

  await expect(page).toHaveURL(/#\/animals\?species=duck$/);
  const cards = cardListItems(page);
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Duck');
  }
});
