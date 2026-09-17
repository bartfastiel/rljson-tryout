# Seeding thousands of rows into `Db` over `IoMem`

## What we tried

- `@rljson/db` 0.0.42, `@rljson/io` 0.0.78, `@rljson/rljson` 0.0.81,
  `@rljson/hash` 0.0.19, Node 24.18.0, while building slice B10 (the seed
  generator with the sizes `none`, `small`, `medium` and `large`, roadmap
  section 2.4) on a Windows 11 workstation (the machine every number below
  was measured on).
- Wrote the generator in `packages/domain/src/generator`: fixed Duckburg
  pools for species (55 with Latin names), traits (45), first names,
  surnames, streets, farm kinds, animal names and epithets, a `mulberry32`
  random source seeded from a string, and one generation pass per table in
  reference order, every row hashed with `hsh`. `medium` adds 10 species,
  15 traits, 35 persons, 10 breeders, 30 customers, 100 animals, 200
  invoices with 400 items; `large` adds 50, 40, 325, 50, 300, 2 000, 5 000
  and 12 000. Generation alone takes 9 ms (`medium`) and 125 ms (`large`).
- Measured two ways of writing the generated rows into a fresh
  `Db(new IoMem())` with a throwaway script: one `Db.insert` per row (the
  path the hand-written seed and the API use, which writes the
  InsertHistory row itself) against one `Core.import` of a whole table
  followed by one `Core.import` of hand-built InsertHistory rows, both with
  `{ validate: false }`, plus the same import in chunks of 500 rows and
  once with validation on. 2 000 animal rows with a 600 character story
  and 12 000 invoice item rows, one run each.
- Seeded `PetShopStore` with every size through its real write path and
  timed `seedIfEmpty`, the process' resident set size before and after,
  and every read and write the API performs, first cold and then again
  (`packages/node-service/src/store/petShopStore.seed.test.ts` keeps the
  `large` seed under a 30 second budget as a test).
- Profiled `updateAnimal` on the `large` store with the V8 CPU profiler
  (`node:inspector`, `Profiler.start` after seeding) and attributed the
  samples to the first frame outside `@rljson/hash` and `@rljson/json`.
- Started the node with `SEED_SIZE=large` on port 8361, read the start
  log, `GET /api/stats`, `GET /api/animals?q=duck&limit=5`, and timed the
  list endpoints with `curl`.
- Ran the Playwright suite (178 tests, phone and desktop) against
  `SEED_SIZE=small` and `SEED_SIZE=medium`.
- After slice C1 landed, seeded `medium` and `large` into the SQLite store
  through the same path and timed the seed and the reads again.

## What happened

Per-row `Db.insert` against bulk `Core.import`, fresh store, `IoMem`:

| Write path                                   | 2 000 animals | 12 000 invoice items |
| -------------------------------------------- | ------------: | -------------------: |
| `Db.insert`, one row per call                |         96 ms |               636 ms |
| `Core.import`, whole table plus history rows |         22 ms |               102 ms |
| `Core.import`, chunks of 500 rows            |         19 ms |               102 ms |
| `Core.import`, whole table, validation on    |         24 ms |                      |

- `Db.insert` costs about 0.05 ms per row on `IoMem` and writes exactly
  one InsertHistory row per call; the bulk import is about six times
  faster but bypasses everything `Db` does per write: `Db.insert` also
  keeps its incremental DAG tip set (`_applyRowToDagTips`) and fires its
  insert notifications, so after a bulk import `detectDagBranch` had to
  rescan the table (147 ms for 12 000 history rows, 0 ms after the per-row
  path) and no `Db` observer would have seen the rows. Given the absolute
  numbers, the store wrote the generated rows through the same `writeRow`
  the API paths use, one `Db.insert` per row plus one change set per
  entity through `Core.import`, and kept the bulk path as a measured
  alternative rather than code. Slice D3 moved every seed write, the
  hand-written rows included, to `Core.import` per row after all, for a
  reason the numbers had nothing to do with: `Db.insert` issues the
  `timeId` of the history row itself and offers no way to pass one in, and
  once nodes exchange change sets two nodes seeding the same rows under
  different history rows hold two tips per seed entity. The seed now
  stamps its history rows from a fixed epoch plus a counter (`seedTimeId`)
  and gives every hand-written entity a change set as well, so that every
  node seeding a size writes identical rows, history rows and change sets
  (`docs/findings/change-set-sync.md`). The per-row `Core.import` costs
  about what `Db.insert` did (`medium` seeds in about the same 80 ms in
  memory); what is lost is the incremental DAG tip set and the insert
  notifications for seeded rows, which nothing reads yet.
- `Core.import` with validation on accepted the 2 000 animals whose
  `speciesRef`, `breederRef` and `traitsRefs` pointed at hashes no table
  holds: `Core.import` throws only for validator errors other than
  `refsNotFound` and `layerBasesNotFound`, so the per-row validation inside
  `ComponentController.insert` never rejects a dangling reference either,
  consistent with `docs/findings/db-basics.md`.

Seeding through `PetShopStore.seedIfEmpty` (hand-written seed through the
old code path, generated rows through `writeRow` and `writeChangeSet`):

| Size     | Rows written (domain tables) | Change sets | `seedIfEmpty` | RSS after seeding |
| -------- | ---------------------------: | ----------: | ------------: | ----------------: |
| `small`  |                           76 |           6 |         15 ms |             72 MB |
| `medium` |                        1 119 |         406 |         78 ms |             84 MB |
| `large`  |                       24 759 |       7 771 |  1.3 to 1.4 s |     250 to 270 MB |

The process holds 64 MB before any seeding. Over the SQLite store of slice
C1 (`WriteAheadLogSqliteIo`, one transaction per `Io.write`), the same
path seeds `medium` in 0.7 s and `large` in 16 s, about 0.5 ms per row
against 0.05 ms in memory, with the reads afterwards still quick
(`listAnimals` 15 ms, `listInvoices` 105 ms, `updateAnimal` 66 ms,
`getAnimal` 14 ms) and 208 MB resident, measured by hand: the store test
seeds `medium` into both stores and `large` into memory only, which keeps
the unit suite short.

- The node process logs `seedDurationMilliseconds: 1343` and
  `rssBytes: 270557184` for `large` at start; fourteen seconds later
  `GET /api/stats` reported `rssBytes: 118181888`, so about 150 MB of the
  peak is garbage V8 had not yet returned. The heap in use after a forced
  garbage collection is 43 MB for the `large` store, 14 MB for `medium`.
  The Kubernetes memory limit of 512 Mi (`infra/terraform/workloads`)
  leaves room for `large` on the in-memory node; production runs `medium`.
- Every table has exactly as many InsertHistory rows as rows, and the
  whole `large` store validates as one rljson document
  (`BaseValidator`: every reference and every change set item resolves)
  in about a second.

Reads and writes on the `large` store (2 010 animals, 5 006 invoices,
12 011 items), before and after two changes in `PetShopStore`:

| Operation                     | Before |               After |
| ----------------------------- | -----: | ------------------: |
| `listAnimals`, first call     | 235 ms |                5 ms |
| `listAnimals`, again          |   5 ms |                3 ms |
| `getAnimal`                   |   3 ms |                3 ms |
| `updateAnimal`                | 453 ms |               16 ms |
| `listInvoices`                | 497 ms |               22 ms |
| `getInvoice`                  |  29 ms |               18 ms |
| `issueInvoice`                |  24 ms |               22 ms |
| `listCustomers`, first call   | 239 ms |                1 ms |
| `GET /api/invoices` over HTTP |        | 55 ms, 1.28 MB body |
| `GET /api/animals` over HTTP  |        |    9 ms, 12 kB body |

- The profile of `updateAnimal` before the change put 86 percent of the
  time under `IoMem._updateGlobalHash`, called from `IoMem._refreshHashes`,
  called from `IoMem._dumpTable`: after any write, the next `dumpTable`
  or `dump` recomputes the hash of the whole store with
  `hip(this._mem, { updateExistingHashes: false })`, and since that call
  leaves `throwOnWrongHashes` at its default, `hip` re-hashes every row of
  every table to validate the existing hashes, about 230 ms for the
  `large` store. `Db.getInsertHistory` reads through `Core.dumpTable`, so
  every list that read a history table after a write paid for it, and an
  edit paid three times (it reads before and after its writes). `Io.readRows`
  with an empty `where` returns the same rows without the refresh, so
  `PetShopStore.readVersioned` now reads history rows through
  `readHistoryRows` (`Io.readRows`), the way `readChangeSets` already read
  its table.
- `listInvoices` built a `Map` of every customer, person, animal and
  species once per invoice and filtered all 12 011 items once per invoice:
  5 006 invoices times 15 000 rows. `InvoiceTables` now carries the
  lookups and the items grouped by `invoiceRef`, built once per read.
- With writes this fast, two versions of one animal written one after
  another land in the same millisecond and their `timeId`s tie; the
  unique part of a `timeId` is random, so "newest first" by `timeId` alone
  put the older version first in one test out of ten. `entityVersions.ts`
  now orders versions by their depth in the `previous` chain and only then
  by `timeId` (`depthsOf`), which is deterministic for chains and leaves
  branches of equal depth to the `timeId`.

Playwright, 178 tests at two viewports: 8.0 to 8.5 s against
`SEED_SIZE=small`, 11.8 to 12.7 s against `SEED_SIZE=medium`, three clean
runs each; the tests read the counts they assert from the node so the
same suite passes at both sizes.

## What it means for rljson users

- `Db.insert` per row is fast enough on `IoMem` to seed tens of thousands
  of rows in a second or two; reach for `Core.import` when the per-write
  bookkeeping of `Db` (history rows, DAG tips, notifications) is not
  wanted, or when the history rows must be the same on every node that
  seeds, and then write the InsertHistory rows yourself with your own
  `timeId`s.
- Never read through `dump` or `dumpTable` on a hot path of an `IoMem`
  store that is also written to: each such read after a write costs a full
  re-hash of the store. `Io.readRows` with an empty `where` is the cheap
  way to read a whole table, `Db.get` with an empty `where` the cheap way
  through `Db`.
- Two `timeId`s issued within one millisecond order arbitrarily; anything
  that orders versions must fall back on `previous`, which is the only
  order rljson guarantees.
- Change set granularity for a seed: one change set per entity (a species,
  an animal with its junction rows, an invoice with its items) mirrors what
  the API paths write and keeps every change set small enough to pull as a
  unit; the hand-written seed is 44 change sets, the generated `medium`
  seed adds 400, the generated `large` seed 7 771.

## Candidates for upstream issues

- `IoMem._refreshHashes` recomputes the hash of the whole store on every
  `dump` or `dumpTable` that follows a write, even when one table is
  dumped, and `_updateGlobalHash` runs `hip` with `throwOnWrongHashes` on,
  which re-hashes every row to validate hashes the store itself wrote.
  Reproduction: write one row into a store of 40 000 rows, then
  `dumpTable` of any table; profile shows `_updateGlobalHash` at hundreds
  of milliseconds. Refreshing only the dirty tables' hashes with
  `throwOnWrongHashes: false`, and the global hash lazily on `dump`, would
  make `dumpTable` proportional to the table.
- `Db.getInsertHistory` reads through `Core.dumpTable` and therefore
  inherits the cost above; `Core.readRows` with an empty `where` returns
  the same rows.
- `Core.import` with validation on accepts a document with dangling
  references (it throws only for validator errors other than
  `refsNotFound` and `layerBasesNotFound`), so the validation
  `ComponentController.insert` runs per row never catches a broken
  reference; the option is either misleading or its exception list too
  wide. Reproduction: `core.import({ animals: { _type: 'components', _data: [{ ..., speciesRef: 'nobody' }] } })`
  succeeds with a `species` table in the store that holds no such hash.
- `timeId()` issues `<milliseconds>:<4 random characters>`, so two rows
  written within one millisecond have no defined order; a monotonic
  counter within the millisecond would make `timeId` order equal write
  order on one node.
