# Versions of an entity: InsertHistory, `previous` and the current version

## What we tried

- `@rljson/db` 0.0.42, `@rljson/rljson` 0.0.81, `@rljson/io` 0.0.78,
  `@rljson/hash` 0.0.19, Node 24.18.0, while building slice B9 (the
  "current version" rule of roadmap section 2.6, `PUT /api/animals/:id`
  and `GET /api/animals/:id/history`).
- Read `Db.insert`, `Db._insert`, `Db._writeInsertHistory`,
  `Db.detectDagBranch`, `Db._dagTipsFor`, `Db.getInsertHistory`,
  `Db.getTimeIdsForRef` in `node_modules/@rljson/db/dist/db.js`,
  `Route.fromFlat` in `node_modules/@rljson/rljson/dist/rljson.js` and the
  `InsertHistoryRow` type in
  `node_modules/@rljson/rljson/dist/insertHistory/insertHistory.d.ts`.
- Ran a throwaway script against `Db(new IoMem())` with an `animals`
  components table plus its InsertHistory companion: inserted a first
  version through the plain route `animals`, a second version through
  `animals@<timeId of the first history row>`, a third through
  `animals@<hash of the second row>`, then a second entity, then the third
  row's content again as a follow-up version; read the history back with
  `getInsertHistory`, called `detectDagBranch` after every step and read
  an old version back with `db.get(Route.fromFlat('animals@<hash>'), {})`.
- Inserted 1 000 entities with 10 chained versions each (10 000 history
  rows) through `Db.insert` and timed the insert loop, `getInsertHistory`,
  `db.get` of the whole table and `detectDagBranch`; then timed the domain
  rule (`currentVersions`, `versionsOf` in
  `packages/domain/src/entityVersions.ts`) over the same shape of data and
  over 10 entities with 1 000 versions, 10 000 entities with one version,
  and 1 000 entities of which 100 carry a branch (20 runs each, median).

## What happened

How `Db.insert` builds the history row of a follow-up version:

- `InsertHistoryRow.previous` is typed `InsertHistoryTimeId[]`: it holds
  the `timeId`s of the history rows the new row supersedes, not their
  hashes and not the row hashes. A `timeId` is `<milliseconds since
epoch>:<4 nanoid characters>` (`1789654560429:vqqc`), issued by
  `timeId()` from `@rljson/rljson` at write time.
- `Db._insert` reads the reference on the route's first segment.
  `Route.fromFlat('animals@X')` classifies `X` by shape: a value that
  splits into exactly two parts on `:` is an `animalsInsertHistoryRef`
  (a `timeId`), anything else an `animalsRef` (a row hash). With a
  `timeId`, the history row gets `previous: [thatTimeId]`; with a row
  hash, it gets `previous: <every timeId whose history row references that
hash>` (`getTimeIdsForRef`), which is one `timeId` for a row written once
  and several for a row written more than once. Without a reference,
  `previous` is `[]`. Neither form is checked against the history: a
  `timeId` no history row has (`animals@1234567890123:zzzz`) is accepted
  verbatim into `previous`, and a hash nobody has gives `previous: []`,
  the same as no reference at all; neither is an error, so a caller that
  mistypes a hash silently starts a new, unchained version.
- The history row `Db.insert` returns for a chained write is
  `{ animalsRef: <new row hash>, route: '/animals@1789654560429:vqqc', origin: 'db.insert', timeId: '1789654560430:OQDW', previous: ['1789654560429:vqqc'] }`:
  the `route` column keeps the reference the caller used, so the history
  table itself records which version an edit was made against, in the
  caller's own terms (`timeId` or hash).
- `hsh(<returned history row>)._hash` equals the `_hash` `IoMem` stored
  the history row under, the same property `docs/findings/change-sets.md`
  found for independent inserts, so a change set item for a chained
  history row costs no second read either.
- `db.get(Route.fromFlat('animals@<old hash>'), {})` returns the old
  version's row after newer versions were written: a version stays
  readable by hash forever, which is what `GET /api/animals/:id?version=`
  serves.
- Writing identical content as a follow-up version (an edit that restores
  earlier content, or an edit that changes nothing) leaves the row count
  unchanged (rows are content addressed) but appends a history row whose
  `animalsRef` is the existing hash and whose `previous` names the tip. A
  version is therefore a history row, not a row: the same hash can be two
  versions of one entity, and `getTimeIdsForRef` then returns two
  `timeId`s for that hash.

`detectDagBranch` per table, per entity:

- `detectDagBranch(table)` reports `{ type: 'dagBranch', branches: [...tips] }`
  as soon as the table's history has more than one tip, a tip being a
  `timeId` no row names in `previous`. After chaining three versions of one
  animal it returned `null`; after inserting a second, unrelated animal it
  returned a branch with two tips. Independent entities of one table are
  indistinguishable from a conflict at this level, as
  `docs/findings/db-basics.md` anticipated. With 1 000 chained entities it
  reported 1 000 tips.
- There is no per-entity variant: the function takes a table name only,
  its state (`_dagTips`) is keyed by table, and a history row carries no
  `id`, only the row hash. It cannot be used per entity as is. Grouping
  has to go through the row: `history.animalsRef` → `animals` row → `id`.
  That is what `currentVersions` in `packages/domain/src/entityVersions.ts`
  does, and `Db.detectDagBranch` stays what it is, a per-table signal that
  slice D11 can subscribe to (`registerConflictObserver`) as a cheap
  trigger before running the per-entity rule.
- `detectDagBranch` keeps its tip set incrementally after one full scan,
  so the call took 0.0 ms at 10 000 rows once warm; `getInsertHistory` of
  the same table took 50.6 ms (it dumps and copies 10 000 rows) and
  `db.get` of the 10 000 animal rows 4.2 ms; the 10 000 chained
  `Db.insert` calls took 333 ms in total, 0.03 ms each.

The domain rule at 10 000 history rows (`currentVersions` resolves every
entity's current row and the set of conflicting ids; `versionsOf` lists one
entity's versions newest first; both take the table's rows and history rows
as plain arrays):

| Shape                                           | `currentVersions` median | `versionsOf` median |
| ----------------------------------------------- | -----------------------: | ------------------: |
| 1 000 entities × 10 versions                    |                  1.41 ms |             0.91 ms |
| 10 entities × 1 000 versions                    |                  1.19 ms |             0.89 ms |
| 10 000 entities × 1 version                     |                  2.91 ms |             1.41 ms |
| 1 000 entities × 10 versions, 100 with two tips |                  1.40 ms |             0.75 ms |

The rule is linear in the number of history rows (one `Map` of rows by
hash, one pass to group history rows by entity, one `Set` of superseded
`timeId`s per entity) and never touches the store. Reading the two tables
costs more than applying the rule: in `PetShopStore` every list now reads
the entity table plus its history table (`readVersioned`), 55 ms of
`Db.get` plus `getInsertHistory` at 10 000 rows against 1.4 ms for the rule.
One edit is the most expensive operation: `updateAnimal` reads the animal
tables once to build the new version, reads `animalTraits` with its history
to chain the junction rows, and reads the animal tables again to answer
with the new detail, three full reads of every version of every table
involved; at the 10 000 row scale of the measurements that is a few hundred
milliseconds per edit, acceptable now and the first place to revisit when
slice B10's `large` seed arrives (an incremental read of only the rows a
change set names, or a cached tip set the way `Db._dagTips` keeps one).

Behaviour decisions the rule makes, each covered by a unit test:

- Tips are computed per entity `id`; the current version is the tip, and
  an entity with more than one tip is reported in `conflictingIds` while
  still getting a current row (the tip with the newest `timeId`, ties
  broken by the `timeId`'s unique part), so no list ever drops an entity
  because of a conflict.
- A history row whose reference matches no row is ignored; a row no
  history row references is not a version and is not listed (every write
  in this project goes through `Db.insert` or writes its history row
  alongside, so nothing is lost).
- A cycle in `previous` (impossible from honest writes, possible from a
  hostile peer) leaves the newest version as the single tip instead of
  making the entity disappear.
- Versions are ordered by their depth in the `previous` chain before the
  `timeId` decides (added in slice B10): two versions written within one
  millisecond share a timestamp and the unique part of a `timeId` is
  random, so `timeId` order alone put an older version first once the
  store's writes got fast enough (`docs/findings/seed-generator.md`).
  Depth is deterministic for a chain; tips of equal depth, and versions on
  a cycle, still fall back to the `timeId`.

What `PetShopStore.updateAnimal` writes, in this order, all named by one
change set (`update-animal-<id>-<new timeId>`): the new `animals` row
through the route `animals@<timeId of the current version's history row>`
plus its history row; one `animalTraits` row per trait for the new animal
hash, each through `animalTraits@<timeId of the pairing's current version>`
when the pairing `<animalId>--<traitId>` existed before (a new version of
the pairing) and through the plain route otherwise, plus their history
rows. Junction rows of the old animal version stay behind as tips of their
own pairings only when a trait was removed; `JunctionTraitRelation` reads
by `animalRef`, so they never leak into the current version's traits
(`docs/findings/n-to-m.md`, "Versioning consequences"). Concurrent edits
of one animal are serialised on the store's write chain, so on one node two
edits always chain; two nodes editing the same animal will produce two tips
(slice D11).

## What it means for rljson users

- To write a follow-up version, insert through `<table>@<timeId>` of the
  version being superseded, taken from the history row the previous
  `Db.insert` returned or from `getInsertHistory`. Prefer the `timeId`
  over the row hash: with a hash, `previous` names every history row of
  that hash, which after a restore-to-earlier-content edit is more than one
  and would close a branch by accident.
- The "current version" rule of roadmap section 2.6 has to be application
  code: rljson gives the DAG (`previous`), the per-table tip detection and
  the reads, but not "tips per entity". Keep the rule pure and feed it the
  two tables; it costs about a millisecond at 10 000 history rows.
- Treat a version as a history row. The row hash identifies content, the
  `timeId` identifies the write; a history view is keyed by `timeId`, a
  "view this version" link by hash is fine because equal content is equal.
- `Db.detectDagBranch` fires on every history write for the table and is
  the natural trigger for conflict handling, but its `branches` are the
  table's tips, not conflicts; run the per-entity rule when it fires.
- The `route` column of a history row records the reference used for the
  write and is the only place that says whether the writer chained by
  `timeId` or by hash.
- Order a `jsonArray` of references canonically before hashing. The order
  of `traitsRefs` carries no meaning, but it is content and therefore part
  of the row hash; read back through the junction table it comes in hash
  order, through the multi-reference column in stored order, so an edit
  that kept the traits produced a different row hash per
  `TraitRelation` mode until `traitsRefsOf` sorted them by trait id
  (`packages/domain/src/tables/animals.ts`), which also makes a restore
  of the seed content reproduce the seed hash.

## Candidates for upstream issues

- `Db.detectDagBranch(table)` reports a branch for any table with two
  independent entities, and there is no per-entity variant, although
  `TableCfg` documents `id` as the stable identity of an entity across
  versions. Reproduction: insert two rows with different `id` into a head
  table through the plain route, `detectDagBranch(table)` returns a
  `dagBranch` conflict with two tips.
- `Route.fromFlat` decides between a history reference and a row reference
  by counting `:` in the segment reference, so a row hash can never be
  confused with a `timeId` today, but the rule is undocumented and a
  future hash alphabet containing `:` would silently flip the meaning.
  Reproduction: `Route.fromFlat('animals@a:b').segment(0)` has
  `animalsInsertHistoryRef`, `Route.fromFlat('animals@a:b:c').segment(0)`
  has `animalsRef`.
- `Db.insert` through `<table>@<row hash>` sets `previous` to every
  `timeId` of that hash, which for a row written more than once names more
  than one version; a caller who means "the current one" has no way to say
  so through the hash form. Reproduction: insert row A, then row B through
  `table@<A timeId>`, then A again through `table@<B timeId>`, then C
  through `table@<A hash>`: C's `previous` has two entries.
- `Db.insert` does not check the reference of the route against the
  history: a `timeId` that does not exist is written into `previous` as
  given, and a hash that does not exist silently yields `previous: []`.
  Reproduction: `db.insert(Route.fromFlat('animals@1234567890123:zzzz'), ...)`
  returns `previous: ['1234567890123:zzzz']`;
  `db.insert(Route.fromFlat('animals@NoSuchHash'), ...)` returns
  `previous: []`.
