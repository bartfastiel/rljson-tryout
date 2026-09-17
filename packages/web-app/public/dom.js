// @ts-check

/**
 * Creates an element with a class and text content. Text goes through
 * `textContent`, so strings from the API are never parsed as markup.
 *
 * @template {keyof HTMLElementTagNameMap} TagName
 * @param {TagName} tagName
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[TagName]}
 */
export const element = (tagName, className, text = '') => {
  const created = document.createElement(tagName);
  created.className = className;
  created.textContent = text;
  return created;
};

/**
 * Returns the single element the selector finds and fails loudly when the
 * shell markup does not contain it.
 *
 * @param {string} selector
 * @returns {HTMLElement}
 */
export const requiredElement = (selector) => {
  const found = document.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`The page has no element matching "${selector}".`);
  }
  return found;
};
