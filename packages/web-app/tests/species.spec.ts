import { expect, test } from '@playwright/test';

import { animalCards, speciesCards } from './support.ts';

test('lists the three species of the node as cards', async ({ page }) => {
  await page.goto('/#/species');

  const cards = speciesCards(page);
  await expect(cards).toHaveCount(3);
  for (const name of ['Chicken', 'Dog', 'Duck']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  for (const card of await cards.all()) {
    await expect(card.locator('.species-latin-name')).not.toBeEmpty();
    await expect(card.locator('.species-description')).not.toBeEmpty();
  }
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
  await expect(speciesCards(page)).toHaveCount(0);

  nodeIsBroken = false;
  await alert.getByRole('button', { name: 'Retry' }).click();

  await expect(speciesCards(page)).toHaveCount(3);
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
  await expect(speciesCards(page)).toHaveCount(0);
});

test('links a species card to its filtered animals view', async ({ page }) => {
  await page.goto('/#/species');

  await page
    .getByRole('heading', { level: 2, name: 'Duck' })
    .locator('..')
    .getByRole('link', { name: 'See animals' })
    .click();

  await expect(page).toHaveURL(/#\/animals\?species=duck$/);
  const cards = animalCards(page);
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expect(card.locator('.animal-species')).toHaveText('Duck');
  }
});
