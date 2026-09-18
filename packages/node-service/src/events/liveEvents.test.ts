import { hashed } from '@rljson-tryout/domain';
import { describe, expect, it } from 'vitest';

import type { NetworkSnapshot } from '../network/roleOrchestrator.ts';
import type { SyncTransfer } from '../network/syncAgent.ts';
import type { ChangeSetListener } from '../store/petShopStore.ts';
import { recordingLogger } from '../testing/recordingLogger.ts';
import { EventHub, type EventSink } from './eventHub.ts';
import { insertEventOf, LiveEvents } from './liveEvents.ts';

class RecordingSink implements EventSink {
  readonly chunks: string[] = [];
  writableLength = 0;
  writableEnded = false;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): void {
    this.writableEnded = true;
  }

  destroy(): void {
    this.writableEnded = true;
  }

  get eventNames(): string[] {
    return this.chunks
      .map((chunk) => /^event: (\w+)$/m.exec(chunk)?.[1])
      .filter((name): name is string => name !== undefined);
  }
}

const standalone: NetworkSnapshot = {
  nodeId: 'id-node1',
  role: 'standalone',
  domain: 'petshop-test',
  hubNodeId: null,
  hubAddress: null,
  peers: [],
  transport: { role: 'standalone', hubAddress: null, lastError: null },
};

/**
 * Live events over fakes of the three sources: the test fires the store's
 * listener, the agent's listener and the orchestrator's change with a
 * changed snapshot, and reads what reached a connected sink.
 */
const liveEventsOverFakes = () => {
  const { logger } = recordingLogger();
  const hub = new EventHub(logger);
  const sink = new RecordingSink();
  hub.add(sink);
  const changeSetListeners = new Set<ChangeSetListener>();
  const transferListeners = new Set<(transfer: SyncTransfer) => void>();
  const changeListeners = new Set<() => void>();
  let snapshot = standalone;
  const liveEvents = new LiveEvents(hub, {
    configuration: { nodeName: 'node1' },
    store: {
      onChangeSetWritten: (listener) => {
        changeSetListeners.add(listener);
        return () => changeSetListeners.delete(listener);
      },
    },
    syncAgent: {
      onTransfer: (listener) => {
        transferListeners.add(listener);
        return () => transferListeners.delete(listener);
      },
    },
    orchestrator: {
      snapshot: () => snapshot,
      onChange: (listener) => {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
      },
    },
    directory: { entries: () => [], nameOf: () => null },
  });
  return {
    liveEvents,
    sink,
    writeChangeSet: () => {
      for (const listener of changeSetListeners) {
        listener(hashed({ id: 'x', items: [] }), ['x']);
      }
    },
    transfer: () => {
      for (const listener of transferListeners) {
        listener({
          direction: 'outgoing',
          peerNodeId: null,
          changeSetHash: 'h',
          changeSetId: 'x',
          tables: {},
          durationMs: 0,
          at: '2026-09-18T10:00:00.000Z',
          status: 'completed',
        });
      }
    },
    becomeHub: () => {
      snapshot = { ...standalone, role: 'hub', hubNodeId: 'id-node1' };
      for (const listener of changeListeners) {
        listener();
      }
    },
    listenerCount: () =>
      changeSetListeners.size + transferListeners.size + changeListeners.size,
  };
};

describe('insertEventOf', () => {
  it('counts the rows per table and copies the entity ids', () => {
    const changeSet = hashed({
      id: 'issue-invoice-2026-0007',
      items: [
        { table: 'invoices', ref: 'a' },
        { table: 'invoicesInsertHistory', ref: 'b' },
        { table: 'invoiceItems', ref: 'c' },
        { table: 'invoiceItems', ref: 'd' },
      ],
    });
    const entityIds = ['invoice-2026-0007'];

    const event = insertEventOf(changeSet, entityIds);

    expect(event).toStrictEqual({
      changeSetHash: changeSet._hash,
      changeSetId: 'issue-invoice-2026-0007',
      tables: { invoices: 1, invoicesInsertHistory: 1, invoiceItems: 2 },
      entityIds: ['invoice-2026-0007'],
    });
    expect(event.entityIds).not.toBe(entityIds);
  });
});

describe('LiveEvents', () => {
  it('publishes nothing before start and everything between start and stop', () => {
    const fakes = liveEventsOverFakes();
    fakes.writeChangeSet();
    fakes.transfer();
    expect(fakes.sink.eventNames).toStrictEqual([]);

    fakes.liveEvents.start();
    fakes.liveEvents.start();
    fakes.writeChangeSet();
    fakes.transfer();
    fakes.becomeHub();
    expect(fakes.sink.eventNames).toStrictEqual(['insert', 'sync', 'topology']);
    expect(fakes.listenerCount()).toBe(3);

    fakes.liveEvents.stop();
    fakes.writeChangeSet();
    fakes.transfer();
    expect(fakes.sink.eventNames).toStrictEqual(['insert', 'sync', 'topology']);
    expect(fakes.listenerCount()).toBe(0);
  });

  it('publishes the topology once the orchestrator reports a change', () => {
    const fakes = liveEventsOverFakes();
    fakes.liveEvents.start();

    fakes.becomeHub();

    expect(fakes.sink.eventNames).toStrictEqual(['topology']);
    expect(fakes.sink.chunks.at(-1)).toContain('"role":"hub"');
    fakes.liveEvents.stop();
  });
});
