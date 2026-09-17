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
- Slice C3 (pull request #35): three pods of one domain on that bridge,
  first as the preview of the pull request (namespace `pr-35`, three
  memory nodes, staging certificates) with a temporary kubeconfig from the
  cluster state to read the pod logs, `kubectl top` and `/proc/net/udp`,
  then as production (`node1` and `node2` over SQLite, `node3` in memory),
  while production's own node1 shared the bridge with the preview during
  the first test.

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
- The library exposes no "last heard from" per peer (`BroadcastLayer`
  keeps one internally for its timeout but does not publish it), so the
  `lastSeen` of a peer in `/status` is derived from the events: it is set
  on `peer-joined` and advanced on every `topology-changed` for every peer
  still in the table, which happens on every probe cycle at the latest.
  It therefore means "discovery still lists this peer at that time", not
  "this peer announced itself at that time": a peer that stops
  broadcasting keeps a fresh `lastSeen` until the 15 s broadcast timeout
  drops it with `peer-left`. `probe.measuredAt` and `probe.reachable` are
  the signal for whether a peer actually answered.

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

Kubernetes, one node (slice D1):

- `DATA_DIR=/data` needs a volume because the pod runs with a read-only
  root filesystem; an `emptyDir` with `fsGroup: 1000` is enough for the
  identity of the in-memory node (slice C1 replaces it by the claim that
  holds the SQLite file). The image creates `/data` owned by `node` so
  that a plain `docker run` works without a mount.
- `hostNetwork` is not used. The broadcast socket binds inside the pod
  and the announcement leaves through the pod's `eth0` onto the flannel
  bridge; the three-node proof in production follows with slice C3. The
  preview of pull request #32 (namespace `pr-32`, one pod at 10.42.0.51)
  proved the single-node case, read with a temporary kubeconfig: the pod
  logged `discovery started` with the pod address, `/proc/net/udp` showed
  `0.0.0.0:41234` and `/proc/net/tcp` the probe listener on `0.0.0.0:3000`
  next to the HTTP port, both owned by uid 1000, `/data/identity/petshop-pr-32/node-id`
  held the id `/status` reported, and `/status` answered
  `role: "standalone"` with `domain: "petshop-pr-32"` and itself as the
  only `nodes` entry. Whether the broadcast self-test passed on the flannel
  bridge is not observable for a lone node: `NetworkManager` exposes no
  layer state, and `formedBy` only turns to `broadcast` once a peer was
  discovered that way.

Kubernetes, three pods on the flannel bridge (slice C3):

- The UDP broadcast to `255.255.255.255:41234` reaches the other pods.
  Three pods of namespace `pr-35` (10.42.0.67 to 10.42.0.69, all on the
  one k3s node) logged `peer joined` for both others and every hub change
  carried `formedBy: broadcast`; nothing else was configured, no
  `hostNetwork`, no multicast, no static hub list. The roadmap's plan B
  (the static hub fallback of `@rljson/network`) was therefore not
  implemented.
- The cold start repeated the compose measurement to the millisecond
  class: the three pods started within 104 ms of each other; node3 (the
  earliest `startedAt`) heard node2's self-test packet 86 ms after its own
  start and elected itself; node2 heard node1 but had missed node3's first
  packet (its socket was not bound yet), elected itself as a second hub
  and bound the hub port; node1, last to start, heard nobody for one
  interval and stayed `unassigned`. 4.9 s after the start node3's periodic
  announcement reached both: node2 logged `Hub changed: 09e800bc →
8beb38b3`, stepped down to `client` and released the hub port, node1
  became a client of node3 in the same second. All three agreed 5.0 s
  after the first `discovery started`, again bounded by the 5 000 ms
  broadcast interval. Probe round trips between pods were 0.63 to 0.83 ms.
- Production's node1 (namespace `petshop`, domain `petshop-production`,
  10.42.0.66) sat on the same bridge throughout and received the same
  packets; it logged no `peer joined` and stayed `standalone`, so the
  `domain` field alone keeps the environments apart, as planned.
- The directory of a preview cannot poll the public hosts: Node's `fetch`
  trusts only the bundled root certificates, not the Let's Encrypt
  staging chain, so every other node would have stayed unreachable with
  `seenInTopology: false` although discovery had found it (the open point
  of D1). Since C3 every pod carries `NODE_STATUS_URLS`,
  the ClusterIP service URLs (`http://<node>.<namespace>.svc.cluster.local`)
  at the same positions as `NODE_URLS`, and the directory polls those:
  `node reachable` for both others was logged with the service URL 3 s
  after the start, in the second poll round, because a ClusterIP service
  only forwards to a pod once its readiness probe has passed (the first
  round ran while the other pods were still starting). The public URL
  stays the key of every directory entry and the link the header shows.
- The smoke job's `verify-deployment.sh` saw the three preview hosts
  settle at once (`network settled with the roles: node1 client, node2
client, node3 hub`, every node seeing the two others), 29 s after the
  Terraform apply ended, staging certificates included.
- Memory: a memory node used 35 MiB and the SQLite node1 27 MiB at rest
  (`kubectl top`), against requests of 128 MiB and limits of 512 MiB per
  pod from slice A9. Three nodes therefore reserve 300m CPU and 384 MiB
  and may grow to 1.5 CPU and 1.5 GiB; the whole k3s node (system pods,
  Traefik, cert-manager, four pet shop pods) used 1.2 GiB of its 8 GiB
  during the test, which leaves room for the SQL Server of slice C4
  (`MSSQL_MEMORY_LIMIT_MB=1536`) and the large seeds of C5 and D8.

Timings measured in D1 and C3: 0.1 s self-election of the earliest node,
5.0 s to full agreement in compose and in k3s alike, probe latency under
1.3 ms, containers healthy 11.3 s after `compose up`.

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
  (names, URLs) needs a side channel; `/status` polling works but costs
  one HTTP request per node and interval, and the poll address is not
  the link address: inside Kubernetes the poll goes to the ClusterIP
  service (no TLS, no dependency on the public certificate), the link to
  the public host (`NODE_STATUS_URLS` next to `NODE_URLS` since C3).
- One k3s node with flannel delivers UDP broadcasts between pods without
  any configuration, and the `domain` field of the announcements is enough
  to keep several environments on that bridge apart. A second server
  (slice E5) changes this: flannel's VXLAN overlay is not expected to
  carry a broadcast frame to the pods of another host, so that is where
  the static hub fallback or a cloud discovery of `@rljson/network` will
  have to be tried.
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
