import { expect, test, type Locator, type Page } from '@playwright/test';

import { addAnimalToInvoice, cardListItems } from './support.ts';

/**
 * The animal each project renames, one no other test reads a name from
 * except as a prefix (the invoice picker adds "Donald the Third" and
 * "Quackmore Junior" by substring), so that a suffix this test appends
 * breaks nothing that runs in parallel.
 */
const animalsByProject: Record<string, string> = {
  phone: 'donald-the-third',
  desktop: 'quackmore-junior',
};

const animalFor = (projectName: string): string => {
  const animalId = animalsByProject[projectName];
  if (animalId === undefined) {
    throw new Error(`No animal assigned to the project "${projectName}".`);
  }
  return animalId;
};

const liveIndicator = (page: Page): Locator =>
  page.getByRole('banner').getByTitle(/^Live updates: /);

const issuedInvoiceNumber = async (page: Page): Promise<string> => {
  const heading = page.getByRole('heading', {
    level: 1,
    name: /^Invoice \d{4}-\d{4}$/,
  });
  await expect(heading).toBeVisible();
  return (await heading.innerText()).replace('Invoice ', '');
};

/**
 * A name for this attempt that keeps the seed name as its prefix, so that
 * the tests matching the animal by that prefix keep finding it, and that
 * differs from the name before, so that the change is visible.
 *
 * @param currentName the name the animal has right now
 * @param testInfo the running test, for its retry index
 */
const renamedFor = (
  currentName: string,
  testInfo: { retry: number; repeatEachIndex: number },
): string => {
  const baseName = currentName.replace(/ \(live \d+\)$/, '');
  const attempt = Date.now() % 100000;
  return `${baseName} (live ${attempt}${testInfo.retry}${testInfo.repeatEachIndex})`;
};

test('shows the stream as live in the header', async ({ page }) => {
  await page.goto('/');

  const indicator = liveIndicator(page);
  await expect(indicator).toHaveText(/live$/);
  await expect(indicator).toHaveAttribute('title', 'Live updates: live');
  await expect(indicator).toHaveClass(/live-indicator-live/);
  await expect(indicator).toContainText('Live updates: live');
});

test('an invoice issued in one tab appears in the invoice list of another without a reload', async ({
  context,
}) => {
  const watching = await context.newPage();
  const issuing = await context.newPage();
  await watching.goto('/#/invoices');
  await expect(cardListItems(watching).first()).toBeVisible();
  await expect(liveIndicator(watching)).toHaveText(/live$/);
  const reloads = await watching.evaluate(
    () => performance.getEntriesByType('navigation').length,
  );

  await issuing.goto('/#/invoices/new');
  await issuing.getByLabel('Customer').selectOption({
    label: 'Scrooge McDuck (C-0001)',
  });
  await addAnimalToInvoice(issuing, 'Daphne Duck');
  await issuing.getByRole('button', { name: 'Issue invoice' }).click();
  const invoiceNumber = await issuedInvoiceNumber(issuing);

  const card = cardListItems(watching).filter({ hasText: invoiceNumber });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.invoice-customer')).toHaveText('Scrooge McDuck');
  expect(
    await watching.evaluate(
      () => performance.getEntriesByType('navigation').length,
    ),
  ).toBe(reloads);
  await expect(watching).toHaveURL(/#\/invoices$/);
});

/**
 * The three rename tests of a project edit the same animal, and two edits
 * of one version at the same time would be a branch with two tips (slice
 * D11), so they run one after another.
 */
test.describe('renaming', () => {
  test.describe.configure({ mode: 'serial' });

  test('a rename in one tab updates the animal list of another, keeping its search', async ({
    context,
  }, testInfo) => {
    const animalId = animalFor(testInfo.project.name);
    const watching = await context.newPage();
    const editing = await context.newPage();
    await editing.goto(`/#/animals/${animalId}/edit`);
    const nameField = editing.getByLabel('Name');
    await expect(nameField).not.toHaveValue('');
    const currentName = await nameField.inputValue();
    const searchText = currentName.split(' ')[0]!.toLowerCase();

    await watching.goto(`/#/animals?q=${searchText}`);
    const card = cardListItems(watching).filter({ hasText: currentName });
    await expect(card).toHaveCount(1);
    const searchField = watching.getByRole('searchbox', {
      name: 'Search animals',
    });
    await expect(searchField).toHaveValue(searchText);
    await searchField.focus();

    const newName = renamedFor(currentName, testInfo);
    await nameField.fill(newName);
    await editing.getByRole('button', { name: 'Save' }).click();
    await expect(
      editing.getByRole('heading', { level: 1, name: newName }),
    ).toBeVisible();

    await expect(
      cardListItems(watching).filter({ hasText: newName }),
    ).toHaveCount(1);
    await expect(watching).toHaveURL(
      new RegExp(`#/animals\\?q=${searchText}$`),
    );
    await expect(searchField).toHaveValue(searchText);
    await expect(searchField).toBeFocused();
  });

  test('a rename in one tab updates the detail of the current version in another', async ({
    context,
  }, testInfo) => {
    const animalId = animalFor(testInfo.project.name);
    const watching = await context.newPage();
    const editing = await context.newPage();
    await watching.goto(`/#/animals/${animalId}`);
    const heading = watching.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    const currentName = await heading.innerText();
    const versionRows = watching
      .getByRole('list', { name: 'Versions' })
      .getByRole('listitem');
    const versionsBefore = await versionRows.count();

    await editing.goto(`/#/animals/${animalId}/edit`);
    const newName = renamedFor(currentName, testInfo);
    await editing.getByLabel('Name').fill(newName);
    await editing.getByRole('button', { name: 'Save' }).click();

    await expect(heading).toHaveText(newName);
    await expect(versionRows).toHaveCount(versionsBefore + 1);
    await expect(watching).toHaveURL(new RegExp(`#/animals/${animalId}$`));
  });

  test('leaves an older version alone when the animal changes', async ({
    context,
  }, testInfo) => {
    const animalId = animalFor(testInfo.project.name);
    const watching = await context.newPage();
    const editing = await context.newPage();
    const history = (await (
      await watching.request.get(`/api/animals/${animalId}/history`)
    ).json()) as { hash: string; name: string }[];
    const oldest = history[history.length - 1]!;
    await watching.goto(`/#/animals/${animalId}?version=${oldest.hash}`);
    await expect(watching.getByRole('heading', { level: 1 })).toHaveText(
      oldest.name,
    );

    await editing.goto(`/#/animals/${animalId}/edit`);
    const currentName = await editing.getByLabel('Name').inputValue();
    const newName = renamedFor(currentName, testInfo);
    await editing.getByLabel('Name').fill(newName);
    await editing.getByRole('button', { name: 'Save' }).click();
    await expect(
      editing.getByRole('heading', { level: 1, name: newName }),
    ).toBeVisible();

    await watching.waitForTimeout(1000);
    await expect(watching.getByRole('heading', { level: 1 })).toHaveText(
      oldest.name,
    );
    await expect(watching.getByRole('status')).toContainText(
      'You are viewing the version from',
    );
  });
});

test('shows reconnecting while the stream is blocked and live once it is back', async ({
  page,
}) => {
  await page.goto('/');
  const indicator = liveIndicator(page);
  await expect(indicator).toHaveText(/live$/);

  await page.route('**/api/events', (route) => route.abort('failed'));
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(indicator).toHaveText(/offline$/);
  await expect(indicator).toHaveClass(/live-indicator-offline/);

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(indicator).toHaveText(/reconnecting$/);
  await expect(indicator).toHaveAttribute(
    'title',
    'Live updates: reconnecting',
  );
  await expect(indicator).toHaveClass(/live-indicator-reconnecting/);

  await page.unroute('**/api/events');
  await expect(indicator).toHaveText(/live$/, { timeout: 10_000 });
});
