import type { StatusReport } from '../../src/routes/status.ts';
import { composeNodes } from './composeProject.ts';

export type ComposeNode = (typeof composeNodes)[number];

export const fetchStatus = async (port: number): Promise<StatusReport> => {
  const response = await fetch(`http://127.0.0.1:${port}/status`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new Error(`/status on port ${port} answered ${response.status}`);
  }
  return (await response.json()) as StatusReport;
};

export const fetchAllStatuses = (): Promise<StatusReport[]> =>
  Promise.all(composeNodes.map((node) => fetchStatus(node.port)));

const hasSettled = (status: StatusReport): boolean =>
  (status.role === 'hub' || status.role === 'client') &&
  status.peers.length === composeNodes.length - 1 &&
  status.peers.every((peer) => peer.probe?.reachable === true);

/**
 * Every node knows every other node and all of them name the same hub. A
 * node that missed the earliest node's first announcement is a second hub
 * for one broadcast interval, so per-node settling alone is not enough.
 */
export const allAgree = (statuses: StatusReport[]): boolean =>
  statuses.every(hasSettled) &&
  statuses.every(
    (status) =>
      status.hubNodeId !== null && status.hubNodeId === statuses[0].hubNodeId,
  );

/**
 * On top of `allAgree`: the hub's transport holds every other node as a
 * client, every client's transport is connected to the hub, and every
 * node's directory has polled that count from the hub (the directory
 * polls every three seconds, so it lags the transport by one round).
 */
export const allConnected = (statuses: StatusReport[]): boolean =>
  allAgree(statuses) &&
  statuses.every((status) =>
    status.role === 'hub'
      ? status.transport.role === 'hub' &&
        status.transport.connectedClients === composeNodes.length - 1
      : status.transport.role === 'client' && status.transport.connectedToHub,
  ) &&
  statuses.every(
    (status) =>
      status.nodes.find((node) => node.nodeId === status.hubNodeId)
        ?.connectedClients ===
      composeNodes.length - 1,
  );

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

/** Polls until the condition holds and returns how long that took. */
export const until = async (
  condition: () => Promise<boolean>,
  timeoutMs: number,
  pollIntervalMs = 100,
): Promise<number> => {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs} ms`);
    }
    await sleep(pollIntervalMs);
  }
  return Date.now() - started;
};

/** The compose node with the given service name. */
export const nodeNamed = (name: string): ComposeNode => {
  const node = composeNodes.find((candidate) => candidate.name === name);
  if (node === undefined) {
    throw new Error(`no compose node is named ${name}`);
  }
  return node;
};

/** The `/status` of a node, or `null` while it does not answer. */
export const statusOrNull = async (
  node: ComposeNode,
): Promise<StatusReport | null> => {
  try {
    return await fetchStatus(node.port);
  } catch {
    return null;
  }
};

/**
 * Polls every node's `/status` until `condition` holds for all of them,
 * tolerating nodes that do not answer yet, and returns the statuses that
 * satisfied it. Throws with the last statuses seen when the deadline
 * passes.
 */
export const waitForStatuses = async (
  condition: (statuses: StatusReport[]) => boolean,
  timeoutMs: number,
  pollIntervalMs = 500,
): Promise<StatusReport[]> => {
  const deadline = Date.now() + timeoutMs;
  let statuses: StatusReport[] = [];
  for (;;) {
    try {
      statuses = await fetchAllStatuses();
      if (condition(statuses)) {
        return statuses;
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `the nodes did not reach the expected state within ${timeoutMs} ms: ${JSON.stringify(
          statuses.map((status) => ({
            nodeName: status.nodeName,
            role: status.role,
            peers: status.peers.length,
            transport: status.transport,
          })),
        )}`,
      );
    }
    await sleep(pollIntervalMs);
  }
};

/** The compose node whose `/status` this is, by its reported name. */
export const nodeOf = (status: StatusReport): ComposeNode =>
  nodeNamed(status.nodeName);
