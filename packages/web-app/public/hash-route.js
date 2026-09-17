// @ts-check

/**
 * Reads the path segments of a hash such as `#/animals/quackmore-junior`,
 * `#/species` or `#/animals?species=duck` as an array, ignoring any query
 * string. Returns an empty array for a missing or bare hash.
 *
 * @param {string} hash
 * @returns {string[]}
 */
export const pathSegmentsFromHash = (hash) =>
  hash.startsWith('#/')
    ? hash
        .slice(2)
        .split('?')[0]
        .split('/')
        .filter((segment) => segment !== '')
    : [];

/**
 * Reads the view name from a hash such as `#/species`,
 * `#/animals?species=duck` or `#/species/duck`. Returns an empty string for
 * a missing or bare hash.
 *
 * @param {string} hash
 */
export const viewNameFromHash = (hash) => pathSegmentsFromHash(hash)[0] ?? '';

/**
 * Reads the query string of a hash such as `#/animals?species=duck` as
 * `URLSearchParams`. Returns an empty `URLSearchParams` for a hash without
 * one, so a missing parameter and an absent query string read the same way.
 *
 * @param {string} hash
 */
export const hashQuery = (hash) => {
  const queryIndex = hash.indexOf('?');
  return new URLSearchParams(
    queryIndex === -1 ? '' : hash.slice(queryIndex + 1),
  );
};
