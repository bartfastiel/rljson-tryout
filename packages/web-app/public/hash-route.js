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

/**
 * The names of the animal list's hash query parameters: the three filters
 * and the search text, the state `animals-list.js` reads from and writes to
 * the hash.
 */
export const animalListParamNames = ['species', 'breeder', 'trait', 'q'];

/**
 * The animal list filter a hash query carries: its `species`, `breeder`,
 * `trait` and `q` parameters and nothing else. An animal card puts them
 * into the detail's hash (`animals-list.js`), and every link of the detail
 * and of the edit form hands them back, so that "back" always returns to
 * the filtered and searched list the card was opened from.
 *
 * @param {string} hash
 */
export const animalFilterParams = (hash) => {
  const query = hashQuery(hash);
  const params = new URLSearchParams();
  for (const name of animalListParamNames) {
    const value = query.get(name);
    if (value !== null) {
      params.set(name, value);
    }
  }
  return params;
};

/**
 * A hash path with the given parameters as its query, or the bare path
 * when there is none, so that the unfiltered hash stays `#/animals`.
 *
 * @param {string} path
 * @param {URLSearchParams} params
 */
export const hrefWithParams = (path, params) => {
  const queryString = params.toString();
  return queryString === '' ? path : `${path}?${queryString}`;
};

/**
 * The href of an animal's detail page: the current version, or, with
 * `version`, that exact version read-only, keeping the list filter of the
 * current hash.
 *
 * @param {string} animalId
 * @param {string | null} version
 */
export const animalDetailHref = (animalId, version) => {
  const params = animalFilterParams(location.hash);
  if (version !== null) {
    params.set('version', version);
  }
  return hrefWithParams(`#/animals/${encodeURIComponent(animalId)}`, params);
};

/**
 * The href of the animal list the current hash's filter selects.
 */
export const animalListHref = () =>
  hrefWithParams('#/animals', animalFilterParams(location.hash));
