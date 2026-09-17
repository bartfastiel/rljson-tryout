import { expect, test, type Page } from '@playwright/test';

import {
  addAnimalToInvoice,
  boundingBoxOf,
  cardListItems,
  expectNoHorizontalScroll,
  mainNavigation,
  pickerList,
  pickerRows,
  searchPicker,
} from './support.ts';

const seededInvoiceNumbers = [
  '2026-0006',
  '2026-0005',
  '2026-0004',
  '2026-0003',
  '2026-0002',
  '2026-0001',
];

/**
 * Tests run in parallel against one node, and several of them issue
 * invoices, so nothing here assumes a specific next invoice number or an
 * exact list length: a test reads the number the node assigned from the
 * detail heading and looks for that.
 */
const issuedInvoiceNumber = async (page: Page): Promise<string> => {
  const heading = page.getByRole('heading', {
    level: 1,
    name: /^Invoice \d{4}-\d{4}$/,
  });
  await expect(heading).toBeVisible();
  return (await heading.innerText()).replace('Invoice ', '');
};

test('lists the seeded invoices newest first with customer, date, status badge and total', async ({
  page,
}) => {
  await page.goto('/#/invoices');

  await expect(page).toHaveTitle('Invoices · Duckburg Pet Shop');
  const cards = cardListItems(page);
  await expect(cards.first()).toBeVisible();
  const numbers = await cards.locator('.invoice-number').allInnerTexts();
  expect(numbers).toEqual(expect.arrayContaining(seededInvoiceNumbers));
  expect([...numbers].sort().reverse()).toStrictEqual(numbers);

  const cancelled = cards.filter({ hasText: '2026-0004' });
  await expect(cancelled.locator('.invoice-customer')).toHaveText(
    'Fethry Duck',
  );
  await expect(cancelled.locator('.status-badge')).toHaveText('cancelled');
  await expect(cancelled.locator('.invoice-item-count')).toHaveText('2 items');
  await expect(cancelled.locator('.invoice-total')).toContainText('€');
  for (const card of await cards.all()) {
    await expect(card.locator('.invoice-issued-on')).not.toBeEmpty();
    await expect(card.locator('.status-badge')).toHaveText(
      /^(open|paid|cancelled)$/,
    );
  }
  await expect(page.getByRole('link', { name: 'New invoice' })).toBeVisible();
});

test('navigates to the invoices view from the main navigation', async ({
  page,
}) => {
  await page.goto('/#/animals');

  await mainNavigation(page).getByRole('link', { name: 'Invoices' }).click();

  await expect(page).toHaveURL(/#\/invoices$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Invoices' }),
  ).toBeVisible();
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Invoices' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('a card links to the invoice detail with its items and change set', async ({
  page,
}) => {
  await page.goto('/#/invoices');

  await cardListItems(page).filter({ hasText: '2026-0001' }).click();

  await expect(page).toHaveURL(/#\/invoices\/invoice-2026-0001$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Invoice 2026-0001' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Invoice 2026-0001 · Duckburg Pet Shop');
  const facts = page.locator('.animal-facts');
  await expect(facts).toContainText('Scrooge McDuck (C-0001)');
  await expect(facts.locator('.status-badge')).toHaveText('paid');

  const items = page.getByRole('list', { name: 'Items' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(
    items.first().getByRole('link', { name: 'Bowser the Guard Dog' }),
  ).toBeVisible();
  await expect(items.first().locator('.invoice-line-price')).toContainText(
    '1 ×',
  );
  await expect(items.first().locator('.invoice-line-total')).toContainText('€');
  await expect(page.locator('.invoice-total-amount')).toContainText('€');
  await expect(page.locator('.invoice-change-set')).toHaveText(
    /^Change set [A-Za-z0-9_-]{22}$/,
  );

  await items
    .first()
    .getByRole('link', { name: 'Bowser the Guard Dog' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Bowser the Guard Dog' }),
  ).toBeVisible();
});

test('issues an invoice through the form and finds it in the list with its items', async ({
  page,
}) => {
  await page.goto('/#/invoices');
  await page.getByRole('link', { name: 'New invoice' }).click();

  await expect(page).toHaveURL(/#\/invoices\/new$/);
  await expect(page).toHaveTitle('New invoice · Duckburg Pet Shop');
  await page.getByLabel('Customer').selectOption({
    label: 'Scrooge McDuck (C-0001)',
  });

  await searchPicker(page, 'donald');
  await expect(pickerRows(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Add Donald the Third' }).click();

  const lines = page
    .getByRole('list', { name: 'Invoice items' })
    .getByRole('listitem');
  await expect(lines).toHaveCount(1);
  await expect(lines.first().locator('.stepper-value')).toHaveText('1');

  await searchPicker(page, 'chicken');
  await expect(
    pickerRows(page).filter({ hasText: 'Henrietta the Egg Champion' }),
  ).toHaveCount(1);
  for (const row of await pickerRows(page).all()) {
    await expect(row.locator('.animal-picker-meta')).toContainText('Chicken');
  }
  await page
    .getByRole('button', { name: 'Add Henrietta the Egg Champion' })
    .click();
  await expect(lines).toHaveCount(2);
  await page
    .getByRole('button', {
      name: 'Increase quantity of Henrietta the Egg Champion',
    })
    .click();
  await expect(lines.nth(1).locator('.stepper-value')).toHaveText('2');
  // 520.00 + 2 × 195.00 = 910.00, whatever the locale's separators.
  await expect(page.locator('.invoice-total-amount')).toContainText(/910/);

  await page.getByRole('button', { name: 'Issue invoice' }).click();

  await expect(page).toHaveURL(/#\/invoices\/invoice-\d{4}-\d{4}$/);
  const invoiceNumber = await issuedInvoiceNumber(page);
  const facts = page.locator('.animal-facts');
  await expect(facts).toContainText('Scrooge McDuck (C-0001)');
  await expect(facts.locator('.status-badge')).toHaveText('open');
  const items = page.getByRole('list', { name: 'Items' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Donald the Third');
  await expect(items.nth(0).locator('.invoice-line-price')).toContainText(
    '1 ×',
  );
  await expect(items.nth(1)).toContainText('Henrietta the Egg Champion');
  await expect(items.nth(1).locator('.invoice-line-price')).toContainText(
    '2 ×',
  );
  await expect(page.locator('.invoice-total-amount')).toContainText(/910/);
  await expect(page.locator('.invoice-change-set')).toHaveText(
    /^Change set [A-Za-z0-9_-]{22}$/,
  );

  await page.getByRole('link', { name: 'Back to Invoices' }).click();

  await expect(page).toHaveURL(/#\/invoices$/);
  const card = cardListItems(page).filter({ hasText: invoiceNumber });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.invoice-customer')).toHaveText('Scrooge McDuck');
  await expect(card.locator('.status-badge')).toHaveText('open');
  await expect(card.locator('.invoice-item-count')).toHaveText('2 items');
  await expect(card.locator('.invoice-total')).toContainText(/910/);
});

test('removes a line when its quantity is stepped below one', async ({
  page,
}) => {
  await page.goto('/#/invoices/new');
  await addAnimalToInvoice(page, 'Daphne Duck');
  const lines = page
    .getByRole('list', { name: 'Invoice items' })
    .getByRole('listitem');
  await expect(lines).toHaveCount(1);

  await page
    .getByRole('button', { name: 'Decrease quantity of Daphne Duck' })
    .click();

  await expect(lines).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Items' }).getByRole('status'),
  ).toHaveText('No items yet. Add an animal from the list above.');
  await expect(page.locator('.invoice-total-amount')).toContainText(/0/);
});

test("shows the node's message inline when the invoice is refused", async ({
  page,
}) => {
  await page.goto('/#/invoices/new');
  await page.getByLabel('Customer').selectOption({
    label: 'Donald Duck (C-0002)',
  });

  await page.getByRole('button', { name: 'Issue invoice' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('An invoice needs at least one item.');
  await expect(page).toHaveURL(/#\/invoices\/new$/);
  await expect(
    page.getByRole('button', { name: 'Issue invoice' }),
  ).toBeEnabled();

  await addAnimalToInvoice(page, 'Daphne Duck');

  await expect(alert).toHaveCount(0);
});

test('refuses to submit before a customer is chosen', async ({ page }) => {
  await page.goto('/#/invoices/new');
  await addAnimalToInvoice(page, 'Daphne Duck');

  await page.getByRole('button', { name: 'Issue invoice' }).click();

  await expect(page).toHaveURL(/#\/invoices\/new$/);
  const customerIsInvalid = await page
    .getByLabel('Customer')
    .evaluate((select) => (select as HTMLSelectElement).matches(':invalid'));
  expect(customerIsInvalid).toBe(true);
});

test('can be filled in and submitted with the keyboard alone', async ({
  page,
}) => {
  await page.goto('/#/invoices/new');
  const customer = page.getByLabel('Customer');
  await customer.focus();
  await customer.selectOption({ label: 'Gladstone Gander (C-0003)' });

  await page.getByLabel('Search animals').focus();
  await page.keyboard.type('Quackmore');
  await expect(pickerList(page)).toHaveAttribute('data-search', 'Quackmore');
  await expect(pickerRows(page)).toHaveCount(1);
  await page.keyboard.press('Tab');
  const addQuackmore = page.getByRole('button', {
    name: 'Add Quackmore Junior',
  });
  await expect(addQuackmore).toBeFocused();
  await page.keyboard.press('Enter');

  const lines = page
    .getByRole('list', { name: 'Invoice items' })
    .getByRole('listitem');
  await expect(lines).toHaveCount(1);
  await expect(addQuackmore).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Decrease quantity of Quackmore Junior' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  const increase = page.getByRole('button', {
    name: 'Increase quantity of Quackmore Junior',
  });
  await expect(increase).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(lines.first().locator('.stepper-value')).toHaveText('2');
  await expect(increase).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Issue invoice' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/#\/invoices\/invoice-\d{4}-\d{4}$/);
  const items = page.getByRole('list', { name: 'Items' }).getByRole('listitem');
  await expect(items).toHaveCount(1);
  await expect(items.first().locator('.invoice-line-price')).toContainText(
    '2 ×',
  );
});

test('gives every control of the form a target of at least 44 pixels', async ({
  page,
}) => {
  await page.goto('/#/invoices/new');
  await addAnimalToInvoice(page, 'Daphne Duck');

  const customerBox = await boundingBoxOf(page.getByLabel('Customer'));
  expect(customerBox.height).toBeGreaterThanOrEqual(44);
  const searchBox = await boundingBoxOf(page.getByLabel('Search animals'));
  expect(searchBox.height).toBeGreaterThanOrEqual(44);
  const buttons = page.locator('form').getByRole('button');
  expect(await buttons.count()).toBeGreaterThan(3);
  for (const button of await buttons.all()) {
    const box = await boundingBoxOf(button);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalScroll(page);
});

test('shows the not-found view for an unknown invoice id', async ({ page }) => {
  await page.goto('/#/invoices/no-such-invoice');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Page not found' }),
  ).toBeVisible();
  await expect(page.getByText('no-such-invoice')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Invoices' }).click();

  await expect(page).toHaveURL(/#\/invoices$/);
  await expect(cardListItems(page).first()).toBeVisible();
});

test('shows an error with a retry button when the node answers 500', async ({
  page,
}) => {
  let nodeIsBroken = true;
  await page.route('**/api/invoices', async (route) => {
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

  await page.goto('/#/invoices');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the invoices.');
  await expect(alert).toContainText('500');
  await expect(cardListItems(page)).toHaveCount(0);

  nodeIsBroken = false;
  await alert.getByRole('button', { name: 'Retry' }).click();

  await expect(cardListItems(page).first()).toBeVisible();
  await expect(alert).toHaveCount(0);
});
