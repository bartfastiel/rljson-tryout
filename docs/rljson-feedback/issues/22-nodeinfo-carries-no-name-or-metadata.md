# `NodeInfo` carries no display name and no metadata, and `NetworkManager` exposes no "last heard from" per peer

- Package: `@rljson/network` 0.0.21 (`NodeInfo`, `BroadcastLayer`,
  `NetworkTopology`)
- Environment: Node 24.18.0; three nodes on Docker Desktop and k3s
- Severity: API gap (every application needs a side channel to show
  peers to a person)

## Reproduction

`dist/types/node-info.d.ts` of 0.0.21, complete:

```ts
export interface NodeInfo {
  nodeId: NodeId; // persistent UUID
  hostname: string; // os.hostname()
  localIps: string[]; // all non-internal IPv4 addresses
  domain: string;
  port: number; // port this node listens on when hub
  startedAt: number;
}
```

The broadcast packet is exactly `JSON.stringify(NodeInfo)`
(`BroadcastLayer._sendBroadcast`), and `NetworkTopology.nodes` is a map of
these. `BroadcastLayer` keeps `lastSeen` per peer for its own timeout but
does not publish it; `getTopology()` has `probes` (`measuredAt`,
`reachable`, `latencyMs`) and nothing about when a peer last announced.

## Expected

An optional, application-defined field (`metadata: Record<string, string>`
or `name`/`publicUrl`) that travels with the announcement, and a
`lastSeen` per peer in the topology.

## Actual

Inside a container the `hostname` is the container id, `localIps` the pod
address; nothing in the topology is something a person can click. Whether
a peer "is still announcing" can only be inferred from `peer-left` after
the 15 s timeout or from the probes.

## Impact on us

Every node publishes its `nodeId` and `PUBLIC_URL` in `/status`, and a
`NodeDirectory` polls `/status` of every URL of `NODE_URLS` every 3 s to
correlate ids with names and URLs (`packages/node-service/src/network/nodeDirectory.ts`);
in Kubernetes that needs a second list of in-cluster URLs because the
public certificate of a preview is not trusted by Node's `fetch`. The
`lastSeen` of a peer in `/status` is derived from `topology-changed`
events and means "still listed", not "heard from".

## Workaround

HTTP polling of every node's `/status`.

## Suggested fix

`NodeInfo.metadata` (size-bounded, carried verbatim), and `lastSeen` in
`NetworkTopology.nodes` or in `PeerProbe`.
