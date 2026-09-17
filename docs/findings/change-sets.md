# Change sets as an rljson `buffets` table

## What we tried

- `@rljson/rljson` 0.0.81, `@rljson/db` 0.0.42, `@rljson/io` 0.0.78,
  `@rljson/hash` 0.0.19, Node 24.18.0, while building slice B8 (customers,
  invoices, invoice items and the `changeSets` table of roadmap section
  3.4).
- Read `node_modules/@rljson/rljson/dist/content/buffet.d.ts` (`Buffet`,
  `BuffetsTable`), the bakery example in `dist/rljson.js`
  (`bakeryExample().buffets`), `BaseValidator._buffetReferencedTableNotFound`
  and the `validate()` step list, `createInsertHistoryTableCfg`, and in
  `node_modules/@rljson/db/dist/db.js` `Db.insert`, `Db._insert`,
  `Db._writeInsertHistory`, `Db.getController`, `createController` and
  `Core.import`.
- Ran throwaway scripts against a real `Db(new IoMem())` with an `invoices`
  components table and a `changeSets` table declared as
  `{ key: 'changeSets', type: 'buffets', columns: [_hash, id, items (jsonArray)] }`:
  created both with their InsertHistory companions, inserted through
  `Db.insert`, imported through `Core.import` with and without validation,
  read through `Db.get`, `Io.readRows`, `Core.readRow` and `Io.dumpTable`,
  and ran `Validate` with `BaseValidator` over documents whose buffet items
  were valid, dangling, pointed at a missing table, pointed at InsertHistory
  rows, or were not an array.
- Issued invoices through `PetShopStore.issueInvoice` (one `invoices` row,
  one `invoiceItems` row per line, one `changeSets` row), dumped the whole
  store with `Io.dump()` and ran `BaseValidator` over the dump.

## What happened

Declaring the table:

- A `Buffet` is `{ items: [{ table, ref }], id? }`; `BuffetsTable` is
  `RljsonTable<Buffet, 'buffets'>`. The bakery example's buffet row is
  `{ id: 'salesCounter', items: [{ table: 'cakes', ref: <cake hash> }] }`.
- rljson ships no `createBuffetTableCfg` (it does ship `createCakeTableCfg`,
  `createLayerTableCfg`, `createSliceIdsTableCfg`, `createTreesTableCfg`), so
  `changeSetsTableCfg` spells its columns out: `_hash` and `id` as
  `string`, `items` as `jsonArray`. `throwOnInvalidTableCfg` accepts it,
  `IoMem.createOrExtendTable` creates it, and `io.contentType({ table })`
  reports `buffets`.
- `createInsertHistoryTableCfg(changeSetsTableCfg)` behaves exactly as for a
  components table: key `changeSetsInsertHistory`, columns `_hash`,
  `timeId`, `changeSetsRef`, `route`, `origin`, `previous`,
  `clientTimestamp`, and the reference column carries
  `ref: { tableKey: 'changeSetsMultiEdits', type: 'buffets' }`, the same
  `<table>MultiEdits` target `docs/findings/db-basics.md` already lists as
  an upstream candidate. `hsh` gives every element of `items` its own
  `_hash` besides the row's.

Writing:

- `db.insert(Route.fromFlat('changeSets'), { changeSets: { _type: 'buffets', _data: [row] } })`
  throws `Controller for type buffets is not implemented yet.`:
  `createController` in `@rljson/db` 0.0.42 has cases for `layers`,
  `components` (also `edits`, `editHistory`, `multiEdits`,
  `insertHistory`), `cakes`, `sliceIds` and `trees`, and `Db._insert` has
  no branch for `buffets` either. `Db` cannot write a buffets table.
- `db.core.import({ changeSets: { _type: 'buffets', _data: [row] } })`
  with the default validation fails with `buffetReferencedTablesNotFound`
  because `Core.import` validates the payload as a document of its own and
  the tables the items point at are not in it. With the referenced rows
  included in the same payload (`{ invoices: {...}, changeSets: {...} }`)
  the import passes and re-writing the already stored invoice row is a
  no-op (row count unchanged). With `{ validate: false }`, the same option
  `Db._writeInsertHistory` uses for its own history rows, the change set is
  written on its own; `IoMem` still checks the column types on write: a
  string in `items` fails with
  `Column "items" in row 0 of "changeSets" has type "string", but expected "jsonArray"`,
  an unknown column with `Column "extra" ... does not exist.`
- Importing the same change set row twice leaves the row count at one:
  buffets rows are content addressed like every other row.
- The InsertHistory row for a change set can be written the same way:
  `core.import({ changeSetsInsertHistory: { _type: 'insertHistory', _data: [{ timeId: timeId(), changeSetsRef, route: '/changeSets', origin, previous: [] }] } }, { validate: false })`,
  after which `db.getInsertHistory('changeSets')` returns it and
  `db.detectDagBranch('changeSets')` returns `null` for a single row.
  `timeId()` is exported by `@rljson/rljson`.

Reading:

- `db.get(Route.fromFlat('changeSets'), {})` throws the same
  `Controller for type buffets` error, so `Db` cannot read a buffets table
  either.
- `io.readRows({ table: 'changeSets', where: {} })`, `where: { _hash }`,
  `where: { id }`, `db.core.readRow('changeSets', hash)` and
  `io.dumpTable({ table: 'changeSets' })` all return
  `{ changeSets: { _type: 'buffets', _data: [...] } }` with the items'
  nested `_hash` values as stored.

Validating:

- `BaseValidator._buffetReferencedTableNotFound` is the last of its
  twenty-seven steps. For every table whose `_type` is `buffets` it takes
  each `items[].table` and looks it up in the same document: a missing
  table gives `buffetReferencedTablesNotFound` with
  `{ buffetTable, brokenBuffet, missingItemTable }`, a table without a row
  of hash `items[].ref` gives `buffetReferencedItemsNotFound` with
  `{ buffetTable, brokenBuffet, itemTable, missingItem }`. Items that point
  at InsertHistory rows validate like any other, as long as the history
  table is in the document. A buffet row without `id` passes. A non-array
  `items` is caught earlier by `dataDoesNotMatchColumnConfig` when the
  document carries `tableCfgs` and the table points at its configuration
  through `_tableCfg`. The rljson validator does not require the referenced
  tables to carry a `_tableCfg`, only to be present with their rows.
- The validator stops at the first step that reports errors. Validating the
  raw `Io.dump()` of the store therefore only ever reports
  `tableCfgHasRootHeadSharedError` ("Tables must be either root, root+head
  or shared") for every InsertHistory table configuration, because
  `createInsertHistoryTableCfg` sets `isHead`, `isRoot` and `isShared` all
  to `false`. Patching those flags to `isShared: true` gets one step
  further, to `refsNotFound` for every InsertHistory row (`Target table
"speciesMultiEdits" not found.`, one entry per row). Leaving the
  InsertHistory configurations out of `tableCfgs` (the history tables
  themselves stay in the document) makes the full dump validate clean:
  every `personRef`, `customerRef`, `invoiceRef` and `animalRef` resolves,
  and every change set item, domain row or history row, resolves. The
  same document with one change set item pointed at a hash nobody has
  reports exactly that item under `buffetReferencedItemsNotFound`. This is
  the store integrity test in
  `packages/node-service/src/store/petShopStore.invoices.test.ts`.

## What it means for rljson users

- A `buffets` table is a first-class citizen of the format, the validator
  and `IoMem`, but not of `Db` 0.0.42. `PetShopStore.writeChangeSet` writes
  the change set and its InsertHistory row through `Core.import` with
  `validate: false`, exactly what `Db._writeInsertHistory` does internally,
  and `readChangeSets` reads through `Io.readRows`. Everything else still
  goes through `Db.insert` and `Db.get`.
- What a change set names: every row the operation wrote, domain rows
  (`invoices`, `invoiceItems`) and their InsertHistory rows alike, in write
  order (`invoices`, `invoicesInsertHistory`, `invoiceItems`,
  `invoiceItemsInsertHistory`, ...). The alternative, naming only the
  domain rows, would leave a peer that pulls the change set without the
  `timeId`, `previous` and `origin` of each write, and those history rows
  are what the "current version" rule of roadmap section 2.6 and the DAG
  branch detection of slice D11 read. Including them makes a change set
  exactly the set of rows a peer must write to reproduce the operation and
  its place in the version DAG. The change set's own history row is not
  among its items (it is written after the change set and references it);
  a peer writes its own history row for a change set it received.
- The hash of a history row written by `Db.insert` equals
  `hsh(<the row Db.insert returns>)._hash`, so the change set item for a
  history row can be computed from the return value without a second read.
- Change set hashes are not deterministic across runs or nodes: a change
  set names InsertHistory rows, and those carry `timeId`s. The invoice and
  item rows themselves are deterministic for the seed (they are built from
  the customer and animal hashes and a fixed issue date), which is why the
  seed invoices have golden-hash-like stability while their change sets do
  not.
- Invoice numbers across nodes: `invoiceNumber(issuedOn, count + 1)` is
  unique on one node only, and the invoice `id` derives from it. Two nodes
  issuing invoices at the same time (slice D9) would both produce
  `2026-0007`, and with the same customer, animals and date even the same
  row hash. Slice D3 or D9 must put the node name into the number
  (`node1-2026-0007`) or derive it from a hash before invoices are issued
  on more than one node.
- Concurrency on one node: `issueInvoice` reads the invoice count to number
  the next invoice, so concurrent calls are chained on a promise in
  `PetShopStore` (`pendingWrite`), which gives them consecutive numbers.
  Without it two overlapping calls read the same count.

## Candidates for upstream issues

- `@rljson/db` 0.0.42 has no controller for `buffets`: `Db.insert` and
  `Db.get` on a buffets table throw
  `Controller for type buffets is not implemented yet.` Reproduction:
  create a table with `type: 'buffets'` through `db.core.createTable`, then
  `db.insert(Route.fromFlat(key), { [key]: { _type: 'buffets', _data: [{ id: 'x', items: [] }] } })`.
- `createInsertHistoryTableCfg` produces a configuration
  `BaseValidator` rejects with `tableCfgHasRootHeadSharedError` (all of
  `isHead`, `isRoot`, `isShared` false), so a store dump that includes its
  own `tableCfgs` never passes the validator. Reproduction: validate
  `{ tableCfgs: hsh({ _type: 'tableCfgs', _data: [createInsertHistoryTableCfg(anyCfg)] }), ... }`.
- `Core.import` validates its payload as a self-contained document, so a
  buffet whose items point at rows already in the store cannot be imported
  with validation on unless those rows are repeated in the payload.
  Reproduction: store one components row, then
  `core.import({ buffets: { _type: 'buffets', _data: [{ items: [{ table, ref }] }] } })`
  reports `buffetReferencedTablesNotFound`.
- rljson has no `createBuffetTableCfg` next to the factories for cakes,
  layers, slice ids and trees, so every user spells the `items` column out
  by hand.
