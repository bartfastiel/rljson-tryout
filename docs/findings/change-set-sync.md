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
  nobody. Slice D3 therefore announced everything this process wrote on
  every channel it got and repeated it on the hub 1 s and 5 s after every
  join (the client's `Connector` exists only after its `Client.init()`
  resolved, which follows the hub's `addSocket` by one round trip; the
  library's bootstrap repeats for the same reason), at the cost of a
  lookup per repeat on every receiver; slice D4 replaced the repeats by a
  comparison of the two nodes' change set lists on every attach (below).

Pulling through the cascade:

- `IoMulti.readRows` with `where: { _hash }` answers from the local
  layer when it has the row and from the peers otherwise, and writes what
  a peer returned into every writable layer that did not answer, the
  local store (`docs/findings/hub-transport.md`). Before the write-back
  it runs `hip({ _data, _type })`, whose defaults are
  `updateExistingHashes: false, throwOnWrongHashes: true` (`applyInPlace`
  overrides the `true` of `defaultApplyConfig`): rows that carry a
  `_hash` are left as they are and validated afterwards, so a row whose
  `_hash` does not match its content fails the read itself with
  `Hash "<table hash>" is wrong. Should be "<computed>".` (the validator
  compares the outermost object first, so the message names the table's
  hash, not the row's) and never lands. `IoMem._write` and
  `IoSqliteNode.write` run `hsh` on what they are given, with
  `updateExistingHashes: true`, and fail with the other wording,
  `Hash "<given>" does not match the newly calculated one "<computed>"`,
  so a tampered row cannot be written at all. Slice D3 matched the second
  message only, which the cascade never produces; the test slice D4 added
  against the real cascade (`syncAgent.cascade.test.ts`) showed it on its
  first run, and the agent now recognises both. The agent still checks
  every pulled row with `hashMatches` (a copy re-hashed with every nested
  hash renewed, so a changed change set item changes the row's hash) and
  writes it through `writeReceivedRow`, a local `Io.write` that is a
  no-op for a row the cascade already cached; with a store that does not
  verify, the agent's check is the one that counts, and both messages are
  classified as a hash rejection so the change set fails at once instead
  of being retried.
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
- A reference only reaches the clients connected when it went out.
  Repeating what you announced (slice D3) covers the nodes that were
  listening at some point; comparing what the two ends of a connection
  hold (slice D4, below) covers the ones that were not.
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
  a row with a wrong `_hash`; the multi rejects with `Hash "..." is wrong.
Should be "..."` (slice D4 corrected the wording, see below).

## Slice D4: bootstrap and catch-up

### What we tried

- Measured what the library's own bootstrap pieces deliver to a late
  joiner with a throwaway script over `Server`, `Client` and `Connector`
  (`@rljson/server` 0.0.64, `@rljson/db` 0.0.42) on real socket.io:
  the bootstrap on `addSocket` with its repeats, `bootstrapHeartbeatMs`
  (300 ms), `seedLatestRef`, and the gap fill of `causalOrdering` for a
  client that lost its socket for two announcements and for a client that
  joined after five.
- Replaced the D3 replay (every change set this process wrote, re-sent on
  every channel and repeated by the hub 1 s and 5 s after each join) by a
  catch-up on every attach: `SyncAgent.catchUpWith` compares the change
  sets a peer holds with the local ones, both lists read from the
  respective store alone (`PetShopStore.heldChangeSets` locally,
  `heldChangeSetsOf(peerIo)` through the peer's `IoPeer`), queues what is
  missing in the peer's `changeSetsInsertHistory` order and announces what
  the peer lacks. The hub transport hands the agent the peers
  (`AttachedPeer`): on a client the hub, through `client.peerStores.io`;
  on the hub every client, through the `IoPeer` in `server.clients`.
- Added a ready handshake to the socket (`petshop:ready`), tried the
  catch-up without it first, and measured the hub reading a client's
  table right after `addSocket` resolved.
- Moved the pulls off the cascade: `pullRow` and `pullHistoryRow` read
  from the `IoPeer`s alone and the agent writes a whole change set in
  one `Io.write` (`writeReceivedRows`), after a CI run showed a client
  answering an invoice without its items in the middle of a pull.
- Tested the diff and the queueing with fakes (`syncAgent.test.ts`), the
  hash rejection against the real `IoMulti`, `IoMem` and `@rljson/hash`
  (`syncAgent.cascade.test.ts`), two real stores over linked channels
  (`petShopStore.sync.test.ts`), a hub and clients over real socket.io
  with a late client, an empty client, a client with a populated store
  and a hub that restarts (`syncAgent.transport.test.ts`), and the Gherkin
  feature `features/bootstrap.feature` in-process over both stores and,
  for the restart scenario, against the three containers.
- Ran the three containers by hand (host ports 8461 to 8463): stopped a
  client, wrote on the other two, started it again; stopped the hub for
  longer than the broadcast timeout, wrote on the two survivors, started
  it again; then started a `medium` hub alone, issued a hundred invoices
  on it and started a node with `SEED_SIZE=none` and one with `small`
  next to it while polling `/health` every 20 ms.

### What happened

What the library's bootstrap delivers (measured, one route, refs as
`r1..r3`, `s1..s5`, `t1..t4`, `u1..u2`):

- A client that joins after `r1`, `r2`, `r3` were announced hears `r3`,
  once, 284 ms after its connector started listening (the heartbeat of
  300 ms; without it the 1 s bootstrap repeat), and nothing else. The
  client that announced them hears nothing back. `server.latestRef` is
  `r3`, `server.refLog` holds all three. The heartbeat repeats the same
  payload to every client on every interval; a connector drops it as
  received. `seedLatestRef('seeded-ref')` on a fresh hub makes the first
  client hear `seeded-ref` after 1 015 ms, the first repeat, because the
  bootstrap sent on `addSocket` arrives before the client's connector
  exists. So bootstrap, heartbeat and `seedLatestRef` all carry exactly
  one reference, the latest one the hub saw, and nothing of the history.
- With `causalOrdering`: a client that lost its socket while `s3` and
  `s4` went out hears `s4` on reconnection (the bootstrap), and `s3` only
  when `s5` arrives: the gap is detected against the sender's sequence
  (`seq` 5 after 2), the client asks `afterSeq: 2` and the hub answers
  from its ref log with `s3`, `s4`, `s5`, delivering `s4` and `s5` a
  second time. A client that joined after `s1..s5` hears `s5` from the
  bootstrap and nothing more; the bootstrap payload carries the hub's own
  announce id and count, not the sender's, so it never advances a
  per-sender counter. The moment such a late joiner hears one live
  announcement (`t4` from client-a) it asks `afterSeq: 0` and receives the
  hub's whole ref log, every sender's payloads (`t1`, `t2`, `t3`, `u1`,
  `u2`, `t4`), the request's `afterSeq` filtering the other senders'
  payloads by their unrelated sequence numbers. The ref log is bounded to
  1 000 payloads, lives in the hub's memory and is empty after a hub
  restart. So the gap fill is a traffic-triggered replay of what the hub
  relayed recently, not a catch-up: nothing happens on joining, nothing
  covers a restarted hub, and the receiver gets duplicates.
- `bootstrapHeartbeatMs` therefore stays off. The `Server` runs without a
  `syncConfig` (setting one also switches the ref log on), the catch-up
  covers the latest reference with everything else, and a heartbeat
  would cost every client a lookup per interval, counted as `skipped`,
  for a reference it already holds.

Reading what a peer holds:

- A whole-table `readRows` through the peer is the wrong read: on the
  client it reaches the hub's `IoServer`, which runs it on the hub's
  `IoMulti`, and `IoMulti.readRows` answers a `where: {}` from the first
  layer that holds any row and writes the answer into the layers that did
  not (`docs/findings/hub-transport.md`). A hub with an empty
  `changeSetsInsertHistory` (nothing seeded, nothing written yet) would
  cache a client's history rows and count every change set of that client
  as held without holding a single row of them. `IoPeer.dumpTable` is
  served by `IoMulti.dumpTable`, which merges the dumpable members only,
  the node's own store, and writes nothing back; on the hub the client's
  `IoPeer` talks to the client's `IoPeerBridge` over the client's raw
  store. Both ends therefore dump `changeSetsInsertHistory` (hash and
  `timeId` per change set, 444 rows for `medium`), which on `IoMem` costs
  a refresh of the dirty table hashes before the copy
  (`docs/findings/seed-generator.md`); the local list is read with
  `readRows({ where: {} })`, which skips that refresh
  (`petShopStore.sync.test.ts`, "a cascade answers from its own store
  alone").
- The hub's request right after `Server.addSocket` resolved never came
  back: `addSocket` waits for nothing on the client side (`IoPeer.init`
  and `isReady` only look at the socket's `connected` flag), so the
  `dumpTable` was emitted before the client's `Client.init()` had
  registered its `IoPeerBridge` handlers, socket.io dropped the event on
  the client, and the hub's `IoPeer` waited its hard-wired 30 s. The same
  window exists in the other direction between the client's `init()` and
  the hub's `_refreshServers`, and for the library's own bootstrap, which
  is why it repeats. Hence the handshake: the hub emits `petshop:ready`
  with its node id after `addSocket`, the client acknowledges with its
  node id once its `Client` exists (a handler registered before the
  socket connects, the answer deferred until then), and only then do both
  sides list each other; a socket.io reconnection is a new `addSocket`
  and a new handshake. The client's node id in the acknowledgement also
  tells the hub which node a socket belongs to, which the library's
  `client_<n>_<random>` ids do not.

The catch-up itself:

- Three containers seeded `small`: every catch-up completed with nothing
  missing in 2 to 3 ms, `announced: 0` on every node, where D3 announced
  44 hashes per node and repeated them per join. Two `medium` nodes would
  exchange one 444 row dump each instead of 7 771 sends for `large`.
- A client stopped, a rename on the other client and an invoice on the
  hub while it was down, then started again (`docker compose start`, the
  same identity file, a new `startedAt`): healthy after 660 ms, connected
  to the hub 8.8 s after the start (discovery, one to two broadcast
  intervals), holding both writes 31 ms after that, `catchUp:
{ missingAtStart: 2, pulled: 2, durationMs: 11 }`, 46 change sets on
  every node. The integration feature measured 5.5 s to the connection
  and 15 ms from there to holding both.
- The hub stopped for 25 s (longer than the 15 s broadcast timeout, so
  the survivors forgot it and its new `startedAt` counts when it returns,
  `docs/findings/network-discovery.md`): the two clients elected the
  earlier survivor hub about 4 s later and kept writing (a rename on the
  new hub, an invoice on the other client, both visible on both within
  the second). The old hub came back reseeded, joined the new hub 1.25 s
  after its start and held everything 31 ms later: `missingAtStart: 4,
pulled: 4, durationMs: 16` (the two writes it had missed before it
  stopped were the two it had itself relayed while it was hub, gone with
  its memory store). All three at 48 change sets. The in-process feature
  and the transport test cover the other case, a hub that comes back on
  the same port while its clients still follow that address: the clients'
  sockets reconnect, the handshake runs again, and the hub pulls what
  each client wrote in the meantime while the clients get each other's
  writes through the hub's announcements.
- A node with an empty store (`SEED_SIZE=none`) joining a hub seeded
  `medium` plus 103 invoices issued in a burst: connected 1.9 to 3.7 s
  after the start, `catchUp: { missingAtStart: 547, pulled: 547 }` in
  466 ms with the pulls still going through the cascade and in 401 ms
  with the peer-only pulls and one write per change set, every table
  equal to the hub's afterwards (110 animals, 309 invoices, 514 items,
  547 change sets), RSS 99.5 to 99.9 MiB before and 111.2 to 111.8 MiB
  after. `/health`, polled every 20 ms from the host during the run:
  median 17 to 18 ms (the Docker Desktop port forward), p99 19 to 24 ms,
  maximum 24 ms, no call over 100 ms; `/status` answered throughout. A
  `small` node joining the same hub afterwards: 503 missing, pulled in
  434 ms, `/health` maximum 55 ms. The pulls run four at a time with one
  15 s deadline
  each, every step an awaited socket round trip, so the event loop stays
  free between them; the hub, meanwhile, announced every one of the 547
  hashes to the joiner as well (its own catch-up found the joiner lacked
  them), all of which the joiner's agent folded into the pulls already
  pending. That symmetry costs one message per missing change set and is
  what makes a restarted hub learn from its clients without a special
  case.
- The catch-up snapshot counts one catch-up at a time: peers that attach
  while one is running add their missing change sets to it, peers that
  attach after it completed start a new one, so a hub that restarts with
  two clients reports the last client's catch-up in `/status` while
  `received` counts both.

Applying a change set at once:

- The first CI run of this slice caught a race D3 had left: right after
  an invoice was issued on the hub, a client answered `GET
/api/invoices/<id>` with the invoice and `items: []`. The client's pull
  had read the invoice row and its history row through the cascade,
  which cached both locally at once, and `getInvoice` found a current
  invoice whose items were still on their way. Every pull through
  `IoMulti` lands row by row, so a reader of a store could see any
  prefix of a change set.
- The agent now pulls from the peer stores alone (`PetShopStore.pullRow`
  and `pullHistoryRow` ask the `IoPeer`s the transport registered with
  `pullThrough`, the local store first, and write nothing back), collects
  the rows of a change set, data rows before history rows, and writes
  them in one `Io.write` (`writeReceivedRows`). `IoMem` inserts the rows
  of every table of one write in a single synchronous pass and
  `IoSqliteNode` in one transaction, so a node's own store shows a change
  set either not at all or whole, and a pull that breaks off leaves
  nothing behind, not even the change set row. Measured in
  `syncAgent.transport.test.ts`: eight invoices of two items issued on
  the hub, each read on a client the moment the `POST` returned, all
  complete; the read either still went through the hub, which holds the
  invoice whole, or found the client's own copy, which is whole by then.
- What stays: the hub's `IoServer` serves a client's pull from the hub's
  own `IoMulti`, which caches what it fetched from a third node row by
  row, in the pulling client's order. Data rows before history rows means
  a version becomes current on the hub only after its rows are there,
  but a detail read on the hub that goes through its cascade while such
  a pull is being relayed (an invoice with several items, some already
  cached, the invoice itself not yet current) can still answer with the
  cached part, for the milliseconds the pull takes; the library's
  first-layer-with-rows rule answers from the partial cache without
  asking the node that holds everything. The hub's own agent completes
  the change set with one write a moment later. The Compose step reads
  the invoice again until its items are there, for the same reason.

The review items of D3:

- A pending transfer now carries the change set's `tables` and id as
  soon as its row was read; the first failure of a change set is a
  warning, later ones debug, and every retry round logs one line with the
  count, the age of the oldest, the most attempts and the last error.
- A change set naming more than `maxChangeSetItems` (10 000; the biggest
  seed change set has 9 items) or a table this store does not have is
  rejected before any item is pulled, the way a malformed row is;
  `recordReceivedChangeSet` leaves a change set the store already holds
  alone and logs it, so the "held once" invariant does not depend on the
  caller.

### What it means for rljson users

- The bootstrap tells a joining client the latest reference and nothing
  else, and the heartbeat repeats that reference. A node that joins late
  or restarts has to find out what it missed by comparing states; the
  reference stream cannot tell it.
- The gap fill (`causalOrdering`) replays the hub's recent ref log to a
  client that notices a hole in a sender's sequence, only when the next
  live reference arrives, to every client that asks with its own counter,
  with duplicates, and with nothing after a hub restart. Treat it as a
  repair of short outages under traffic, not as a join protocol.
- To learn what a peer holds, dump its table through the `IoPeer`
  (`dumpTable`); a whole-table `readRows` through a multi is answered
  from the first layer that has rows and cached in the ones that have
  none.
- Do not replicate through the cascade. `IoMulti` caches every row the
  moment it arrives, so a reader sees a change set arrive row by row;
  read the rows from the peer alone and write them in one `Io.write`,
  which both `IoMem` and `IoSqliteNode` apply atomically. Whatever the
  hub caches while relaying a pull for a client still lands row by row;
  pull data rows before history rows so that at least no version shows
  before the rows it consists of.
- Nothing in `Server.addSocket` or `Client.init` tells you that the other
  end is listening; a request that arrives before the handlers exist is
  lost and the `IoPeer` waits its full timeout. Add a handshake of your
  own before the first request in either direction.
- `hip` and `hsh` word a wrong hash differently (`is wrong. Should be`
  from the validator that `hip` runs over existing hashes, `does not
match the newly calculated one` when `hsh` recomputes them), and the
  first names the outermost object. Match both, and test the match
  against the real library rather than a fake.

### Candidates for upstream issues

- `IoPeer`'s request timeout (30 s) cannot be configured through `Server`
  or `Client`, and a request emitted before the other end registered its
  handlers is neither answered nor failed early. Reproduction: call
  `server.clients.get(id).io.dumpTable(...)` right after `addSocket`
  resolved for a client whose `Client.init()` has not run yet.
- The gap fill answers with every payload of the ref log whose `seq`
  exceeds the requested `afterSeq`, across senders, although sequences
  are per sender. Reproduction: two senders with three and two
  announcements, a late joiner hearing one live reference, `gapFillRes`
  carrying all six payloads.
- The bootstrap payload names the server's announce id as `c`, so with
  `causalOrdering` a client's per-sender counters never learn from it and
  the first live reference from any sender triggers a full ref log
  replay. Reproduction: the late joiner above asks `afterSeq: 0`.
- `@rljson/hash` reports a wrong hash with two different messages
  depending on whether existing hashes are updated
  (`_addHashesToObject`) or validated (`_validate`). Reproduction: `hip`
  and `hsh` over the same tampered row.
