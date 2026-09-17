// @ts-check
import { element } from './dom.js';

/**
 * The page shown for a hash or an id nothing in the app recognises: the
 * generic "Page not found" heading, a message naming what was not found,
 * and a link back to a place that exists. Shared by the router's own
 * not-found route (`app.js`) and any view whose content depends on data
 * that might not exist (`animal-detail` for an unknown animal id), so both
 * look and read the same way.
 *
 * @param {string} message
 * @param {{ href: string, text: string }} back
 */
export const notFoundView = (message, back) => {
  const view = element('section', 'not-found');
  const backLink = element('a', 'button', back.text);
  backLink.href = back.href;
  view.append(
    element('h1', 'view-title', 'Page not found'),
    element('p', '', message),
    backLink,
  );
  return view;
};
