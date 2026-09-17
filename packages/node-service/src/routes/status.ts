import type { SeedSize } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';

import type { Configuration, StorageKind } from '../configuration.ts';
import type {
  DirectoryEntry,
  NodeDirectory,
} from '../network/nodeDirectory.ts';
import type {
  NodeRole,
  PeerSnapshot,
  RoleOrchestrator,
} from '../network/roleOrchestrator.ts';
import type { PetShopStore } from '../store/petShopStore.ts';

/**
 * A discovered peer as `/status` lists it: the orchestrator's snapshot
 * plus the display name the directory learned for that node id, when any.
 */
export type StatusPeer = PeerSnapshot & { name: string | null };

export type StatusNode = DirectoryEntry & { seenInTopology: boolean };

/**
 * The answer of `GET /status` (roadmap section 2.5): this node's identity
 * and role, the hub it follows or is, the peers discovery knows, every
 * node of the environment with one flag from discovery and one from the
 * server-side probe, and the row counts of the store.
 */
export type StatusReport = {
  nodeName: string;
  nodeId: string | null;
  publicUrl: string;
  domain: string;
  role: NodeRole;
  hubNodeId: string | null;
  hubAddress: string | null;
  peers: StatusPeer[];
  nodes: StatusNode[];
  storage: StorageKind;
  seedSize: SeedSize;
  tables: Record<string, number>;
};

export type StatusSources = Readonly<{
  configuration: Pick<
    Configuration,
    'nodeName' | 'publicUrl' | 'storage' | 'seedSize'
  >;
  store: Pick<PetShopStore, 'tableRowCounts'>;
  orchestrator: Pick<RoleOrchestrator, 'snapshot'>;
  directory: Pick<NodeDirectory, 'entries' | 'nameOf'>;
}>;

export const buildStatusReport = async ({
  configuration,
  store,
  orchestrator,
  directory,
}: StatusSources): Promise<StatusReport> => {
  const network = orchestrator.snapshot();
  const peers = network.peers.map((peer) => ({
    ...peer,
    name: directory.nameOf(peer.nodeId),
  }));
  const nodes = directory.entries(
    {
      name: configuration.nodeName,
      nodeId: network.nodeId,
      role: network.role,
    },
    peers.map((peer) => peer.nodeId),
  );

  return {
    nodeName: configuration.nodeName,
    nodeId: network.nodeId,
    publicUrl: configuration.publicUrl,
    domain: network.domain,
    role: network.role,
    hubNodeId: network.hubNodeId,
    hubAddress: network.hubAddress,
    peers,
    nodes,
    storage: configuration.storage,
    seedSize: configuration.seedSize,
    tables: await store.tableRowCounts(),
  };
};

/**
 * Registers `GET /status`. The response allows cross-origin reads so that
 * the web app served by one node can show what another node reports.
 */
export const registerStatusRoute = (
  server: FastifyInstance,
  sources: StatusSources,
): void => {
  server.get('/status', async (_request, reply): Promise<StatusReport> => {
    reply.header('access-control-allow-origin', '*');
    return buildStatusReport(sources);
  });
};
