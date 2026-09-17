import { expect, type Locator, type Page } from '@playwright/test';

export type Box = { x: number; y: number; width: number; height: number };

export const boundingBoxOf = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${locator} is not rendered, it has no bounding box.`);
  }
  return box;
};

export const viewportOf = (page: Page): { width: number; height: number } => {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('The page has no fixed viewport size.');
  }
  return viewport;
};

export const mainNavigation = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Main' });

/**
 * The card list items of whichever view is currently shown in `main`
 * (species cards on the species view, animal cards on the animals view).
 */
export const cardListItems = (page: Page): Locator =>
  page.getByRole('main').getByRole('listitem');

/**
 * The line above the animal cards that reads "<shown> of <total> animals".
 */
export const animalCountLine = (page: Page): Locator =>
  page.locator('.animal-count');

/**
 * The "Load more" button below the animal cards, present only while the
 * node holds more matching animals than the page shows.
 */
export const loadMoreButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Load more' });

export const animalSearchField = (page: Page): Locator =>
  page.getByRole('searchbox', { name: 'Search animals' });

/**
 * How many animals the node holds in total and how many the first page of
 * the unfiltered list shows, read from the node itself, so that a test
 * holds for the small seed of CI (ten animals, one page) as for a local
 * run against `SEED_SIZE=medium` (110 animals, fifty on the first page).
 */
export const animalCounts = async (
  page: Page,
): Promise<{ total: number; firstPage: number }> => {
  const response = await page.request.get('/api/animals?limit=1');
  const { total } = (await response.json()) as { total: number };
  return { total, firstPage: Math.min(total, 50) };
};

/**
 * The number of entries a list endpoint of the node serves.
 */
export const listedCount = async (page: Page, path: string): Promise<number> =>
  ((await (await page.request.get(path)).json()) as unknown[]).length;

/**
 * The invoice form's animal picker list and its rows.
 */
export const pickerList = (page: Page): Locator =>
  page.getByRole('list', { name: 'Animals to add' });

export const pickerRows = (page: Page): Locator =>
  pickerList(page).getByRole('listitem');

/**
 * Types a search into the invoice form's animal picker and waits until the
 * list shows the node's answer to exactly that search (`data-search`), so
 * that what follows never acts on the rows of the page before.
 */
export const searchPicker = async (page: Page, text: string): Promise<void> => {
  await page.getByLabel('Search animals').fill(text);
  await expect(pickerList(page)).toHaveAttribute('data-search', text);
};

/**
 * Adds one animal to the invoice being built: searches the picker for its
 * name and presses its Add button once the search has answered.
 */
export const addAnimalToInvoice = async (
  page: Page,
  name: string,
): Promise<void> => {
  await searchPicker(page, name);
  await expect(pickerRows(page)).toHaveCount(1);
  await page.getByRole('button', { name: `Add ${name}` }).click();
};

export const speciesFilterChips = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Filter by species' }).getByRole('link');

export const traitFilterChips = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Filter by traits' }).getByRole('link');

/**
 * The two-chip breeder filter summary on the animals view (the active
 * breeder plus an "All" reset), present only while a breeder is selected.
 */
export const breederFilterChips = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Filter by breeder' }).getByRole('link');

/**
 * The trait chips on an animal's detail view (`.animal-traits`), as opposed
 * to the trait filter chips on the animals view `traitFilterChips` reads.
 */
export const animalDetailTraitChips = (page: Page): Locator =>
  page.locator('.animal-traits').getByRole('link');

/**
 * Relative luminance per WCAG 2 of a computed `rgb(r, g, b)` colour, from 0
 * for black to 1 for white.
 */
export const relativeLuminance = (cssColor: string): number => {
  const channels = (cssColor.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3);
  if (channels.length !== 3) {
    throw new Error(`Expected an rgb() colour, got "${cssColor}".`);
  }
  const [red, green, blue] = channels.map((channel) => {
    const value = Number(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

export const bodyBackgroundLuminance = async (page: Page): Promise<number> =>
  relativeLuminance(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  );

/**
 * Compares the document against the configured viewport rather than
 * `window.innerWidth`: under mobile emulation Chromium widens the layout
 * viewport to overflowing content, so `innerWidth` would grow with the
 * very overflow this check is meant to catch.
 */
export const expectNoHorizontalScroll = async (page: Page): Promise<void> => {
  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(documentWidth).toBeLessThanOrEqual(viewportOf(page).width);
};

/**
 * The average number of characters per wrapped line of a text element, from
 * the number of line boxes a `Range` over its content reports through
 * `getClientRects()`: one rect per wrapped line for plain inline text, so
 * dividing the character count by the rect count approximates how long a
 * line reads on screen.
 */
export const averageCharactersPerLine = (locator: Locator): Promise<number> =>
  locator.evaluate((element) => {
    const text = element.textContent ?? '';
    const range = document.createRange();
    range.selectNodeContents(element);
    const lineCount = range.getClientRects().length;
    return lineCount === 0 ? 0 : text.length / lineCount;
  });
