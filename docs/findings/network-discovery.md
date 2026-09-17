# Discovery and hub election with `@rljson/network`

## What we tried

- `@rljson/network` 0.0.21 (published 2026-09-13, no dependencies of its
  own), Node 24, while building slice D1. Read `dist/index.d.ts`,
  `dist/network-manager.d.ts`, the type files under `dist/types`, the
  bundled `dist/network.js` (`NetworkManager`, `BroadcastLayer`,
  `ProbeScheduler`, `ProbeListener`, `electHub`, `NodeIdentity`) and
  `README.architecture.md` / `README.public.md` of the package.
- Wrapped `NetworkManager` in `RoleOrchestrator`
  (`packages/node-service/src/network/roleOrchestrator.ts`) with
  `{ domain, port: HUB_PORT, identityDir: <DATA_DIR>/identity, broadcast:
{ enabled: true, port: BROADCAST_PORT }, probing: { enabled: true } }`, all
  other settings at the library defaults (broadcast every 5 000 ms, peer
  timeout 15 000 ms, probe every 10 000 ms with a 2 000 ms timeout and a
  fail threshold of 3, self-test timeout 2 000 ms).
- Started three containers of the node service image on one user-defined
  Docker bridge network (`deploy/compose/three-nodes.yml`, domain
  `petshop-compose`), read `/status` of every node, collected the logs with
  `LOG_LEVEL=debug`, restarted the hub container with `docker compose
restart`, and ran the Gherkin feature `features/network.feature` through
  `pnpm --filter @rljson-tryout/node-service test:integration`, which
  measures the time from `compose up` to a settled topology.
- Kubernetes: the same image is deployed with `hostNetwork` left off, so
  the broadcast socket binds inside the pod's own network namespace on the
  flannel bridge of the single k3s node (roadmap 3.3, plan decision D2).

## What happened

Shape of the library (what the roadmap's section 3.3 did not say):

- `NodeInfo` carries `nodeId` (a UUID persisted at
  `<identityDir>/<domain>/node-id`), `hostname` (`os.hostname()`),
  `localIps` (every non-internal IPv4 address), `domain`, `port` and
  `startedAt`. There is no display name and no metadata field, and the
  broadcast packet is exactly `JSON.stringify(NodeInfo)`. A URL a browser
  can open therefore has to be learned elsewhere: every node exposes
  `nodeId` and `PUBLIC_URL` in `/status`, and `NodeDirectory` polls
  `/status` of every entry of `NODE_URLS` every 3 seconds (1.5 second
  timeout) to correlate ids with URLs and names.
- `NetworkTopology` has `domain`, `hubNodeId`, `hubAddress` (`ip:port` of
  the hub, from `localIps[0]`), `formedBy` (`broadcast`, `cloud`,
  `election`, `manual`, `static`), `formedAt`, `nodes` (every known
  `NodeInfo` including self, keyed by id), `probes` (the latest
  `PeerProbe` per peer: `reachable`, `latencyMs`, `measuredAt`) and
  `myRole` (`hub`, `client` or `unassigned`). The events are
  `topology-changed`, `role-changed` (`previous`, `current`), `hub-changed`
  (`previousHub`, `currentHub`), `peer-joined` (`NodeInfo`), `peer-left`
  (`nodeId`) and `log` (`{ category, message }` with the categories
  `election`, `probe`, `peer`, `topology`, `layer`).
- Election (`electHub`, a pure function): candidates are self plus every
  peer whose latest probe succeeded; the incumbent hub is kept while it is
  reachable and no reachable candidate has an earlier `startedAt`;
  otherwise the earliest `startedAt` wins, ties broken by the smaller
  `nodeId`. A node that would elect itself while an earlier, never yet
  reachable broadcast peer exists defers (stays `unassigned`) until that
  peer answers a probe, which is the guard against two hubs at a cold
  start.
- The probe listener and the hub transport share `HUB_PORT`: while a node
  is not the hub, `NetworkManager` runs a tiny TCP server on that port that
  accepts and closes every connection; the moment the node becomes the
  hub, the manager closes that server (`_ensureProbeListenerState`) and
  expects the application's hub server to bind the port instead. Without
  a hub server every other node's probe against the hub fails on the next
  cycle, the hub drops out of their election and every node elects itself
  in turn. `HubPortListener`
  (`packages/node-service/src/network/hubPortListener.ts`) therefore binds
  the port while this node is the hub until slice D2 puts the socket.io
  server there. The handoff back is seamless: the manager's `listen` on
  the shared port runs in a later macrotask than the `role-changed`
  handler that closes the hub listener, so no `EADDRINUSE` was logged in
  any run.
- `NetworkManager.stop()` keeps the event subscriptions on purpose (a
  documented lesson from `@rljson/server`'s `Node`, which went deaf after a
  stop and restart), and `BroadcastLayer.stop()` clears its own listeners,
  so a manager is started once per process.
- `probes` reflect the raw result of the last cycle; the "flap dampening"
  of `failThreshold` only delays the `peer-unreachable` event and the
  `_wasReachable` flag. `electHub` reads the raw probes, so one failed
  probe already removes a peer from the candidates.

Broadcast inside a Docker bridge network:

- The `udp4` socket with `reuseAddr` sends to `255.255.255.255:41234` and
  every container on the user-defined bridge received the packets; the
  self-test (own packet looped back) passed on every node within
  milliseconds, so `formedBy` was `broadcast` throughout.
- Three containers starting within 100 ms of each other: node2 (the
  earliest `startedAt`) discovered both others from their self-test
  packets and elected itself 100 ms after its own start. node1 missed
  node2's first packet (node1's socket was not bound yet), saw only node3,
  elected itself as well (a second hub for one broadcast interval), and
  stepped down to `client` 5.0 s later when node2's next periodic
  announcement arrived; node3 elected node2 in the same moment. Measured
  in three runs: 5.0 s from the first `discovery started` log line to all
  three nodes agreeing, bounded by the 5 000 ms broadcast interval.
- The integration test reports both numbers of its run: the containers
  were healthy 11.3 s after `compose up` (image already built, Docker
  health check with a 5 s start period), and the topology had settled 30
  ms after that, so the election finishes while `compose up --wait` is
  still waiting for the health checks.
- Probe round trips between containers were 0.4 to 1.3 ms.
- `/status` of the three nodes after settling (abridged):

  ```text
  node1  role client  hub 172.21.0.2:3000  peers node2:hub node3:client
  node2  role hub     hub 172.21.0.2:3000  peers node1:client node3:client
  node3  role client  hub 172.21.0.2:3000  peers node1:client node2:hub
  ```

  and every node's `nodes` list carried all three URLs with
  `seenInTopology: true` and `reachable: true`.

Restarting the hub container (`docker compose restart node3`, about one
second of downtime):

- node3 came back with the same node id (the identity file in `/data`
  survives a container restart, not a `down`) and a new `startedAt`.
- node1 and node2 kept node3 as their hub: no `peer-left` fired (the
  15 s broadcast timeout was not reached), the returning node's probe
  listener answered on port 3000 (it did not know it was anyone's hub), and
  their peer table still held node3's old `startedAt`. `BroadcastLayer`
  updates its own entry on every packet, but the `PeerTable` only receives
  a `NodeInfo` on `peer-discovered`, so the election on node1 and node2
  still saw node3 as the earliest node.
- node3 itself, with its `_currentHubId` gone, elected node1 (now the
  earliest `startedAt` it knows) and became its client.
- Two minutes later the views were unchanged: node1 and node2 say the hub
  is node3, node3 says the hub is node1. A permanent split view without a
  single failed probe. Slices D6 and D7 have to handle this: a returning
  node must either keep a record of the hub it was, or the others must
  re-elect when a peer's `startedAt` changes.

Kubernetes (single node in production so far):

- `DATA_DIR=/data` needs a volume because the pod runs with a read-only
  root filesystem; an `emptyDir` with `fsGroup: 1000` is enough for the
  identity of the in-memory node (slice C1 replaces it by the claim that
  holds the SQLite file). The image creates `/data` owned by `node` so
  that a plain `docker run` works without a mount.
- `hostNetwork` is not used. The broadcast socket binds inside the pod
  and the announcement leaves through the pod's `eth0` onto the flannel
  bridge; the three-node proof in production follows with slice C3, the
  single-node deployment of this slice proves that the sockets bind and
  the node reports `standalone`.

Timings measured in this slice: see above (0.1 s self-election of the
earliest node, 5.0 s to full agreement, probe latency under 1.3 ms,
containers healthy 11.3 s after `compose up`).

## What it means for rljson users

- Plan for the hub port from the start: the application must bind the
  hub port as soon as `role-changed` reports `hub`, even before it has a
  real hub transport, or the election never settles. A probe cannot tell
  a real hub from a stub, which cuts both ways (see the restart above).
- Expect one broadcast interval (5 s by default) of disagreement at a
  cold start and up to two hubs during that time; an application that
  starts its hub transport on `role-changed` has to cope with being
  demoted right after.
- Announcements carry ids and IP addresses only. Anything user-facing
  (names, URLs) needs a side channel; `/status` polling over the public
  URLs works but costs one HTTP request per node and interval, and in a
  preview environment with staging certificates the server-side poll will
  need the in-cluster URLs (slice C3).
- A persistent identity on a node that restarts quickly is not enough for
  the others to notice the restart; `startedAt` changes but nobody
  re-reads it. Until that is fixed upstream, a restarting hub should stay
  down longer than the broadcast timeout, or the application must handle
  a peer that disagrees about the hub.
- `NetworkManager` logs a lot at `election` and `probe` granularity on
  every probe cycle; forward those at debug level and log the
  `role-changed`, `hub-changed`, `peer-joined` and `peer-left` events
  yourself.

## Candidates for upstream issues

- `PeerTable` never updates the `NodeInfo` of a known peer: `BroadcastLayer`
  emits `peer-discovered` only for a new `nodeId`, so a peer that restarts
  with the same id keeps its old `startedAt` in every other node's
  election, and the returning node and its peers can disagree about the
  hub for good. Reproduction: three nodes with persistent identity, restart
  the hub within the broadcast timeout, compare `hubNodeId` in
  `getTopology()` on the returning node and on a survivor.
- `electHub` reads the raw probe results, so the `failThreshold`
  dampening never reaches the election; one lost probe removes a peer from
  the candidates while `peer-unreachable` is still withheld. Reproduction:
  a probe function that fails once, then succeeds; `hub-changed` fires on
  the first failure.
- A `NodeInfo` field for application metadata (a display name, a public
  URL) would remove the need for a side channel to correlate ids with
  something a person can use.
- The role-based port handoff makes a returning node's probe listener
  answer on the hub port before the application has decided whether it is
  the hub, so peers keep probing "their" hub successfully although no hub
  transport is behind the port; a probe protocol that identifies the hub
  transport (or an explicit "I am not the hub" answer) would let survivors
  notice.
