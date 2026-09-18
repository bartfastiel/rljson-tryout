import type { HashedChangeSetRow } from '@rljson-tryout/domain';

import type { RoleOrchestrator } from '../network/roleOrchestrator.ts';
import type { SyncAgent } from '../network/syncAgent.ts';
import type { TopologySources } from '../routes/status.ts';
import type { PetShopStore } from '../store/petShopStore.ts';
import type { EventHub } from './eventHub.ts';
import { TopologyWatch, type TopologyWatchOptions } from './topologyWatch.ts';

/**
 * The payload of the SSE `insert` event: one change set this node wrote
 * itself, by hash and id, how many rows per table it named (history
 * tables included, like a transfer's `tables`) and the ids of the
 * entities it wrote.
 */
export type InsertEvent = {
  changeSetHash: string;
  changeSetId: string;
  tables: Record<string, number>;
  entityIds: string[];
};

export const insertEventOf = (
  changeSet: HashedChangeSetRow,
  entityIds: readonly string[],
): InsertEvent => {
  const tables: Record<string, number> = {};
  for (const item of changeSet.items) {
    tables[item.table] = (tables[item.table] ?? 0) + 1;
  }
  return {
    changeSetHash: changeSet._hash,
    changeSetId: changeSet.id,
    tables,
    entityIds: [...entityIds],
  };
};

export type LiveEventSources = TopologySources & {
  store: Pick<PetShopStore, 'onChangeSetWritten'>;
  syncAgent: Pick<SyncAgent, 'onTransfer'>;
  orchestrator: Pick<RoleOrchestrator, 'snapshot' | 'onChange'>;
};

/**
 * Connects the three sources of live events to the hub: the store's
 * change sets become `insert` events, the sync agent's transfers `sync`
 * events, and the topology watch publishes `topology` whenever the
 * network report changes. `start` subscribes (the server does it once it
 * is ready, so the seed written before that is not streamed to nobody),
 * `stop` unsubscribes.
 */
export class LiveEvents {
  private readonly hub: EventHub;
  private readonly sources: LiveEventSources;
  private readonly watch: TopologyWatch;
  private unsubscribes: (() => void)[] = [];

  constructor(
    hub: EventHub,
    sources: LiveEventSources,
    options: TopologyWatchOptions = {},
  ) {
    this.hub = hub;
    this.sources = sources;
    this.watch = new TopologyWatch(
      sources,
      (topology) => hub.publish('topology', topology),
      options,
    );
  }

  start(): void {
    if (this.unsubscribes.length > 0) {
      return;
    }
    this.watch.start();
    this.unsubscribes = [
      this.sources.store.onChangeSetWritten((changeSet, entityIds) =>
        this.hub.publish('insert', insertEventOf(changeSet, entityIds)),
      ),
      this.sources.syncAgent.onTransfer((transfer) =>
        this.hub.publish('sync', transfer),
      ),
      this.sources.orchestrator.onChange(() => this.watch.check()),
      () => this.watch.stop(),
    ];
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes.splice(0)) {
      unsubscribe();
    }
  }
}
