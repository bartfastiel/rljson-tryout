# Change set synchronisation over the `changeSets` route

## What we tried

- `@rljson/server` 0.0.64, `@rljson/db` 0.0.42 (`Connector`), `@rljson/io`
  0.0.78 (`IoMulti`, `createSocketPair`), `@rljson/rljson` 0.0.81
  (`SyncConfig`, `ConnectorPayload`, `syncEvents`), `@rljson/hash` 0.0.19,
  socket.io 4.8.3, Node 24.18.0, while building slice D3.
- Read `Connector` (`db/dist/db.js`, `send`, `listen`, `_processIncoming`,
  the dedup sets), `Server._multicastRefs`, `addBroadcastSocket`,
  `_sendBootstrap`, `_bootstrapPayload`, `_setupAckCollection` and
  `_runHealthCheck` (`server/dist/server.js`), `Node._becomeHub` and
  `_becomeClient` (the package's own orchestrator), `IoMulti.readRows`
  and `readRowsByHashes` (the write-back), `IoMem._write` and
  `hip`/`hsh` of `@rljson/hash` (the default `throwOnWrongHashes`), the
  type files `sync/connector-payload.d.ts`, `sync/sync-config.d.ts`,
  `sync/ack-payload.d.ts`, `sync/gap-fill.d.ts`, and `Db.insert` for a
  way to pass a `timeId` in (there is none).
- Captured what a `Connector` puts on the wire with a `createSocketPair`
  and three configurations (no `SyncConfig`, `includeClientIdentity`,
  `includeClientIdentity` plus `causalOrdering`).
- Built `SyncAgent`, `ConnectorChannel` and `AnnouncementOrigins`
  (`packages/node-service/src/network/`), the loopback channel of the hub
  in `HubTransport`, the store's sync primitives (`pullRow`,
  `pullHistoryRow`, `writeReceivedRow`, `holdsChangeSet`,
  `recordReceivedChangeSet`, `onChangeSetWritten`) and the deterministic
  seed (`seedTimeId`, `createSeedClock` in the domain package).
- Tested the agent with a fake store and a fake channel
  (`syncAgent.test.ts`: ordering, duplicates, hash mismatch, timeout and
  retry, dependency walk), over real socket.io with a hub and two or three
  clients in one process (`syncAgent.transport.test.ts`), the store
  primitives and a two-store sync of `small` against `medium` through
  in-process `IoMulti` cascades (`petShopStore.sync.test.ts`), and the
  Gherkin feature `features/change-set-sync.feature` both in-process over
  both stores and against the three containers of
  `deploy/compose/three-nodes.yml` (`features/integration/`).
- Started the three containers by hand (host ports 8431 to 8433, image
  built from the working tree), renamed an animal on a client, issued an
  invoice on the hub and on a client, renamed again on the other client,
  timed every arrival with a polling script, then started the trio again
  with node3 seeded `medium` and node1 and node2 `small`.

## What happened

What `send` and `listen` carry (captured, not read off the types):

- The event names come from `syncEvents(route.flat)` and carry the
  leading slash of the flat route:
  `{"ref":"/changeSets","ack":"/changeSets:ack","ackClient":"/changeSets:ack:client","gapFillReq":"/changeSets:gapfill:req","gapFillRes":"/changeSets:gapfill:res","bootstrap":"/changeSets:bootstrap"}`
  (`docs/findings/hub-transport.md` listed them without the slash).
- `connector.send(ref)` emits one socket.io event `/changeSets` with the
  payload
  `{"o":"1789673221386:ACdm","r":"SNrqQdgrwo4dB-Ji-O8uR8"}`
  without a `SyncConfig`: `o` is the connector's ephemeral origin (a
  `timeId` drawn in its constructor, used by every receiver to drop its
  own echo), `r` the reference, here the change set hash. With
  `includeClientIdentity` the payload is
  `{"o":"1789673221386:xTFL","r":"SNrqQdgrwo4dB-Ji-O8uR8","c":"1ef1bb6c-a75e-48f8-ba2e-038a6d7d859d","t":1789673221386}`,
  `c` the stable client identity (`ClientId` is any string; a
  `Client` takes it as `clientIdentity` and this project passes the node
  id) and `t` the sender's wall clock. With `causalOrdering` as well:
  `{"o":"1789673221386:taRF","r":"SNrqQdgrwo4dB-Ji-O8uR8","c":"1ef1bb6c-…","t":1789673221386,"seq":1,"p":["1789672705159:HpOt"]}`,
  `seq` a per-connector counter and `p` the predecessors the connector
  read off the InsertHistory row (or `setPredecessors`). The type
  `ConnectorPayload` also declares `cksum` ("content checksum for ACK
  verification"); nothing in `db` 0.0.42 or `server` 0.0.64 sets or reads
  it. There is no `seq` and no `c` in the default configuration, so the
  wire carries nothing but the origin and the hash.
- Acknowledgements (`requireAck`, off here): a receiving connector emits
  `/changeSets:ack:client` `{ r }` right after it queued the reference
  for its callbacks, before anything was pulled; the hub collects those
  from every other client for `ackTimeoutMs` (10 s) and answers the
  sender on `/changeSets:ack` with `{ r, ok, receivedBy, totalClients }`.
  An acknowledgement therefore says "heard", never "held" (slice D10).
- `connector.listen(callback)` calls `callback(ref, predecessorRefs, info)`
  with `info: { predecessorRefs, isNewestFromSender }`; the payload's
  `c`, `t` and `o` are not passed on. Whoever wants to know which node
  announced a reference has to read the raw event first:
  `AnnouncementOrigins` registers on the same socket before the
  `Connector` exists (before `Client.init()` on a client, before
  `new Connector` on the hub) and, since socket.io and the
  `DirectionalSocketMock` call listeners in registration order, has
  recorded `r → c` by the time the connector's callback runs.
- The hub forwards a payload as it came plus `__origin: <internal client
id>`, so `c` survives the relay and a client learns which node wrote what
  it pulls. The hub's own bootstrap (`/changeSets:bootstrap`, sent on
  every `addSocket` and repeated after 1, 3 and 6 s) carries
  `{ o: <origin of whoever produced the latest ref>, r, c: <the hub's
announce id>, seq: <count of distinct refs> }`: its `c` is not a node id,
  so a reference that arrives that way reads as coming "from the hub".
- Dedup in three places. `Connector.send` drops a reference it has sent
  or received before; `_processIncoming` drops a reference it has
  received before (10 000 per generation, two generations);
  `Server._multicastRefs` drops a reference only when it equals the
  previous latest one. Consequences measured with three nodes seeding
  the same 44 change sets: the hub's connector heard every hash once
  (`skipped: 44`), although two clients announced it, while each client
  heard the hub's repeats and the other client's announcements. The
  `ConnectorChannel` calls `invalidateSent` before every `send`, because
  the agent repeats announcements on purpose and decides about
  duplicates itself.

The hub has no connector:

- `Server` relays references between its clients and keeps the latest
  one for the bootstrap; it never announces or hears on its own behalf.
  `addBroadcastSocket` exists for exactly this ("hub creates a loopback
  socket pair so its own Connector can send/receive refs"): one end of a
  `createSocketPair()` is added as a broadcast-only client (`io: null`,
  no `IoPeer`, skipped by the health check), the other carries a
  `Connector` over a `Db` on the local store. A `send` on it reaches every
  socket client; every client's announcement is forwarded to it. The
  `Server` counts that loopback among `clients.size`, so
  `transport.connectedClients` now counts the entries with an `IoPeer`.
- The `Node` class of the package does the same for its agent; its
  `seedLatestRef` and the `_lastKnownRef` it carries across roles are
  the pieces slice D4 wants.

What a client only hears while it is connected:

- `_multicastRefs` forwards to the clients connected at that moment. A
  hub that announced its seed before any client connected, or a client
  that announced as a short-lived hub at a cold start (node2 elected
  itself for one broadcast interval and announced its 44 change sets to
  nobody, then became node3's client with an empty queue) had told
  nobody. The agent therefore announces everything this process wrote on
  every channel it gets and repeats it on the hub 1 s and 5 s after every
  join (the client's `Connector` exists only after its `Client.init()`
  resolved, which follows the hub's `addSocket` by one round trip; the
  library's bootstrap repeats for the same reason). The repeats cost the
  receivers a lookup each.

Pulling through the cascade:

- `IoMulti.readRows` with `where: { _hash }` answers from the local
  layer when it has the row and from the peers otherwise, and writes what
  a peer returned into every writable layer that did not answer, the
  local store (`docs/findings/hub-transport.md`). Before the write-back
  it runs `hip({ _data, _type })` with the defaults of `@rljson/hash`
  (`updateExistingHashes: true, throwOnWrongHashes: true`), so a row
  whose `_hash` does not match its content fails the read itself with
  `Hash "<given>" does not match the newly calculated one "<computed>"`
  and never lands. `IoMem._write` and `IoSqliteNode.write` run `hsh` on
  what they are given too, so a tampered row cannot be written at all.
  The agent still checks every pulled row with `hashMatches` (a copy
  re-hashed with every nested hash renewed, so a changed change set item
  changes the row's hash) and writes it through `writeReceivedRow`, a
  local `Io.write` that is a no-op for a row the cascade already cached;
  with a store that does not verify, the agent's check is the one that
  counts, and the message above is classified as a hash rejection so the
  change set fails at once instead of being retried.
- A change set names its InsertHistory rows (`docs/findings/change-sets.md`),
  so pulling the items is enough for the version rule: the received
  history row carries the writer's `timeId` and `previous`, and the
  receiver writes it as it came (no `Db.insert`, which would issue a new
  `timeId` and a second tip). The change set's own history row is the
  receiver's (`origin: sync`, stamped now) and is what `holdsChangeSet`
  looks at, because the change set row alone is left behind by a pull
  that broke off after the first read.
- A read by hash where some peer could not answer throws; a read by any
  other column (`timeId` for a `previous` version) answers with what the
  reachable layers had. The agent treats the first as "pending, retry"
  and the second as "not held by any node", also pending, up to
  `maxAttempts` (20) with `retryIntervalMs` (30 s), then failed. A pull
  has one deadline for the whole change set (`pullTimeoutMs`, 15 s); a
  read that outlives it is abandoned (the `IoPeer` request keeps its own
  30 s and settles later, ignored).
- Dependencies: after the items are written the agent walks the
  reference columns of the received rows (`ref: { tableKey }` in the
  `TableCfg`, one hash in a `string` column, many in a `jsonArray`) and
  the `<table>Ref` and `previous` of the received history rows, pulls
  what the local store lacks, and stops after `dependencyBound` (200)
  rows. Measured in the unit tests only; on Compose every dependency was
  already there, because every node holds the same seed and the edits
  chain to it.

The seed had to become deterministic:

- `Db.insert` issues the `timeId` of the history row inside the
  controller (`timeId: timeId()` in `ComponentController.insert`) and
  offers no option to pass one; `Route.fromFlat` only carries the
  reference. Two nodes seeding the same rows therefore held the same
  entity rows under different history rows, which after one sync are two
  tips per entity. The seed now writes rows and history rows through
  `Core.import` with `validate: false`, the history rows stamped by
  `seedTimeId(n)` = `1767225600000 + n` milliseconds (2026-01-01, before
  any runtime edit) plus the constant unique part `seed` (four characters,
  `isTimeId` accepts it, `Route.fromFlat('animals@1767225600000:seed')`
  classifies it as a history reference). Every hand-written entity got a
  change set too (44 for `small`: 3 species, 8 traits, 8 persons, 4
  breeders, 5 customers, 10 animals with their junction rows, 6 invoices
  with their items). Two `small` stores are identical table by table,
  history rows and change sets included, over `IoMem` and over SQLite
  (`petShopStore.sync.test.ts`); `small` is a prefix of `medium`
  (`medium` has 444 change sets).
- Bypassing `Db.insert` for the seed means `Db._dagTips` is not kept
  incrementally and no `Db` observer fires for seeded rows; nothing in
  this project reads either yet (slice D11 will subscribe to
  `registerConflictObserver`, which scans on first use).
- Syncing a `small` store with a `medium` one both ways (every change set
  announced in both directions): the `medium` side skipped all 44, the
  `small` side skipped 44 and received 400, both ended with 110 animals,
  206 invoices, 444 change sets, identical rows and history rows, no
  entity with two tips, and the rljson validator over the small store's
  dump was already covered by the integrity test of the seed.
- The other side of the coin: the production nodes node1 and node2 hold
  a pre-D3 seed whose history rows carry random `timeId`s. Once node3
  reseeds deterministically after this slice deploys, its 44 `small`
  change sets are new to node1 and node2 by hash, and each seed entity
  there gets a second history row with `previous: []`: two tips per seed
  entity, the same content under both, `conflictingIds` listing every
  seed animal, the history view showing the seed version twice. Lists
  and details keep working (the tip with the newest `timeId` wins, and
  it is the same row), and an edit chains from whichever tip the editing
  node holds. rljson has no delete, so nothing in the store can undo a
  history row; the clean fix is an empty volume (`Down` and `Up`, or
  replacing the two claims through Terraform) so that node1 and node2
  seed deterministically too.

Timings (Windows development machine, Docker Desktop, three containers,
`IoMem`, host ports 8431 to 8433):

- Announce to visible, polled every 20 ms: a rename on a client listed on
  the hub after 28 ms and on the other client after 35 ms; an invoice
  issued on the hub listed on the clients after 6 and 30 ms; a rename on
  the other client 6 and 29 ms; an invoice on a client 4 and 6 ms. The
  integration feature measured 10 and 14 ms for an invoice from node3
  and 16 and 17 ms for a rename from node2 with a 100 ms poll. The pull
  itself (`durationMs` in `/status.sync.transfers`) took 4 to 15 ms for
  an invoice (four rows) or a rename (six rows: the animal, two junction
  rows, three history rows), 1 to 23 ms across the 400 generated change
  sets, median 3 ms.
- node3 seeded `medium` as the hub, node1 and node2 `small`: both clients
  pulled 400 change sets in 1.33 s (first to last `change set received`),
  concurrency 4, and reported 110 animals, 206 invoices, 444 change sets
  like node3; the generated animals show one seed version each on node1.
- A client container restarted (`docker compose restart`, then the health
  check and the reconnection, 5.7 s) held the hub's invoice again 6 ms
  after it rejoined, through the hub's repeat; the other client's tables
  did not change.
- Invoice numbers now continue across nodes: an invoice issued on the hub
  got `2026-0007`, the next one on a client `2026-0008`, because every
  node holds every invoice; two nodes issuing within the same round trip
  would still collide (slice D9).

## What it means for rljson users

- A hub does not take part in the sync unless you give it a connector:
  add one end of `createSocketPair()` with `addBroadcastSocket` and build
  a `Connector` on the other. Count your clients yourself; the loopback
  is in `clients`.
- `listen` gives you the reference, not the payload. If you need to know
  who announced it, read the socket event before the connector does,
  and set `clientIdentity` to something meaningful (the node id here);
  the default `includeClientIdentity` generates `client_<nanoid>`.
- A reference only reaches the clients connected when it went out. Keep
  what you announced and repeat it: for every new channel a node gets
  and, on the hub, for every client that joins, a moment after the join.
  Repeats are cheap because every connector drops what it has received.
- `send` drops a reference you sent or received before; call
  `invalidateSent` when a repeat is intended.
- The cascade's write-back verifies hashes before it caches and refuses
  tampered rows, but tell a hash rejection from a peer failure by the
  message, or you will retry a row nobody can ever serve.
- Pull the InsertHistory rows with the data rows and write them as they
  came. Re-inserting a received row through `Db.insert` gives it a new
  `timeId` and turns one version into two tips.
- Seed data needs deterministic history rows on every node that seeds
  it, which `Db.insert` cannot give you; write them through `Core.import`
  with your own `timeId`s. Do it before the first sync: history rows
  cannot be taken back, so a store seeded the old way keeps its extra tip
  until it is emptied.

## Candidates for upstream issues

- `Connector.listen` hands its callbacks the reference and the causal
  predecessors but not the payload's client identity, timestamp or
  origin, so a receiver cannot say who announced a reference without a
  second listener on the socket. Reproduction:
  `connector.listen((ref, predecessors, info) => ...)` after a payload
  `{ o, r, c, t }`; `info` has `isNewestFromSender` only.
- `Server` has no connector of its own and no documented way to announce
  from the hub other than the loopback pair `addBroadcastSocket` hints at
  in its comment; a `server.connector` over an internal pair would remove
  the boilerplate. Reproduction: `new Server(route, io).init()` exposes
  `io`, `bs`, `clients`, `latestRef`, no `send`.
- `Server.clients` counts broadcast-only sockets, so `clients.size` is not
  the number of connected peers once a loopback is added. Reproduction:
  `addBroadcastSocket(createSocketPair()[1])`, then `clients.size` is 1
  with no socket client.
- `Db.insert` issues the InsertHistory `timeId` itself, with no option to
  pass one, so seeds cannot be written deterministically through it.
  Reproduction: insert the same row into two `Db` instances and compare
  the `timeId` of the returned history rows.
- `ConnectorPayload.cksum` is declared ("content checksum for ACK
  verification") and neither set by `Connector.send` nor read by
  `Server`. Reproduction: grep `cksum` in `db/dist/db.js` and
  `server/dist/server.js`.
- A `Connector` has no "listening" signal for the hub: a reference
  forwarded between `Server.addSocket` resolving and the client's
  `Client.init()` creating its connector is lost, which is why both the
  library's bootstrap and this project's repeats run on a schedule
  rather than once. Reproduction: forward a reference to a socket right
  after `addSocket` resolves and check the client's listener.
- `IoMulti.readRows` fails a read by hash with the `@rljson/hash`
  message when a peer serves a tampered row, indistinguishable by type
  from a transport failure. Reproduction: a peer whose `readRows` returns
  a row with a wrong `_hash`; the multi rejects with `Hash "..." does not
match the newly calculated one "..."`.
