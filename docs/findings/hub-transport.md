# Hub transport with `@rljson/server` over socket.io

## What we tried

- `@rljson/server` 0.0.64, `@rljson/bs` 0.0.26, `@rljson/io` 0.0.78,
  `@rljson/db` 0.0.42, `socket.io` and `socket.io-client` 4.8.3 (the
  version the server package's own `devDependencies` name; it declares no
  socket.io dependency of its own), Node 24.18.0, while building slice D2.
  Read `README.md`, `README.public.md` and `README.architecture.md` of the
  package, `dist/server.d.ts`, `dist/client.d.ts`, `dist/node.d.ts`,
  `dist/socket-io-bridge.d.ts`, the bundled `dist/server.js` (`Server`,
  `Client`, `BaseNode`, `Node`, `SocketIoBridge`) and, in `@rljson/io`,
  `IoMulti`, `IoPeer`, `IoPeerBridge` and `IoServer`.
- Ran a throwaway script with a `Server` over an `IoMem` behind a socket.io
  server on port 0 and a `Client` over a second `IoMem` connected to it:
  inserted rows on either side, read them by hash, by `id` and as whole
  tables from the other side, closed the hub's socket server and read
  again, then tore both down and checked which stores were still open.
- Built `HubTransport` (`packages/node-service/src/network/hubTransport.ts`),
  driven by the `RoleOrchestrator` of slice D1 in place of its
  `HubPortListener`, with `IoSwitch` and `BorrowedIo` in front of and
  behind `PetShopStore` (`packages/node-service/src/store/`), and tested
  it with real socket.io on ephemeral ports (`hubTransport.test.ts`), with
  an in-process `IoMulti` over two stores (`petShopStore.network.test.ts`)
  and as the Gherkin feature `features/hub-transport.feature` both
  in-process (two nodes in one Vitest process, discovery disabled, roles
  given by hand) and against the three containers of
  `deploy/compose/three-nodes.yml`.
- Started the three containers by hand (host ports 8391 to 8393), read
  `/status` of every node, issued an invoice on the hub and read it by id
  on a client, edited an animal on the hub and read the new version by
  hash on a client, edited an animal on one client and read it by hash on
  the other client, timed the reads with `curl`, then stopped the hub
  container (`docker compose stop`), watched the two clients for twenty
  seconds and started the old hub again.

## What happened

Shape of the library (what roadmap section 3.3 did not say):

- `new Server(route, io, bs?, options)` and
  `new Client(socket, io, bs?, route?, options)` both extend `BaseNode`,
  whose constructor throws `Local Io must be initialized and open` unless
  `io.isOpen` is truthy, so the store is opened before either is built.
  `createTables({ withInsertHistory: [cfg, ...] })` runs
  `db.core.createTableWithInsertHistory(cfg)` on the local `Io`, the same
  `createInsertHistoryTableCfg` the domain package uses, so creating the
  ten domain tables again on every role change is a no-op on both stores.
  The `Bs` is optional since a route that carries no blobs needs none.
- `Server.init()` builds an `IoMulti` over `[local]` (priority 1, read,
  write, dump) and an `IoServer` over that multi. `addSocket(bridge)`
  creates an `IoPeer` and a `BsPeer` over the socket (each waits for
  `init()` and `isReady()` with `peerInitTimeoutMs`, 30 s by default),
  registers the client under `client_<n>_<random>`, rebuilds the multi as
  `[local, peer, peer, ...]` (peers at priority 2, read-only, not
  dumpable) and swaps it into the `IoServer`, sends the client a
  bootstrap message and repeats it after 1, 3 and 6 seconds, and starts a
  health check that pings every client every 30 s (`__health:ping` with a
  nonce, answered with `__health:pong`) and removes a client after three
  missed rounds. `server.io` is therefore a new object after every join
  and leave; whoever reads through it must ask for it on every call,
  which is why `IoSwitch` holds a function rather than the multi.
  `server.clients.size` counts the sockets `addSocket` accepted.
- `Client.init()` builds its own `IoMulti` over `[local (1), IoPeer to the
hub (2)]`, starts an `IoPeerBridge` over the local `Io` on the same
  socket (this is how the hub reads what the client holds), creates a
  `Db` over the multi and a `Connector` for the route, and tracks the
  socket's `connect` and `disconnect` events in `isConnected`,
  `onDisconnect` and `onReconnect`. The bridge it starts is never stopped:
  `tearDown()` clears the multis, the `Db` and the `Connector` but keeps
  the bridge's listeners on the socket, so the socket has to be dropped
  with the client.
- `Server.tearDown()` closes its `IoMulti`, and `IoMulti.close()` closes
  every member including the local `Io`: after a hub stepped down its own
  `IoMem` reported `isOpen: false` and an `IoSqliteNode` would have closed
  its file. `Client` has `ownsStores: false` for exactly this case
  (documented in its options with a story of an election burst that took
  a hub's store away); `Server` has no such option. The node therefore
  lends its store through `BorrowedIo`, whose `close()` does nothing, to
  both.
- `Node`, the package's own orchestrator, creates an `IoMem` and a `BsMem`
  in `start()` and hands them to every `Server` and `Client` it builds, so
  it cannot run a persistent store (plan decision D4). Its transitions
  were the model for ours: a queued `_performTransition` that tears the
  current role down (`server.tearDown()`, `hubTransport.close()`,
  `client.tearDown()`, `socket.disconnect()`), then `_becomeHub` (server
  first, then the transport, connections added with `addSocket`) or
  `_becomeClient` (connect with exponential backoff from 1 s to 16 s,
  then the `Client`), plus `_onHubChanged`, which reconnects a client
  whose hub changed while its role did not, because `NetworkManager`
  emits `hub-changed` without a `role-changed` then. It also carries the
  last known ref across roles (`seedLatestRef`) and steps down as hub
  when no client connected within 20 s while peers exist
  (`hubSelfCheckMs`), two things slice D3 and D6 will want.
- `SocketIoBridge` wraps either side's socket.io socket and only forwards
  `on`, `off`, `emit`, `removeAllListeners`, `connect` (a no-op on a
  server socket), `disconnect`, `connected` and `bufferedAmount`. A single
  socket serves all four channels (`ioUp`, `ioDown`, `bsUp`, `bsDown`;
  `normalizeSocketBundle` reuses one socket for all of them), so both ends
  register handlers for the same event names on the same socket and an
  `emit` only ever reaches the other end.
- `@rljson/server` 0.0.64 depends on `@rljson/network` 0.0.20 while this
  project pins 0.0.21, which installed two copies until
  `pnpm-workspace.yaml` got a fifth override (`docs/findings/versions.md`);
  the package's `Node` is the only consumer and this project never
  instantiates it.

What a multi does on a read miss (`IoMulti.readRows`, `@rljson/io` 0.0.78):

- Readables are grouped by priority and the groups are tried in
  ascending order; inside a group every readable is asked in parallel and
  the first one that returns rows wins. The walk stops at the first group
  that returned any row, so the local layer answers whenever it has a
  matching row and the hub is asked only on a local miss. What comes back
  is written into every writable layer that did not answer (the local
  store): the client's `animals` table went from 10 rows to 11 after one
  read by hash, and the hub's from 3 to 4 after reading a row a client
  had written. The cached row has no InsertHistory row, so the store's
  version rule (`docs/findings/entity-versions.md`) does not list it as a
  version; it is only reachable by the same targeted read again, now
  locally.
- Any `where` cascades, not only `_hash`: a read by `id` and a read by
  `invoiceRef` fell through to the hub exactly like a read by hash, and
  the hub's `IoServer` runs the clause on the hub's own multi, which fans
  it out to every other client's bridge when the hub's local store has no
  match. A whole-table read (`where: {}`) cascades too, and returns the
  first layer that holds any row of the table, which for an empty local
  table would be the hub's entire table, cached locally as a side effect.
  `IoSwitch` therefore keeps whole-table reads local and only routes
  targeted reads through the multi.
- A miss that every layer answered is an empty result (1 ms, no error). A
  read by hash where some layer could not answer at all (a closed socket,
  a timeout) throws the failure instead of an empty result; a read by any
  other column returns what the answering layers had. "Table not found"
  from a layer counts as an answer.
- The hub reading from a client is the same cascade one layer down: the
  hub's local store missed, the client's `IoPeerBridge` answered from the
  client's raw local `Io` (not its multi, so nothing recurses), and the
  hub cached the row.

What `IoPeer` requests look like on the wire:

- Every `Io` method is one socket.io event named like the method with the
  request as payload and a socket.io acknowledgement as the answer:
  `emit('readRows', { table, where }, (result, error) => ...)`,
  `emit('rowCount', table, (count, error) => ...)`,
  `emit('dumpTable', { table }, ...)`, `emit('readRowsByHashes', { table, hashes }, ...)`;
  `IoServer` answers with `(result, null)` or `(null, serializableError)`.
  `IoPeer` keeps no request id of its own; the acknowledgement callback
  is the correlation. With `LOG_LEVEL=trace` every emit and answer is
  logged through the `ServerLogger` adapter.
- Both `IoServer` (hub side, over the hub's multi) and `IoPeerBridge`
  (client side, over the client's local `Io`) register handlers for the
  complete interface: `init`, `close`, `isOpen`, `isReady`, `dump`,
  `dumpTable`, `contentType`, `tableExists`, `createOrExtendTable`,
  `rawTableCfgs`, `write`, `readRows`, `readRowsByHashes` and `rowCount`.
  Nothing on either side distinguishes a read from a write or from
  `close`: a peer that emits `write` writes into the other node's store,
  and a peer that emits `close` closes it. On a client the bridge sits
  over `BorrowedIo`, so `close` closes nothing there; on the hub the
  `IoServer` sits over the hub's `IoMulti`, so a client's `close` runs
  `IoMulti.close()`: the local store stays open behind `BorrowedIo`, but
  every other client's `IoPeer.close()` disconnects its socket (they
  reconnect and are added again). A `where` a peer sends is run by the
  hub on its own store as it came, so the unescaped clause of
  `IoSqliteNode` (`docs/findings/stores.md`) is reachable from the wire on
  the SQLite production nodes; `isSafeWhereValue` guards only what this
  node's own API puts into a clause. The multis themselves never emit
  anything but reads to a peer, because peers are registered
  `write: false`; the protection is by convention, not by the transport
  (slices D14 to D16). The Kubernetes `Service` maps only port 80 to
  8080, so the hub port is reachable from the pod network alone.
- The sync protocol of slice D3 uses the flat route as event name, with
  its leading slash: `/changeSets` for a reference, `/changeSets:ack`,
  `/changeSets:ack:client`, `/changeSets:gapfill:req`,
  `/changeSets:gapfill:res` and `/changeSets:bootstrap`
  (`syncEvents(route.flat)` in `@rljson/rljson`). The hub already emits
  the bootstrap to every new client; with no reference seeded yet it
  carries nothing. What the payloads look like is in
  `docs/findings/change-set-sync.md`.
- socket.io itself runs on a WebSocket only (`transports: ['websocket']`
  on both ends; long polling would have cost an HTTP handshake per
  connection and gains nothing inside a pod network), with its default
  heartbeat (`pingInterval` 25 s, `pingTimeout` 20 s) and automatic
  reconnection with a backoff of 1 s to 5 s.

Timeouts:

- `IoPeer` gives every request 30 s (`_requestTimeoutMs`), but a request
  on a socket it already knows to be closed fails at once with
  `IoPeer: socket closed (readRows)`, and `IoMulti` skips closed readables
  before asking; a read miss with the hub gone therefore threw
  `Io "io-1" is closed` after 1 ms, not after 30 s.
- A priority group waits for its slowest member: `IoMulti.readRows` asks
  every readable of a group in parallel and collects them with
  `Promise.allSettled` before it picks an answer, so on the hub one frozen
  client (`docker pause`) delays a hit served by the other client to the
  full 30 s, and since every client miss fans out through the hub, one
  slow client delays every cascading read on every node (measured by the
  reviewer of #38: a local hit 3 ms, a miss 30.0 s, the HTTP call hanging
  for the whole time since Fastify has no request timeout). The 30 s is
  hard-wired in `new IoPeer(socket)` inside `Server` and `Client` with no
  option, a dropped socket does not fail a pending acknowledgement early
  (socket.io only fails acks flagged `withError`), so slice D14 needs an
  application-level bound around `readMatching` or a wrapped socket.
- `Server.addSocket` and `Client.init` wait `peerInitTimeoutMs` (30 s) for
  the peer on the other side to answer `init` and `isReady`; measured
  0 ms in-process and about 5 ms between containers, because the socket
  is connected before either is called.
- `HubTransport.becomeClient` waits `connectTimeoutMs` (5 s) for the first
  `connect`, then reports `connectedToHub: false` with
  `cannot reach hub <address>: <reason>` and leaves the socket retrying;
  the `Client` is attached the moment the first connection succeeds. A
  hub that is only a probe listener (a node that has not become hub yet,
  or a returning node that is nobody's hub any more) fails the WebSocket
  handshake within the round trip and is retried on the socket.io
  schedule.
- A busy hub port (`NetworkManager` releases its probe listener a moment
  before it announces the role) is retried five times 200 ms apart, like
  the D1 listener did; `EADDRINUSE` after that lands in
  `transport.lastError` with the node standalone on the transport side.

Measured (Windows development machine, Docker Desktop, three containers
on one bridge network, `IoMem` on every node):

- Three containers started within 100 ms; node1 elected itself, served
  the hub port 5 ms after its role change, stepped down 5.0 s later when
  node3's announcement arrived (`hub transport stopped` 1 ms after the
  role change) and was connected to node3 as a client 17 ms after that
  (`socket to hub connected` after 12 ms, `connected to hub` with the
  `Client` initialized and the tables created after 17 ms); node2
  connected within the same 25 ms. node3 reported
  `transport: { role: "hub", connectedClients: 2 }`, both clients
  `{ role: "client", connectedToHub: true, lastError: null }`, and every
  node's `nodes` entry for node3 showed `connectedClients: 2` after the
  directory's next poll (up to 3 s later).
- `GET /api/animals/<id>?version=<hash>` on a client for a version
  written on the hub: 3.6 to 4.5 ms end to end for the first read (the
  cascade) against 2.5 to 3.1 ms for the current version served locally,
  so the hop to the hub costs about 1.5 ms; the second read of the same
  hash is local (the row was cached). A miss (`version=NoSuchHash...`)
  took 4.2 ms and answered 404; an unknown invoice id 4.5 ms and 404.
- `POST /api/invoices` on the hub, then `GET /api/invoices/<id>` on a
  client: the invoice with its item and animal, `changeSetHash: null`
  (the change set is only findable through its `items` array, which no
  `where` clause matches); the client's `GET /api/invoices` kept listing
  the six seed invoices only.
- A version written on one client, read by hash on the other client: two
  hops (client to hub, hub to the writing client's bridge), the row
  cached on the hub and on the reading client on the way.
- `docker compose stop node3` (the hub, a graceful shutdown that closes
  the socket.io server): both clients logged
  `disconnected from hub 172.21.0.2:3000: io server disconnect` within
  the same millisecond and reported `connectedToHub: false` with that
  `lastError`; local reads kept working. 3.5 s later the next probe cycle
  failed on both, the election made node1 (the earliest survivor) hub,
  node1 served the port 1 ms after its role change and node2 was
  connected to it 17 ms later; `peer left` for node3 came 8 s after that
  (the 15 s broadcast timeout). `docker compose start node3` 30 s later:
  node3 came back with its persisted id and a new `startedAt`, found
  node1 as the incumbent hub and joined as a client within a broadcast
  interval, node1 counting two clients again. The permanent split view of
  the D1 finding needs a restart faster than the broadcast timeout; a
  stop long enough for `peer-left` heals cleanly.
- In-process (`hubTransport.test.ts`, port 0): socket connect 36 ms on
  the first run of a process (the WebSocket upgrade), `Client.init()`
  0 ms, a read by hash through the multi 1 ms, thirteen tests with a hub,
  one or two clients and every transition in 1.5 s.

What the `Bs` is needed for now: nothing reads or writes a blob before
slice B12, and `Server` and `Client` both accept `undefined`. Every node
still hands a `BsMem` to the transport because `Client.init()` always
creates a `BsPeer` toward the hub and builds a `BsMulti` around it, and a
node without a local `Bs` has no writable layer: the first `setBlob` would
fail with `No writable Bs available`. With the `BsMem` in place the blob
cascade already exists (local first, the hub second), which is what D5
builds on, and C2 swaps the `BsMem` for `BsFs` without touching the
transport.

## What it means for rljson users

- Lend your store, never hand it over: `Server.tearDown()` closes the
  local `Io` it was given. Pass `ownsStores: false` to `Client` and wrap
  the `Io` for `Server` in a facade whose `close()` is a no-op, or a role
  change closes your database.
- Ask for `server.io` on every read. It is replaced on every client join
  and leave; a multi captured once serves the cascade as it was at that
  moment.
- Decide which reads may cascade. `IoMulti` cascades any `where`, and a
  whole-table read of an empty local table pulls the entire table from
  the hub and caches it. Route lists and counts to the local store and let
  only targeted reads fall through, unless pulling whole tables on first
  access is what you want.
- A cached row is not a version. The cascade writes the row it found into
  the local store, not its InsertHistory row, so anything that derives
  "current" from the history ignores it until the change set arrives. It
  is a row, though: `nextInvoiceSequence` reads every `invoices` row, so a
  node that read `invoice-2026-0007` from the hub numbers its next invoice
  `2026-0008` while a node that never read it issues its own `2026-0007`;
  the next number depends on what was read until D3 gives every node the
  same rows.
- Validate what enters a `where` clause that cascades: `IoSqliteNode`
  interpolates it into SQL (`docs/findings/stores.md`) and the hub runs
  the same clause on every store of the network.
- The transport is symmetric and unguarded: every `Io` method, `write`
  and `close` included, is a socket event on both sides. Anything that
  connects to the hub port can write into the hub's store; anything the
  hub connects to can be written into by the hub. Treat the hub port as
  trusted-network-only until an authorization layer exists; here it is
  the pod network, nothing maps it.
- Expect the socket to outlive the hub: socket.io reconnects on its own,
  and a client whose hub stopped reconnects to whatever listens on that
  port next (the probe listener of a node that is no longer hub). Tear
  the client down on every hub change rather than waiting for the socket.
- Failover is one probe cycle: a stopped hub is replaced about 3.5 s
  after its socket closed, and clients reconnect within tens of
  milliseconds, without D6 having done anything yet. What D6 has to add
  is the data side (what the new hub and the returning node know) and the
  fast-restart case of the D1 finding.
- Turn the library's `info` logging down: `Server` and `Client` log every
  refresh, socket and peer at `info` through the `ServerLogger`; forward
  those at `debug` and log the transitions yourself.

## Candidates for upstream issues

- `Server.tearDown()` closes the local `Io` it was handed, with no
  `ownsStores` option like `Client` has. Reproduction: `const io = new
IoMem(); await io.init(); const server = new Server(route, io); await
server.init(); await server.tearDown(); io.isOpen` is `false`.
- `Client.init()` starts an `IoPeerBridge` and a `BsPeerBridge` over the
  socket and `tearDown()` never stops them, so their listeners stay on a
  socket that is reused. Reproduction: `client.init()`, `client.tearDown()`,
  `socket.listeners('readRows').length` is still 1.
- `IoServer` and `IoPeerBridge` expose `close`, `write`,
  `createOrExtendTable` and `init` as socket events to any connected peer.
  Reproduction: from a client, `socket.emit('close', () => {})` closes
  the hub's multi; `socket.emit('write', { data }, cb)` writes into it.
- `IoMulti.readRows` with an empty `where` answers from the first layer
  that holds any row, so a client with an empty table pulls the hub's
  whole table into its local store on a list. Reproduction: an empty local
  `IoMem` and a peer with 1 000 rows; `readRows({ table, where: {} })`
  then `local.rowCount(table)` is 1 000.
- `@rljson/server` 0.0.64 depends on `@rljson/network` 0.0.20 while
  0.0.21 is current, and declares no dependency on `socket.io` or
  `socket.io-client` although `SocketIoBridge` imports their types.
  Reproduction: `pnpm add @rljson/server@0.0.64 @rljson/network@0.0.21`
  then `pnpm why @rljson/network` shows two versions; `tsc` on a file
  importing `SocketIoBridge` without socket.io installed reports the
  missing modules.
