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

export const speciesFilterChips = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Filter by species' }).getByRole('link');

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

export const expectNoHorizontalScroll = async (page: Page): Promise<void> => {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
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
