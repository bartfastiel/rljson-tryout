# Lessons learned with rljson, for its authors

This is what a hobby project learned from building a small multi-node
application on the rljson packages between 2026-09-17 and 2026-09-18. It is
written for someone who knows rljson but not the project; the project's own
notes live in [`../findings/`](../findings/) and every claim below links to
the note or the issue it comes from. The bug reports are in
[`issues/`](issues/), one file each, numbered by severity, every one with a
reproduction that was run against the pinned versions and its real output.

## What we built and on what

A pet shop: species, traits, animals with an n-to-m relation to traits,
persons, breeders, customers, invoices with items, every table an rljson
`components` table with an InsertHistory companion, plus a `changeSets`
table of type `buffets` that names every row a business operation wrote.
Three nodes run the same service (Fastify, a small web app), each over its
own store (`IoMem` or `IoSqliteNode` on a persistent volume), discover each
other with `@rljson/network` on a k3s pod network and on Docker Compose,
elect a hub, connect `Server` and `Client` of `@rljson/server` over
socket.io, and synchronise change sets over one route: a node announces
the hash of a change set, every other node pulls the change set and its
rows through the read cascade and writes them as they came. Edits chain
versions through `Db.insert` with `<table>@<timeId>` routes, and lists show
the current version per entity. Seeds of 220, 1 119 and 24 759 domain rows
(plus history rows and change sets) are generated deterministically so that
every node computes the same hashes.

Packages, pinned exactly ([`../findings/versions.md`](../findings/versions.md)):
`@rljson/rljson` 0.0.81, `@rljson/hash` 0.0.19, `@rljson/json` 0.0.23,
`@rljson/io` 0.0.78, `@rljson/db` 0.0.42, `@rljson/bs` 0.0.26,
`@rljson/server` 0.0.64, `@rljson/network` 0.0.21, `@rljson/io-sqlite-node`
1.0.7; `@rljson/validate` 0.0.11 and `@rljson/is-ready` 0.0.17 come in
transitively. Node 24.18.0, pnpm 12.4.2, TypeScript 6.0.3, socket.io 4.8.3.
Measurements were taken on a Windows 11 workstation (NVMe) and, where it
says so, in `node:24-alpine` containers on Docker Desktop and on a Hetzner
`cpx32` running k3s.

### Running the reproductions

Every issue's script runs with plain `node` from a directory holding this
`package.json` after `npm install` (the overrides keep one copy of each
package, see [issue 30](issues/30-dependency-ranges-install-several-copies-of-rljson-hash-and-io.md)):

```json
{
  "type": "module",
  "dependencies": {
    "@rljson/bs": "0.0.26",
    "@rljson/db": "0.0.42",
    "@rljson/hash": "0.0.19",
    "@rljson/io": "0.0.78",
    "@rljson/io-sqlite-node": "1.0.7",
    "@rljson/json": "0.0.23",
    "@rljson/network": "0.0.21",
    "@rljson/rljson": "0.0.81",
    "@rljson/server": "0.0.64"
  },
  "overrides": {
    "@rljson/hash": "0.0.19",
    "@rljson/io": "0.0.78",
    "@rljson/json": "0.0.23",
    "@rljson/network": "0.0.21",
    "@rljson/rljson": "0.0.81"
  }
}
```

## What worked well

- **Content addressing across nodes and stores.** A row hashed in the
  domain package before insert is served with the same `_hash` by `IoMem`
  and by `IoSqliteNode`, and the hash recomputed from what SQLite returns
  equals the stored one, strings with quotes, newlines, CJK, emoji and
  4 000+ characters included ([`stores.md`](../findings/stores.md)). Three
  nodes that seed the same data independently agree by hash: each reported
  `announced: 44, skipped: 44, received: 0` for the 44 seed change sets, no
  row travelled ([`change-set-sync.md`](../findings/change-set-sync.md),
  pull request #39 review). A node seeded `medium` filled two `small` nodes
  with its 400 extra change sets in 1.33 s; 80 invoices posted in parallel
  on one node (320 rows) were held by the two others within 232 ms.
- **Hashing is cheap.** 0.0055 ms for a 704-character row, 0.03 ms for a
  7 141-character one; a 4 MB string in one column inserts in 63 ms and
  reads by hash in under a millisecond; `Db.insert` costs about 0.03 to
  0.05 ms per row on `IoMem` ([`db-basics.md`](../findings/db-basics.md),
  [`entity-versions.md`](../findings/entity-versions.md),
  [`seed-generator.md`](../findings/seed-generator.md)).
- **The validator finds what matters.** A tampered `_hash`
  (`hashesNotValid`), a dangling single reference and each dangling element
  of a `jsonArray` multi-reference (`refsNotFound`, one entry per element),
  a buffet item that points at a missing row
  (`buffetReferencedItemsNotFound`), a wrong column type
  (`dataDoesNotMatchColumnConfig`); the whole `large` store, 24 759 domain
  rows with history and 7 771 change sets, validates as one document in
  about a second ([`db-basics.md`](../findings/db-basics.md),
  [`change-sets.md`](../findings/change-sets.md),
  [`seed-generator.md`](../findings/seed-generator.md)).
- **The sync primitives are sound.** `IoMulti` re-hashes what a peer
  returned before it caches it (`hip` with `throwOnWrongHashes`), so a
  tampered row fails the read and never lands; `IoMem._write` and
  `IoSqliteNode.write` hash again on write. `Connector` deduplicates sent
  and received references, carries a stable client identity when asked,
  and the hub's bootstrap repeats itself for late listeners
  ([`change-set-sync.md`](../findings/change-set-sync.md)).
- **The read cascade is fast and self-healing.** A read by hash that misses
  locally and is served by the hub costs 3.6 to 4.5 ms end to end against
  2.5 to 3.1 ms for a local read, about 1.5 ms per hop, and the second read
  is local because the row was cached; a two-hop read (client, hub, other
  client) 4.7 ms. When the hub container was stopped, the election replaced
  it 3.5 to 3.8 s after its socket closed and the clients were connected to
  the new hub 17 ms later, with nothing written for that case yet
  ([`hub-transport.md`](../findings/hub-transport.md), pull request #38
  review).
- **Discovery needs no configuration.** UDP broadcast reached every
  container on a Docker bridge and every pod on the flannel bridge of one
  k3s node; three nodes agreed on one hub 5.0 s after start in both
  environments (bounded by the 5 s announcement interval), probe round
  trips were 0.4 to 1.3 ms, and the `domain` field alone kept a preview
  environment apart from production on the same bridge
  ([`network-discovery.md`](../findings/network-discovery.md)).
- **SQLite on `node:sqlite`.** No native module, no flag on Node 24, works
  on `node:24-alpine`; table creation is idempotent across restarts; an
  invoice written right before `docker kill -s KILL` is there after the
  restart ([`stores.md`](../findings/stores.md)).
- **Testability.** `createSocketPair()` and `DirectionalSocketMock` made it
  possible to run hub, clients, connectors and the whole sync in one
  process: thirteen transport tests with every role transition in 1.5 s
  ([`hub-transport.md`](../findings/hub-transport.md)).
- **The comments in the code.** `ClientOptions.ownsStores`,
  `Server.addBroadcastSocket`, `healthCheckMaxStrikes` and the
  `README.architecture.md` files explained more than the public
  documentation; several workarounds below were taken from them.

## What we had to build ourselves and why

| Built                                                                                                                                                                                                      | Because                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A "current version per entity" rule (`packages/domain/src/entityVersions.ts`): group InsertHistory rows by the `id` of the row they reference, tips per group, order by DAG depth before `timeId`          | `detectDagBranch` counts tips per table, so two independent entities are a branch ([23](issues/23-detectdagbranch-is-per-table-not-per-entity.md)); `timeId` order is random within a millisecond ([31](issues/31-timeid-has-no-order-within-a-millisecond.md))                                                  |
| Change sets as a `buffets` table written through `Core.import` with `validate: false` and read through `Io.readRows`                                                                                       | `Db` has no controller for `buffets` ([08](issues/08-no-controller-for-buffets-in-db.md)); `Core.import` with validation rejects a buffet whose targets are already in the store ([16](issues/16-core-import-validation-accepts-dangling-references.md))                                                         |
| A `SyncAgent` that announces everything the process wrote on every new channel, repeats on the hub 1 s and 5 s after every join, retries pending change sets every 30 s up to 20 times, walks dependencies | The hub forwards a reference only to the clients connected at that moment, the bootstrap carries one reference, and a reference forwarded before the client's `Connector` exists is lost ([18](issues/18-connector-listen-drops-the-client-identity.md), [`change-set-sync.md`](../findings/change-set-sync.md)) |
| A loopback socket pair with a `Connector` for the hub                                                                                                                                                      | `Server` relays but cannot announce or hear ([19](issues/19-server-has-no-connector-of-its-own.md))                                                                                                                                                                                                              |
| A raw socket listener (`AnnouncementOrigins`) registered before the `Connector`                                                                                                                            | `Connector.listen` drops the sender identity that is on the wire ([18](issues/18-connector-listen-drops-the-client-identity.md))                                                                                                                                                                                 |
| A `NodeDirectory` that polls every node's `/status` to map node ids to names and URLs                                                                                                                      | `NodeInfo` carries no name or metadata ([22](issues/22-nodeinfo-carries-no-name-or-metadata.md))                                                                                                                                                                                                                 |
| A `RoleOrchestrator` and `HubTransport` after the model of `Node`                                                                                                                                          | `Node` creates `IoMem` and `BsMem` internally ([21](issues/21-node-is-hard-wired-to-iomem-and-bsmem.md))                                                                                                                                                                                                         |
| `IoSwitch`: only targeted reads (`where` non-empty) go through the multi, everything else stays local                                                                                                      | A whole-table read of an empty local table copies the hub's table ([11](issues/11-iomulti-whole-table-read-copies-a-peers-table.md)); `server.io` is a new object after every join and leave                                                                                                                     |
| `BorrowedIo`: the local store lent to `Server` and `Client` with a no-op `close()`                                                                                                                         | `Server.tearDown()` closes the store it was handed ([03](issues/03-server-teardown-closes-the-callers-io.md)); a peer can send `close` over the wire ([01](issues/01-wire-accepts-write-and-close-from-any-peer.md))                                                                                             |
| A deterministic seed clock (`seedTimeId`) and seed writes through `Core.import`                                                                                                                            | `Db.insert` issues the `timeId` itself ([15](issues/15-db-insert-issues-the-timeid-itself.md)), so two nodes seeding the same rows end with two tips per entity                                                                                                                                                  |
| `WriteAheadLogSqliteIo`, a subclass that sets WAL and `synchronous = NORMAL` after `init()`                                                                                                                | The defaults cost two `fsync`s per row ([13](issues/13-sqlite-defaults-cost-two-fsyncs-per-row.md))                                                                                                                                                                                                              |
| Whole-table reads plus JavaScript joins and filters for every query                                                                                                                                        | `where` keys that collide with a referenced table's columns are resolved through the reference ([05](issues/05-db-get-where-resolves-through-the-referenced-table.md)); the route join drops rows ([06](issues/06-route-join-drops-rows-with-unresolvable-references.md))                                        |
| `isSafeWhereValue`, a whitelist for anything that enters a `where`                                                                                                                                         | `IoSqliteNode` interpolates values into SQL ([02](issues/02-sqlite-where-values-interpolated-into-sql.md)) and the hub runs a peer's clause as it came                                                                                                                                                           |
| A `hashed<T>(): Hashed<T>` helper                                                                                                                                                                          | `hsh` is typed to return `T` ([32](issues/32-hsh-and-hip-are-typed-to-return-t-instead-of-hashed-t.md))                                                                                                                                                                                                          |

## Friction and API ergonomics

Things that cost time, roughly in the order they were met:

- `_type` is mandatory in every insert payload and its absence surfaces as
  `Cannot read properties of undefined (reading '_hash')`
  ([25](issues/25-db-insert-without-type-fails-with-an-unrelated-typeerror.md)).
- `Db.insert` with several rows returns one history row per row and
  persists one ([04](issues/04-db-insert-persists-only-the-first-history-row.md)).
- `db.get(route, { id })` returns nothing on any table that has a `ref`
  column, because `id` is also a column of the referenced table
  ([05](issues/05-db-get-where-resolves-through-the-referenced-table.md)).
  Neither the reference filter nor its precedence is documented.
- The route join `animals/species` is an inner join that reports nothing
  about what it dropped ([06](issues/06-route-join-drops-rows-with-unresolvable-references.md)).
- `buffets` is in the format and the validator but not in `Db`
  ([08](issues/08-no-controller-for-buffets-in-db.md)); there is no
  `createBuffetTableCfg`.
- `createInsertHistoryTableCfg` yields a configuration the validator
  rejects and a `<table>MultiEdits` reference
  ([09](issues/09-insert-history-table-cfg-fails-the-validator.md)), so a
  store's own dump never validates as is.
- `Db.getInsertHistory` returns `{ [table]: { _data, _type } }` rather than
  the rows, unlike the sibling `getInsertHistoryRowsByRef`, and reads
  through `dumpTable` with its re-hash cost
  ([12](issues/12-iomem-rehashes-the-whole-store-on-dumptable-after-a-write.md)).
- `Route.fromFlat('table@x')` decides between a history `timeId` and a row
  hash by counting `:`; neither the rule nor what a hash reference means
  after a restored version is documented
  ([14](issues/14-db-insert-does-not-check-the-route-reference.md)).
- No way to pass a `timeId` or `previous` to `Db.insert`, although
  `insertTrees` accepts `previous` ([15](issues/15-db-insert-issues-the-timeid-itself.md)).
- The 30 s `IoPeer` timeout is a constructor argument that `Server` and
  `Client` never pass ([10](issues/10-iomulti-waits-for-the-slowest-member-and-iopeer-timeout-is-fixed.md)).
- `Node` is unusable with a persistent store
  ([21](issues/21-node-is-hard-wired-to-iomem-and-bsmem.md)), which also
  leaves `seedLatestRef`, the hub self check and the last-known-ref
  handover out of reach.
- `NodeInfo` has no place for a name or URL, and the topology has no "last
  heard from" ([22](issues/22-nodeinfo-carries-no-name-or-metadata.md)).
- `@rljson/server` compiles only with `socket.io` and `socket.io-client`
  installed by the consumer, and a plain install produces three copies of
  `rljson` and `hash` ([30](issues/30-dependency-ranges-install-several-copies-of-rljson-hash-and-io.md)).
- Documentation gaps met along the way: column types are only validated
  when the document carries `tableCfgs` and the table points at its
  configuration with `_tableCfg` ([`db-basics.md`](../findings/db-basics.md));
  `Core.import`'s `validate` skips `refsNotFound` ([16](issues/16-core-import-validation-accepts-dangling-references.md));
  a repeated plain insert is a new root version ([24](issues/24-duplicate-insert-appends-a-history-row-and-a-new-tip.md));
  row key order differs between `IoMem` and `IoSqliteNode`, so rows must
  be compared structurally ([`stores.md`](../findings/stores.md)); the
  `Rljson` type's index signature rejects a document hashed as a whole
  ([`db-basics.md`](../findings/db-basics.md)); `Server` and `Client` log
  every refresh at `info` ([`hub-transport.md`](../findings/hub-transport.md)).

## Security observations

- Every `Io` and `Bs` method is a socket event on both ends of a
  connection: a client can `write` into the hub's store, `close` the hub's
  multi (which disconnects every other client), `createOrExtendTable` and
  `dump`; the hub can do the same to every client. Nothing distinguishes a
  read from a write on the wire, and there is no authentication or
  authorization hook on `Server.addSocket`
  ([01](issues/01-wire-accepts-write-and-close-from-any-peer.md)).
- A `where` clause a peer sends is run on the receiving store as it came,
  and `IoSqliteNode` builds its SQL by string concatenation: `x' OR '1'='1`
  returns every row, a value with an apostrophe throws
  ([02](issues/02-sqlite-where-values-interpolated-into-sql.md)).
- A history row with a `previous` that names a nonexistent `timeId` is
  accepted ([14](issues/14-db-insert-does-not-check-the-route-reference.md)),
  and a dangling reference passes `Core.import` with validation on
  ([16](issues/16-core-import-validation-accepts-dangling-references.md)),
  so a receiving node must validate what a peer serves itself. The hash
  check of the cascade is the one guard that holds without help.
- What the project does today: the hub port is not mapped outside the pod
  network, the store is lent through a facade that ignores `close`, only
  hashes, `timeId`s and slugs enter a `where`, every pulled row is
  re-hashed and its shape checked before it is written, and a bound on
  change set size and per-peer failure counters are planned.

## Performance observations

- `IoMem` re-hashes the whole store on the next `dumpTable` after any
  write, because `_updateGlobalHash` runs `hip` with the default
  `throwOnWrongHashes`: about 100 ms for a 5-row table in a store of
  40 000 rows, 230 ms per call on the `large` seed, 86 percent of an edit's
  453 ms; `Db.getInsertHistory` reads that way. Reading history through
  `Io.readRows` brought the edit to 16 ms and the invoice list from 497 ms
  to 22 ms ([12](issues/12-iomem-rehashes-the-whole-store-on-dumptable-after-a-write.md),
  [`seed-generator.md`](../findings/seed-generator.md)).
- `IoMulti.readRows` waits for the slowest member of a priority group: one
  paused client made every cascading read on every node take 30.0 s, the
  HTTP requests hanging with it ([10](issues/10-iomulti-waits-for-the-slowest-member-and-iopeer-timeout-is-fixed.md)).
- Seeding into `IoMem` through the store's own write path: `small` (76
  domain rows) 15 ms, `medium` (1 119) 78 ms, `large` (24 759, 7 771 change
  sets) 1.3 to 1.4 s, RSS peak 250 to 270 MB with 43 MB of live heap after
  garbage collection. Bulk `Core.import` is about six times faster than
  per-row `Db.insert` (2 000 animals: 22 ms against 96 ms; 12 000 items:
  102 ms against 636 ms) but skips the incremental DAG tips (a rescan of
  12 000 history rows took 147 ms) and the observers
  ([`seed-generator.md`](../findings/seed-generator.md)).
- SQLite: the seed of 220 rows took 698 ms with the library's defaults and
  49 ms with WAL and `synchronous = NORMAL`; 200 single-row writes 643 ms
  against 18 ms ([13](issues/13-sqlite-defaults-cost-two-fsyncs-per-row.md)).
  `medium` seeds in 0.7 s and `large` in 16 s in WAL mode, about 0.5 ms per
  row. Reads stay about ten times slower than `IoMem` because every
  `readRows` and `write` reads and parses every table configuration twice
  ([29](issues/29-tablecfgs-are-re-read-on-every-readrows-and-write.md),
  [`stores.md`](../findings/stores.md)).
- What is fast: `detectDagBranch` keeps its tip set incrementally (0.0 ms
  at 10 000 history rows once warm), `db.get` of 10 000 rows 4.2 ms, the
  application's per-entity version rule about 1.4 ms for 10 000 history
  rows, a change set pull 4 to 15 ms, median 3 ms across 400
  ([`entity-versions.md`](../findings/entity-versions.md),
  [`change-set-sync.md`](../findings/change-set-sync.md)).

## Suggestions

In the order we would fix them:

1. Restrict the socket protocol to what a peer needs and add an
   authorization hook; bind parameters in `IoSqliteNode`
   ([01](issues/01-wire-accepts-write-and-close-from-any-peer.md),
   [02](issues/02-sqlite-where-values-interpolated-into-sql.md)).
2. `ownsStores` on `Server`; stop the peer bridges in `Client.tearDown()`
   ([03](issues/03-server-teardown-closes-the-callers-io.md),
   [20](issues/20-client-teardown-leaves-the-peer-bridges-on-the-socket.md)).
3. `Db.insert`: persist every history row, accept `timeId` and `previous`,
   reject a route reference that resolves to nothing, name the missing
   `_type` ([04](issues/04-db-insert-persists-only-the-first-history-row.md),
   [15](issues/15-db-insert-issues-the-timeid-itself.md),
   [14](issues/14-db-insert-does-not-check-the-route-reference.md),
   [25](issues/25-db-insert-without-type-fails-with-an-unrelated-typeerror.md)).
4. `Db.get`: a table's own columns win over a referenced table's, qualified
   keys for the reference filter; the route join keeps or reports dropped
   rows ([05](issues/05-db-get-where-resolves-through-the-referenced-table.md),
   [06](issues/06-route-join-drops-rows-with-unresolvable-references.md)).
5. A `BuffetController` and `createBuffetTableCfg`; a valid
   `createInsertHistoryTableCfg` ([08](issues/08-no-controller-for-buffets-in-db.md),
   [09](issues/09-insert-history-table-cfg-fails-the-validator.md)).
6. `IoMulti`: answer as soon as one member has rows, expose the `IoPeer`
   timeout, fail pending acknowledgements on disconnect, make whole-table
   cascading opt-in ([10](issues/10-iomulti-waits-for-the-slowest-member-and-iopeer-timeout-is-fixed.md),
   [11](issues/11-iomulti-whole-table-read-copies-a-peers-table.md)).
7. `IoMem._updateGlobalHash` without `throwOnWrongHashes`;
   `Db.getInsertHistory` through `readRows`
   ([12](issues/12-iomem-rehashes-the-whole-store-on-dumptable-after-a-write.md)).
8. Network: refresh a known peer's `NodeInfo`, feed the dampened
   reachability into the election, a metadata field on `NodeInfo`, injected
   stores for `Node`, a hub connector on `Server`, the sender identity in
   `listen` ([07](issues/07-peer-table-keeps-a-restarted-peers-old-startedat.md),
   [17](issues/17-election-reads-raw-probes-and-ignores-failthreshold.md),
   [22](issues/22-nodeinfo-carries-no-name-or-metadata.md),
   [21](issues/21-node-is-hard-wired-to-iomem-and-bsmem.md),
   [19](issues/19-server-has-no-connector-of-its-own.md),
   [18](issues/18-connector-listen-drops-the-client-identity.md)).
9. SQLite: WAL as an option or the documented default, one `init()`, a
   cached schema, no fixed sleep
   ([13](issues/13-sqlite-defaults-cost-two-fsyncs-per-row.md),
   [28](issues/28-sqlite-lifecycle-init-twice-relative-path-and-fixed-sleep.md),
   [29](issues/29-tablecfgs-are-re-read-on-every-readrows-and-write.md)).
10. Packaging: current ranges in `validate` and `io-sqlite-node`, socket.io
    as peer dependencies of `server`, no unused `sql.js`; `Hashed<T>` as
    the return type of `hsh`
    ([30](issues/30-dependency-ranges-install-several-copies-of-rljson-hash-and-io.md),
    [32](issues/32-hsh-and-hip-are-typed-to-return-t-instead-of-hashed-t.md)).
11. Version deltas on the wire, so that a renamed animal with a
    7 000-character story ships 3.5 kB instead of 10.9 kB while rows stay
    whole, hashed and verified; with guidance to model an entity as a
    tuple of references and a worked cakes example. Measured and argued
    in [granularity-and-deltas.md](granularity-and-deltas.md).
12. Documentation: per-table `detectDagBranch`, the repeated-insert rule,
    the head-table `id` rules and the `jsonArray` element question, the
    `timeId` order ([23](issues/23-detectdagbranch-is-per-table-not-per-entity.md),
    [24](issues/24-duplicate-insert-appends-a-history-row-and-a-new-tip.md),
    [26](issues/26-validator-does-not-enforce-the-head-table-id-rules.md),
    [27](issues/27-jsonarray-columns-have-no-element-type.md),
    [31](issues/31-timeid-has-no-order-within-a-millisecond.md)).

## Issue index

| Number                                                                              | Package (version)                                    | Title                                                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [01](issues/01-wire-accepts-write-and-close-from-any-peer.md)                       | io 0.0.78, server 0.0.64                             | `IoServer` and `IoPeerBridge` answer `write`, `close` and `createOrExtendTable` for any connected peer        |
| [02](issues/02-sqlite-where-values-interpolated-into-sql.md)                        | io-sqlite-node 1.0.7                                 | `IoSqliteNode.readRows` interpolates `where` values into SQL without escaping                                 |
| [03](issues/03-server-teardown-closes-the-callers-io.md)                            | server 0.0.64                                        | `Server.tearDown()` closes the local `Io` it was handed; no `ownsStores`                                      |
| [04](issues/04-db-insert-persists-only-the-first-history-row.md)                    | db 0.0.42                                            | `Db.insert` with several rows persists only the first InsertHistory row                                       |
| [05](issues/05-db-get-where-resolves-through-the-referenced-table.md)               | db 0.0.42                                            | `Db.get` `where` keys shared with a referenced table filter the referenced table                              |
| [06](issues/06-route-join-drops-rows-with-unresolvable-references.md)               | db 0.0.42                                            | The route join drops source rows whose reference does not resolve                                             |
| [07](issues/07-peer-table-keeps-a-restarted-peers-old-startedat.md)                 | network 0.0.21                                       | `PeerTable` keeps a restarted peer's old `startedAt`: permanent split view                                    |
| [08](issues/08-no-controller-for-buffets-in-db.md)                                  | db 0.0.42, rljson 0.0.81                             | No controller for `buffets` in `Db`, no `createBuffetTableCfg`                                                |
| [09](issues/09-insert-history-table-cfg-fails-the-validator.md)                     | rljson 0.0.81                                        | `createInsertHistoryTableCfg` fails the validator and references `<table>MultiEdits`                          |
| [10](issues/10-iomulti-waits-for-the-slowest-member-and-iopeer-timeout-is-fixed.md) | io 0.0.78, server 0.0.64                             | `IoMulti.readRows` waits for the slowest member; the 30 s `IoPeer` timeout is not configurable                |
| [11](issues/11-iomulti-whole-table-read-copies-a-peers-table.md)                    | io 0.0.78                                            | `IoMulti.readRows` with an empty `where` copies a peer's whole table into the local store                     |
| [12](issues/12-iomem-rehashes-the-whole-store-on-dumptable-after-a-write.md)        | io 0.0.78, db 0.0.42                                 | `IoMem` re-hashes the whole store on `dumpTable` after a write; `Db.getInsertHistory` inherits it             |
| [13](issues/13-sqlite-defaults-cost-two-fsyncs-per-row.md)                          | io-sqlite-node 1.0.7                                 | `IoSqliteNode` defaults cost two `fsync`s per row                                                             |
| [14](issues/14-db-insert-does-not-check-the-route-reference.md)                     | db 0.0.42, rljson 0.0.81                             | `Db.insert` does not check the route reference; hash form names every history row of that content             |
| [15](issues/15-db-insert-issues-the-timeid-itself.md)                               | db 0.0.42                                            | `Db.insert` issues the `timeId` itself; no deterministic history                                              |
| [16](issues/16-core-import-validation-accepts-dangling-references.md)               | db 0.0.42                                            | `Core.import` validation accepts dangling references but rejects buffets with stored targets                  |
| [17](issues/17-election-reads-raw-probes-and-ignores-failthreshold.md)              | network 0.0.21                                       | `electHub` reads raw probes; `failThreshold` never reaches the election                                       |
| [18](issues/18-connector-listen-drops-the-client-identity.md)                       | db 0.0.42, rljson 0.0.81                             | `Connector.listen` drops the client identity; `cksum` unused; bootstrap identity                              |
| [19](issues/19-server-has-no-connector-of-its-own.md)                               | server 0.0.64                                        | `Server` has no connector of its own; the loopback counts as a client                                         |
| [20](issues/20-client-teardown-leaves-the-peer-bridges-on-the-socket.md)            | server 0.0.64                                        | `Client.tearDown()` leaves the peer bridges on the socket                                                     |
| [21](issues/21-node-is-hard-wired-to-iomem-and-bsmem.md)                            | server 0.0.64                                        | `Node` is hard-wired to `IoMem` and `BsMem`                                                                   |
| [22](issues/22-nodeinfo-carries-no-name-or-metadata.md)                             | network 0.0.21                                       | `NodeInfo` carries no name or metadata; no "last heard from"                                                  |
| [23](issues/23-detectdagbranch-is-per-table-not-per-entity.md)                      | db 0.0.42                                            | `detectDagBranch` is per table, not per entity                                                                |
| [24](issues/24-duplicate-insert-appends-a-history-row-and-a-new-tip.md)             | db 0.0.42                                            | A repeated identical insert appends a history row and a new tip                                               |
| [25](issues/25-db-insert-without-type-fails-with-an-unrelated-typeerror.md)         | db 0.0.42                                            | `Db.insert` without `_type` fails with an unrelated `TypeError`                                               |
| [26](issues/26-validator-does-not-enforce-the-head-table-id-rules.md)               | rljson 0.0.81                                        | The validator does not enforce the head-table `id` rules                                                      |
| [27](issues/27-jsonarray-columns-have-no-element-type.md)                           | rljson 0.0.81, json 0.0.23                           | `jsonArray` columns have no element type                                                                      |
| [28](issues/28-sqlite-lifecycle-init-twice-relative-path-and-fixed-sleep.md)        | io-sqlite-node 1.0.7                                 | `IoSqliteNode` lifecycle: `init()` twice leaks, relative path under `./data`, fixed 800 ms sleep              |
| [29](issues/29-tablecfgs-are-re-read-on-every-readrows-and-write.md)                | io 0.0.78, io-sqlite-node 1.0.7                      | Table configurations are re-read on every `readRows` and `write`                                              |
| [30](issues/30-dependency-ranges-install-several-copies-of-rljson-hash-and-io.md)   | validate 0.0.11, io-sqlite-node 1.0.7, server 0.0.64 | Dependency ranges install several copies of `rljson`, `hash`, `io`; `server` lacks socket.io; unused `sql.js` |
| [31](issues/31-timeid-has-no-order-within-a-millisecond.md)                         | rljson 0.0.81                                        | `timeId()` has no order within a millisecond                                                                  |
| [32](issues/32-hsh-and-hip-are-typed-to-return-t-instead-of-hashed-t.md)            | hash 0.0.19                                          | `hsh` and `hip` are typed to return `T` instead of `Hashed<T>`                                                |

Not included on purpose: the `loafoe/ssh` Terraform provider's debug
logging, the Hetzner and Kubernetes provider notes in
[`../findings/terraform-cluster.md`](../findings/terraform-cluster.md),
[`../findings/kubernetes-workloads.md`](../findings/kubernetes-workloads.md)
and [`../findings/tls-cert-manager.md`](../findings/tls-cert-manager.md);
they concern other projects.
