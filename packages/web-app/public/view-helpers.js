// @ts-check
import { element } from './dom.js';

/**
 * Formatting and small status and error presentation shared by every view
 * that fetches data from the API (`animals-list.js`, `species-list.js`,
 * `animal-detail.js`), so dates, prices, loading and error states look and
 * behave identically everywhere instead of being copied into each view.
 */

/**
 * The name shown in the header and appended to every page title, so it is
 * defined once instead of as a matching string literal in `app.js` and
 * every view that sets `document.title` itself (`animal-detail.js`).
 */
export const applicationName = 'Duckburg Pet Shop';

export const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

export const priceFormat = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'EUR',
});

/**
 * Parses a date-only string such as `"2020-07-22"` into a `Date` at
 * midnight in the viewer's own time zone. `new Date(dateOnlyString)` parses
 * the same string as UTC midnight instead, which rendered in a viewer's
 * time zone west of UTC would show the previous day. Building the `Date`
 * from its numeric year, month and day keeps the calendar day independent
 * of the viewer's time zone.
 *
 * @param {string} dateOnly
 */
export const parseDateOnly = (dateOnly) => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/**
 * A `role="status"` paragraph for a loading or an empty-result message.
 *
 * @param {string} text
 */
export const statusMessage = (text) => {
  const message = element('p', 'status', text);
  message.setAttribute('role', 'status');
  return message;
};

/**
 * A `role="alert"` box with a headline, the error's own message and a
 * Retry button. `onRetry` runs when the button is pressed; the caller
 * decides what retrying means, usually calling its own `load()` again.
 *
 * @param {string} headline
 * @param {unknown} error
 * @param {() => void} onRetry
 */
export const errorState = (headline, error, onRetry) => {
  const retry = element('button', 'button', 'Retry');
  retry.type = 'button';
  retry.addEventListener('click', onRetry);

  const state = element('div', 'status status-error');
  state.setAttribute('role', 'alert');
  state.append(
    element('p', 'status-headline', headline),
    element(
      'p',
      'status-detail',
      error instanceof Error ? error.message : String(error),
    ),
    retry,
  );
  return state;
};
