import { expect, test, type Page } from '@playwright/test';

import {
  boundingBoxOf,
  cardListItems,
  expectNoHorizontalScroll,
} from './support.ts';

/**
 * Tests of both projects run in parallel against one node, and an edit
 * changes the node's data for every other test, so every saving test here
 * edits an animal of its own per project, one no other test reads a price
 * or a name from, and asserts on what it wrote rather than on an exact
 * version count (a retry adds a version).
 */
type Purpose = 'price' | 'oldVersion' | 'keyboard';

const animalsByProject: Record<string, Record<Purpose, string>> = {
  phone: {
    price: 'pepper-the-poodle',
    oldVersion: 'bowser-the-guard-dog',
    keyboard: 'clara-cluck-junior',
  },
  desktop: {
    price: 'gadget-the-inventor',
    oldVersion: 'daphne-duck',
    keyboard: 'nosey-the-bloodhound',
  },
};

const animalFor = (projectName: string, purpose: Purpose) => {
  const animals = animalsByProject[projectName];
  if (animals === undefined) {
    throw new Error(`No animal assigned to the project "${projectName}".`);
  }
  return animals[purpose];
};

const versionRows = (page: Page) =>
  page.getByRole('list', { name: 'Versions' }).getByRole('listitem');

/**
 * A price in euros that differs per attempt of a test (a retry, or a
 * repeat through `--repeat-each`): an attempt saving the exact content of
 * the attempt before would write a version with the same row hash, and
 * the version list then holds two rows for one hash, of which only the
 * newest links to that hash.
 *
 * @param euros the whole euros
 * @param testInfo the running test, for its retry and repeat indexes
 */
const priceForAttempt = (
  euros: number,
  testInfo: { retry: number; repeatEachIndex: number },
) =>
  `${euros}.${String(10 + testInfo.retry * 10 + testInfo.repeatEachIndex).padStart(2, '0')}`;

test('edits the price through the form and sees it in the detail, the list and the history', async ({
  page,
}, testInfo) => {
  const animalId = animalFor(testInfo.project.name, 'price');
  await page.goto(`/#/animals/${animalId}`);
  const name = await page.locator('h1.view-title').innerText();

  await page.getByRole('link', { name: 'Edit' }).click();

  await expect(page).toHaveURL(new RegExp(`#/animals/${animalId}/edit$`));
  await expect(page).toHaveTitle(`Edit ${name} · Duckburg Pet Shop`);
  await expect(page.getByLabel('Name')).toHaveValue(name);
  const price = priceForAttempt(777, testInfo);
  await page.getByLabel('Price in euros').fill(price);
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(new RegExp(`#/animals/${animalId}$`));
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const priceText = new RegExp(price.replace('.', '[.,]'));
  await expect(page.locator('.animal-facts')).toContainText(priceText);
  const versions = versionRows(page);
  await expect(versions.nth(1)).toBeVisible();
  await expect(versions.first()).toContainText(priceText);
  await expect(versions.first().locator('.version-badge')).toHaveText(
    'current',
  );
  await expect(versions.first().locator('.version-time')).not.toBeEmpty();
  await expect(versions.nth(1).locator('.version-badge')).toHaveCount(0);

  await page.getByRole('link', { name: 'Back to Animals' }).click();

  const card = cardListItems(page).filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.animal-price')).toContainText(priceText);
});

test('shows an older version read-only with a notice and a way back', async ({
  page,
}, testInfo) => {
  const animalId = animalFor(testInfo.project.name, 'oldVersion');
  const price = priceForAttempt(555, testInfo);
  const priceText = new RegExp(price.replace('.', '[.,]'));
  await page.goto(`/#/animals/${animalId}/edit`);
  await page.getByLabel('Price in euros').fill(price);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(new RegExp(`#/animals/${animalId}$`));
  const versions = versionRows(page);
  await expect(versions.nth(1)).toBeVisible();

  await versions.nth(1).getByRole('link').click();

  await expect(page).toHaveURL(
    new RegExp(`#/animals/${animalId}\\?version=[A-Za-z0-9_-]{22}$`),
  );
  await expect(page.getByRole('status')).toContainText(
    'You are viewing the version from',
  );
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await expect(page.locator('.animal-facts')).not.toContainText(priceText);
  await expect(versionRows(page).nth(1).getByRole('link')).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('link', { name: 'Show the current version' }).click();

  await expect(page).toHaveURL(new RegExp(`#/animals/${animalId}$`));
  await expect(page.locator('.animal-facts')).toContainText(priceText);
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
});

test('shows inline validation messages and does not save an invalid form', async ({
  page,
}) => {
  await page.goto('/#/animals/sir-quackington/edit');
  const nameField = page.getByLabel('Name');
  await expect(nameField).toHaveValue('Sir Quackington');

  await nameField.fill('');
  await nameField.press('Tab');
  // Nothing is judged before the first attempt to save: a message that
  // appeared on leaving a field would move the Save button away from under
  // the tap that left it.
  await expect(page.locator('#animal-name-error')).toBeHidden();
  const price = page.getByLabel('Price in euros');
  await price.fill('-5');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/#\/animals\/sir-quackington\/edit$/);
  await expect(nameField).toHaveAttribute('aria-invalid', 'true');
  await expect(nameField).toBeFocused();
  await expect(page.locator('#animal-name-error')).toHaveText(
    'The name must not be empty.',
  );
  await expect(page.locator('#animal-price-error')).toHaveText(
    'The price must be 0.00 or more, with at most two decimals.',
  );

  await nameField.fill('Sir Quackington');

  await expect(page.locator('#animal-name-error')).toBeHidden();
  await expect(nameField).not.toHaveAttribute('aria-invalid');
  await expect(page.locator('#animal-price-error')).toBeVisible();
});

test('keeps the list filter through Edit and Cancel', async ({ page }) => {
  await page.goto('/#/animals/sir-quackington?species=duck');
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();

  await page.getByRole('link', { name: 'Edit' }).click();

  await expect(page).toHaveURL(
    /#\/animals\/sir-quackington\/edit\?species=duck$/,
  );
  await expect(page.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
    'href',
    '#/animals/sir-quackington?species=duck',
  );

  await page.getByRole('link', { name: 'Cancel' }).click();

  await expect(page).toHaveURL(/#\/animals\/sir-quackington\?species=duck$/);
  await expect(
    page.getByRole('link', { name: 'Back to Animals' }),
  ).toHaveAttribute('href', '#/animals?species=duck');
});

test('treats the current version addressed by its hash as current', async ({
  page,
}) => {
  const response = await page.request.get(
    '/api/animals/sir-quackington/history',
  );
  const history = (await response.json()) as { hash: string }[];
  const newestTipHash = history[0]!.hash;

  await page.goto(`/#/animals/sir-quackington?version=${newestTipHash}`);

  await expect(
    page.getByRole('heading', { level: 1, name: 'Sir Quackington' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(versionRows(page).first().getByRole('link')).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('shows the traits as toggles and the story in a field that grows', async ({
  page,
}) => {
  await page.goto('/#/animals/sir-quackington/edit');

  const loyal = page.getByRole('button', { name: 'Fiercely loyal' });
  await expect(loyal).toHaveAttribute('aria-pressed', 'true');
  const pressedCount = await page
    .locator('.trait-toggles [aria-pressed="true"]')
    .count();
  expect(pressedCount).toBe(4);
  await loyal.click();
  await expect(loyal).toHaveAttribute('aria-pressed', 'false');
  await loyal.click();
  await expect(loyal).toHaveAttribute('aria-pressed', 'true');

  const story = page.getByLabel('Background story');
  const box = await boundingBoxOf(story);
  const contentHeight = await story.evaluate(
    (textarea) => textarea.scrollHeight,
  );
  expect(box.height).toBeGreaterThanOrEqual(contentHeight - 1);
  expect(box.height).toBeGreaterThan(300);
  await expectNoHorizontalScroll(page);
});

test('keeps every control of the form at least 44 pixels tall', async ({
  page,
}) => {
  await page.goto('/#/animals/sir-quackington/edit');
  await expect(page.getByLabel('Name')).toBeVisible();

  for (const label of [
    'Name',
    'Species',
    'Breeder',
    'Born on',
    'Price in euros',
  ]) {
    const box = await boundingBoxOf(page.getByLabel(label));
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  for (const button of await page.locator('form').getByRole('button').all()) {
    const box = await boundingBoxOf(button);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const edit = page.getByRole('link', { name: 'Cancel' });
  expect((await boundingBoxOf(edit)).height).toBeGreaterThanOrEqual(44);
});

test('offers a 44 pixel Edit action on the detail', async ({ page }) => {
  await page.goto('/#/animals/sir-quackington');

  const edit = page.getByRole('link', { name: 'Edit' });
  await expect(edit).toBeVisible();
  const box = await boundingBoxOf(edit);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  for (const row of await versionRows(page).getByRole('link').all()) {
    expect((await boundingBoxOf(row)).height).toBeGreaterThanOrEqual(44);
  }
});

test('can be edited and saved with the keyboard alone', async ({
  page,
}, testInfo) => {
  const animalId = animalFor(testInfo.project.name, 'keyboard');
  await page.goto(`/#/animals/${animalId}/edit?breeder=grandma-ducks-farm`);
  const price = page.getByLabel('Price in euros');
  await expect(price).toBeVisible();

  await page.getByLabel('Name').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Species')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Breeder')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Born on')).toBeFocused();
  // Chromium's date input is made of month, day and year segments that
  // each take a Tab of their own, so leaving it takes several presses.
  for (let press = 0; press < 5; press += 1) {
    if (await price.evaluate((input) => input === document.activeElement)) {
      break;
    }
    await page.keyboard.press('Tab');
  }
  await expect(price).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  const typedPrice = priceForAttempt(333, testInfo);
  await page.keyboard.type(typedPrice);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(
    new RegExp(`#/animals/${animalId}\\?breeder=grandma-ducks-farm$`),
  );
  await expect(page.locator('.animal-facts')).toContainText(
    new RegExp(typedPrice.replace('.', '[.,]')),
  );
  await expect(versionRows(page).first().locator('.version-badge')).toHaveText(
    'current',
  );
});

test('shows the not-found view for an unknown animal id on the edit form', async ({
  page,
}) => {
  await page.goto('/#/animals/no-such-animal/edit');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Page not found' }),
  ).toBeVisible();
  await expect(page.getByText('no-such-animal')).toBeVisible();
});

test("shows the node's message when the node refuses the edit", async ({
  page,
}) => {
  await page.route('**/api/animals/sir-quackington', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No species with id "duck".',
        }),
      });
    } else {
      await route.continue();
    }
  });
  await page.goto('/#/animals/sir-quackington/edit');
  await expect(page.getByLabel('Name')).toHaveValue('Sir Quackington');

  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'No species with id "duck".',
  );
  await expect(page).toHaveURL(/#\/animals\/sir-quackington\/edit$/);
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
});
