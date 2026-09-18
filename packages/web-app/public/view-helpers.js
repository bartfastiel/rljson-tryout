// @ts-check
import { element } from './dom.js';

/**
 * Formatting and small status and error presentation shared by every view
 * that fetches data from the API (`animals-list.js`, `species-list.js`,
 * `animal-detail.js`, the invoice views), so dates, prices, status badges,
 * loading and error states look and behave identically everywhere instead
 * of being copied into each view.
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

export const timeFormat = new Intl.DateTimeFormat(undefined, {
  timeStyle: 'medium',
});

const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
});

/**
 * A timestamp relative to now in the viewer's language, in the largest
 * unit that keeps the number small: "5 seconds ago", "in 2 minutes",
 * "3 hours ago", "yesterday".
 *
 * @param {string} iso
 * @param {Date} [now]
 */
export const formatRelativeTime = (iso, now = new Date()) => {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 60) {
    return relativeTimeFormat.format(seconds, 'second');
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return relativeTimeFormat.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relativeTimeFormat.format(hours, 'hour');
  }
  return relativeTimeFormat.format(Math.round(hours / 24), 'day');
};

export const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * "12.7 kB" for a size in bytes, one decimal from a kilobyte on: the size
 * of an image chosen for upload and of a blob a transfer fetched.
 *
 * @param {number} bytes
 */
export const formatBytes = (bytes) =>
  bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;

/**
 * The moment an rljson `timeId` (`<milliseconds since epoch>:<4 unique
 * characters>`) was issued, which is when the version it belongs to was
 * written on the node that wrote it.
 *
 * @param {string} timeId
 */
export const dateOfTimeId = (timeId) =>
  new Date(Number(timeId.slice(0, timeId.indexOf(':'))));

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
 * The status of an invoice as a small badge, coloured by state so that an
 * open (unpaid) invoice stands out in a list and on the detail view alike.
 * The text is the status word itself, which is what a screen reader gets.
 *
 * @param {string} status
 */
export const statusBadge = (status) =>
  element('span', `status-badge status-badge-${status}`, status);

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
