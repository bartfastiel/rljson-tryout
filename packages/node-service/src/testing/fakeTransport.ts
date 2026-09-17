import type {
  RoleContext,
  Transport,
  TransportSnapshot,
} from '../network/hubTransport.ts';

export type TransportCall =
  | { kind: 'hub'; hubAddress: string | null; context?: RoleContext }
  | { kind: 'client'; hubAddress: string; context?: RoleContext }
  | { kind: 'standalone' };

/**
 * A `HubTransport` stand-in for the orchestrator's unit tests: it opens no
 * socket, records every transition it was asked for and reports the role
 * of the last one in its snapshot, the way the real transport would once
 * the transition completed.
 */
export class FakeTransport implements Transport {
  readonly calls: TransportCall[] = [];
  stopped = 0;
  private current: TransportSnapshot = {
    role: 'standalone',
    hubAddress: null,
    lastError: null,
  };

  async becomeHub(
    hubAddress: string | null,
    context?: RoleContext,
  ): Promise<void> {
    this.calls.push({ kind: 'hub', hubAddress, context });
    this.current = {
      role: 'hub',
      hubAddress,
      connectedClients: 0,
      lastError: null,
    };
  }

  async becomeClient(hubAddress: string, context?: RoleContext): Promise<void> {
    this.calls.push({ kind: 'client', hubAddress, context });
    this.current = {
      role: 'client',
      hubAddress,
      connectedToHub: false,
      lastError: null,
    };
  }

  async becomeStandalone(): Promise<void> {
    this.calls.push({ kind: 'standalone' });
    this.current = { role: 'standalone', hubAddress: null, lastError: null };
  }

  async stop(): Promise<void> {
    this.stopped += 1;
    this.current = { role: 'standalone', hubAddress: null, lastError: null };
  }

  snapshot(): TransportSnapshot {
    return this.current;
  }
}
