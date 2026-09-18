import type { SeedSize } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';

import type { Configuration, StorageKind } from '../configuration.ts';
import type { TransportSnapshot } from '../network/hubTransport.ts';
import type {
  DirectoryEntry,
  NodeDirectory,
} from '../network/nodeDirectory.ts';
import type {
  IdentitySnapshot,
  NodeRole,
  PeerSnapshot,
  RoleOrchestrator,
} from '../network/roleOrchestrator.ts';
import type { SyncAgent, SyncSnapshot } from '../network/syncAgent.ts';
import type { PetShopStore } from '../store/petShopStore.ts';

/**
 * A discovered peer as `/status` lists it: the orchestrator's snapshot
 * plus the display name the directory learned for that node id, when any.
 */
export type StatusPeer = PeerSnapshot & { name: string | null };

export type StatusNode = DirectoryEntry & { seenInTopology: boolean };

/**
 * The answer of `GET /status` (roadmap section 2.5): this node's identity
 * (its id, where the id comes from and when this run started) and role,
 * the hub it follows or is, the peers discovery knows, every node of the
 * environment with one flag from discovery and one from the server-side
 * probe, the state of the hub transport, the change set synchronisation
 * (counters, the last transfers and the last catch-up), and the row
 * counts of the store.
 */
export type StatusReport = {
  nodeName: string;
  nodeId: string | null;
  identity: IdentitySnapshot | null;
  publicUrl: string;
  domain: string;
  role: NodeRole;
  hubNodeId: string | null;
  hubAddress: string | null;
  peers: StatusPeer[];
  nodes: StatusNode[];
  transport: TransportSnapshot;
  sync: SyncSnapshot;
  storage: StorageKind;
  seedSize: SeedSize;
  tables: Record<string, number>;
};

export type StatusSources = Readonly<{
  configuration: Pick<
    Configuration,
    'nodeName' | 'publicUrl' | 'rljsonDomain' | 'storage' | 'seedSize'
  >;
  store: Pick<PetShopStore, 'tableRowCounts'>;
  orchestrator: Pick<RoleOrchestrator, 'snapshot'>;
  directory: Pick<NodeDirectory, 'entries' | 'nameOf'>;
  syncAgent: Pick<SyncAgent, 'snapshot'>;
}>;

/**
 * The network part of `/status`, which the SSE `topology` event streams
 * whenever it changes (slice B13): this node's id and role, the hub, the
 * peers discovery knows, every node of the environment as the directory
 * sees it, and the state of the hub transport.
 */
export type TopologyReport = {
  nodeId: string | null;
  identity: IdentitySnapshot | null;
  role: NodeRole;
  hubNodeId: string | null;
  hubAddress: string | null;
  peers: StatusPeer[];
  nodes: StatusNode[];
  transport: TransportSnapshot;
};

export type TopologySources = Pick<
  StatusSources,
  'orchestrator' | 'directory'
> & { configuration: Pick<Configuration, 'nodeName'> };

export const buildTopologyReport = ({
  configuration,
  orchestrator,
  directory,
}: TopologySources): TopologyReport => {
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
      connectedClients:
        network.transport.role === 'hub'
          ? network.transport.connectedClients
          : null,
      identity:
        network.identity === null
          ? null
          : {
              persistent: network.identity.persistent,
              startedAt: network.identity.startedAt,
            },
    },
    peers.map((peer) => peer.nodeId),
  );

  return {
    nodeId: network.nodeId,
    identity: network.identity,
    role: network.role,
    hubNodeId: network.hubNodeId,
    hubAddress: network.hubAddress,
    peers,
    nodes,
    transport: network.transport,
  };
};

export const buildStatusReport = async ({
  configuration,
  store,
  orchestrator,
  directory,
  syncAgent,
}: StatusSources): Promise<StatusReport> => {
  const topology = buildTopologyReport({
    configuration,
    orchestrator,
    directory,
  });

  return {
    nodeName: configuration.nodeName,
    nodeId: topology.nodeId,
    identity: topology.identity,
    publicUrl: configuration.publicUrl,
    domain: configuration.rljsonDomain,
    role: topology.role,
    hubNodeId: topology.hubNodeId,
    hubAddress: topology.hubAddress,
    peers: topology.peers,
    nodes: topology.nodes,
    transport: topology.transport,
    sync: syncAgent.snapshot(),
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
