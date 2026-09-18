import { expect, test, type Page } from '@playwright/test';

import {
  boundingBoxOf,
  cardListItems,
  expectImageLoaded,
  listedCount,
  solidPng,
} from './support.ts';

type ListedSpecies = {
  id: string;
  hash: string;
  name: string;
  imageUrl: string;
};

const listedSpecies = async (page: Page): Promise<ListedSpecies[]> =>
  (await (await page.request.get('/api/species')).json()) as ListedSpecies[];

/**
 * Both projects upload against one node, and an upload writes a new
 * species version for every other test, so each project uploads to a
 * species of its own; the third species stays as seeded for the tests
 * that read a species image by hash.
 */
const speciesForUpload: Record<string, { id: string; name: string }> = {
  phone: { id: 'chicken', name: 'Chicken' },
  desktop: { id: 'dog', name: 'Dog' },
};

const uploadTarget = (projectName: string) => {
  const species = speciesForUpload[projectName];
  if (species === undefined) {
    throw new Error(`No species assigned to the project "${projectName}".`);
  }
  return species;
};

const speciesCard = (page: Page, name: string) =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 2, name }) });

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
  const listed = await listedSpecies(page);
  await page.goto('/#/species');

  const images = page.getByRole('main').locator('img.species-image');
  await expect(images).toHaveCount(listed.length);
  for (const species of listed) {
    const image = page.getByRole('img', { name: species.name, exact: true });
    // The other project may upload a new image for this species while
    // this test runs, so the card is held against the node's current
    // version rather than the one listed before the page loaded.
    await expect
      .poll(async () => {
        const [source, current] = await Promise.all([
          image.getAttribute('src'),
          listedSpecies(page),
        ]);
        return current.some(
          (entry) => entry.id === species.id && entry.imageUrl === source,
        );
      })
      .toBe(true);
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

test('uploads an image from the card and the card shows the new version', async ({
  page,
}, testInfo) => {
  const target = uploadTarget(testInfo.project.name);
  const before = (await listedSpecies(page)).find(
    (entry) => entry.id === target.id,
  )!;
  // A colour per attempt: the same bytes again would be the version the
  // node already has, and the card would rightly not change.
  const png = solidPng(6, 4, [
    40 + testInfo.retry * 50 + testInfo.repeatEachIndex,
    120,
    testInfo.project.name === 'phone' ? 200 : 60,
  ]);
  await page.goto('/#/species');
  const card = speciesCard(page, target.name);
  const upload = card.getByLabel(`Upload image for ${target.name}`);
  const button = card.getByText('Upload image');
  const buttonBox = await boundingBoxOf(button);
  expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  expect(buttonBox.width).toBeGreaterThanOrEqual(44);

  await upload.setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: png,
  });

  await expect
    .poll(async () =>
      (await listedSpecies(page)).find((entry) => entry.id === target.id),
    )
    .not.toMatchObject({ hash: before.hash });
  const after = (await listedSpecies(page)).find(
    (entry) => entry.id === target.id,
  )!;
  expect(after.imageUrl).not.toBe(before.imageUrl);
  const image = page.getByRole('img', { name: target.name, exact: true });
  await expect(image).toHaveAttribute('src', after.imageUrl);
  await expectImageLoaded(image);
  await expect
    .poll(() =>
      image.evaluate((element) =>
        element instanceof HTMLImageElement
          ? [element.naturalWidth, element.naturalHeight]
          : [],
      ),
    )
    .toStrictEqual([6, 4]);
  const served = await page.request.get(after.imageUrl);
  expect(served.headers()['content-type']).toBe('image/png');
  expect(Buffer.from(await served.body()).equals(png)).toBe(true);
});

test('refuses a file that is not an image before sending anything', async ({
  page,
}, testInfo) => {
  const target = uploadTarget(testInfo.project.name);
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      uploads.push(request.url());
    }
  });
  await page.goto('/#/species');
  const card = speciesCard(page, target.name);

  await card.getByLabel(`Upload image for ${target.name}`).setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });

  const alert = card.getByRole('alert');
  await expect(alert).toHaveText('Choose a PNG or JPEG image.');
  expect(uploads).toStrictEqual([]);
});

test("shows the node's refusal of an upload on the card", async ({
  page,
}, testInfo) => {
  const target = uploadTarget(testInfo.project.name);
  await page.route(`**/api/species/${target.id}/image`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 415,
          json: {
            statusCode: 415,
            error: 'Unsupported Media Type',
            message:
              'The body does not start like a PNG or JPEG image, whatever it was declared as.',
          },
        })
      : route.continue(),
  );
  await page.goto('/#/species');
  const card = speciesCard(page, target.name);

  await card.getByLabel(`Upload image for ${target.name}`).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('pretends to be a png'),
  });

  await expect(card.getByRole('alert')).toHaveText(
    'The body does not start like a PNG or JPEG image, whatever it was declared as.',
  );
  await expect(
    card.getByLabel(`Upload image for ${target.name}`),
  ).toBeEnabled();
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
