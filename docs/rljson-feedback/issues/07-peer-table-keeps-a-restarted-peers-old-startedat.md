# `PeerTable` never refreshes a known peer's `NodeInfo`, so a quickly restarted hub leaves the network with two opinions about the hub

- Package: `@rljson/network` 0.0.21 (`BroadcastLayer._handleMessage`,
  `PeerTable.attachLayer`, `electHub`)
- Environment: Node 24.18.0; observed with three containers on Docker
  Desktop (Windows 11 Pro 10.0.26200) and reproduced in-process below
- Severity: correctness of the election (permanent split view, no error)

## Reproduction

```js
import {
  BroadcastLayer,
  NodeIdentity,
  PeerTable,
  electHub,
} from '@rljson/network';

let deliver = () => {};
const socket = {
  bind: async () => {},
  send: async (data) => deliver(data),
  onMessage: (handler) => {
    deliver = (data) => handler(data, { address: '10.0.0.9', port: 41234 });
  },
  setBroadcast: () => {},
  close: async () => {},
};

const self = new NodeIdentity({
  nodeId: 'self',
  hostname: 'self',
  localIps: ['10.0.0.1'],
  domain: 'd',
  port: 3000,
  startedAt: 2000,
});
const layer = new BroadcastLayer(
  { enabled: true, port: 41234, intervalMs: 60_000, timeoutMs: 60_000 },
  { createSocket: () => socket },
);
const table = new PeerTable();
table.setSelfId('self');
table.setSelfDomain('d');
table.attachLayer(layer);
await layer.start(self);

const packet = (startedAt) =>
  Buffer.from(
    JSON.stringify({
      nodeId: 'peer',
      hostname: 'peer',
      localIps: ['10.0.0.9'],
      domain: 'd',
      port: 3000,
      startedAt,
    }),
  );
deliver(packet(1000)); // the peer started before us: it is the hub
deliver(packet(3000)); // the peer restarted with its persistent id and a new startedAt

console.log('startedAt in the layer:     ', layer.getPeers()[0].startedAt);
console.log('startedAt in the PeerTable: ', table.getPeer('peer').startedAt);
const probes = [
  {
    fromNodeId: 'self',
    toNodeId: 'peer',
    reachable: true,
    latencyMs: 1,
    measuredAt: Date.now(),
  },
];
console.log(
  'election over the PeerTable: ',
  JSON.stringify(electHub([self, ...table.getPeers()], probes, null, 'self')),
);
console.log(
  'election over the layer:     ',
  JSON.stringify(electHub([self, ...layer.getPeers()], probes, null, 'self')),
);
await layer.stop();
```

## Expected

After the restart every node holds the peer's new `startedAt` (3000) and
elects the earliest running node (`self`), the same result the returning
node computes for itself.

## Actual

```text
startedAt in the layer:      3000
startedAt in the PeerTable:  1000
election over the PeerTable:  {"hubId":"peer","reason":"earliest-start"}
election over the layer:      {"hubId":"self","reason":"earliest-start"}
```

`BroadcastLayer._handleMessage` updates its own map on every packet but
emits `peer-discovered` only for a new `nodeId`; `PeerTable` receives a
`NodeInfo` only through that event, and `NetworkManager._computeHub` feeds
`electHub` from the `PeerTable`. A peer that restarts within the broadcast
timeout (15 s by default, so no `peer-left` fires) therefore keeps its old
`startedAt` in every other node's election forever.

Observed on Compose (`docker compose restart node3` of the hub, about one
second of downtime, persistent identity under `/data`): node1 and node2
kept node3 as hub without a single failed probe (the returning node's
probe listener answers on the hub port), node3 elected node1 and became
its client, and two minutes later nothing had changed
(`docs/findings/network-discovery.md`). A stop longer than the broadcast
timeout heals cleanly.

## Impact on us

A hub restart shorter than 15 s (a `kubectl rollout` of a StatefulSet pod
takes about 6 s) splits the network until something else disturbs it.

## Workaround

None inside the library. Operationally: restart a hub slowly, or handle a
peer that disagrees about the hub in the application (roadmap slices D6
and D7).

## Suggested fix

Emit a `peer-updated` event (or re-emit `peer-discovered`) when a packet
carries a different `startedAt` (or any changed field) for a known
`nodeId`, and let `PeerTable` replace the entry. A changed `startedAt` is
also the signal to drop the incumbent (`_currentHubId`) on the survivors.
