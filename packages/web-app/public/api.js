// @ts-check

/**
 * Fetches a JSON document from this node and fails with a readable message
 * when the node answers with an error status.
 *
 * @param {string} path
 * @returns {Promise<unknown>}
 */
export const fetchJson = async (path) => {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `The node answered ${response.status} ${response.statusText} for ${path}.`,
    );
  }
  return response.json();
};
