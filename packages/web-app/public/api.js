// @ts-check

/**
 * The generic message for an error status, naming the status and the path
 * so that a person can tell a broken node from a broken request.
 *
 * @param {Response} response
 * @param {string} path
 */
const genericMessage = (response, path) =>
  `The node answered ${response.status} ${response.statusText} for ${path}.`;

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
    throw new Error(genericMessage(response, path));
  }
  return response.json();
};

/**
 * The message of a refused request: the node's own `message` when it
 * answered `4xx` in Fastify's `{ statusCode, error, message }` shape, since
 * that message is written for the person who filled in the form ("No animal
 * with id ..."), the generic message otherwise (a `500` says nothing a
 * person can act on).
 *
 * @param {Response} response
 * @param {string} path
 */
const refusalMessage = async (response, path) => {
  const generic = genericMessage(response, path);
  if (response.status < 400 || response.status >= 500) {
    return generic;
  }
  try {
    const body = /** @type {{ message?: unknown }} */ (await response.json());
    return typeof body.message === 'string' && body.message !== ''
      ? body.message
      : generic;
  } catch {
    return generic;
  }
};

/**
 * Sends a JSON document to this node and returns the JSON it answers with.
 * Fails with the node's own message when the node refused the request, so
 * a form can show exactly why.
 *
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
export const postJson = async (path, body) => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await refusalMessage(response, path));
  }
  return response.json();
};
