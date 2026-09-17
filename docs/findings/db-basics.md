# `Db` over `IoMem`: tables, insert, get, validation

## What we tried

- `@rljson/db` 0.0.42, `@rljson/io` 0.0.78, `@rljson/rljson` 0.0.81,
  `@rljson/hash` 0.0.19, Node 24.18.0, while building slice B1.
- Read the `.d.ts` files and READMEs under `node_modules/@rljson/*` and the
  bundled `db/dist/db.js` (`Db.insert`, `Db._insert`,
  `Db._writeInsertHistory`, `ComponentController.insert`, `Core.import`).
- Ran throwaway scripts against a real `Db(new IoMem())` with a `species`
  components table (`_hash`, `id`, `name`, `latinName`, `description`, all
  `string`, `isHead` and `isRoot` true): created tables, inserted one and
  three rows per call, inserted the same row twice, inserted without
  `_type`, read by `_hash`, by `id`, by route `species@<hash>` and with an
  empty `where`, called `getInsertHistory` and `detectDagBranch`, and ran
  `Validate` with `BaseValidator` over good and broken documents.

## What happened

Table creation:

- `new IoMem()` needs `await io.init()` (and `await io.isReady()`) before
  `new Db(io)` is used. `close()` only flips a flag.
- `db.core.createTable(cfg)` calls `io.createOrExtendTable`;
  `db.core.createTableWithInsertHistory(cfg)` does the same for `cfg` and
  for `createInsertHistoryTableCfg(cfg)`. After creating `species` the dump
  holds `tableCfgs`, `revisions`, `species` and `speciesInsertHistory`.
- `createInsertHistoryTableCfg` for `species` produces the columns `_hash`,
  `timeId`, `speciesRef`, `route`, `origin`, `previous` (`jsonArray`) and
  `clientTimestamp` (`number`), with `isHead`, `isRoot`, `isShared` all
  false. The `speciesRef` column carries
  `ref: { tableKey: 'speciesMultiEdits', type: 'components' }`, a table that
  does not exist; nothing complained about it in this slice.
- `ColumnCfg` requires `titleLong` and `titleShort` (plain strings) in the
  type; `throwOnInvalidTableCfg` accepts the configuration above.

Insert:

- `db.insert(Route.fromFlat('species'), { species: { _type: 'components', _data: [row] } })`
  strips incoming hashes (`rmhsh`), writes each row through
  `core.import({ species: { _data: [row] } })` and returns one
  `InsertHistoryRow` per row:
  `{ speciesRef: <row hash>, route: '/species', origin: 'db.insert', timeId: '<ms>:<4 chars>', previous: [] }`.
- The InsertHistory table receives only `insertHistoryRow[0]`: a call with
  three rows in `_data` returns three rows but writes one history row. One
  `insert` per row gives one history row per row, which is what B1 does.
- Rows are content addressed. Inserting an identical row again leaves the
  table at the same row count but appends another InsertHistory row.
- Without `_type` the call throws
  `Cannot read properties of undefined (reading '_hash')` (no branch of
  `_insert` matches, so the history write gets `undefined`) and writes
  nothing.
- `IoMem` validates on write: a `number` in a `string` column or a column
  that is not in the configuration throws
  `Table data does not match the configuration.` and no history row is
  written.
- Each independent insert has `previous: []`, so after seeding three species
  `db.detectDagBranch('species')` returns a `dagBranch` conflict with three
  tips. The DAG is per table, not per `id`; tips only chain when a route
  like `species@<previous hash>` is used, which sets `previous` to the time
  ids of that hash.

Get:

- `db.get(route, {})` returns a `Container` whose `rljson.species._data`
  holds every row, sorted by `_hash` (the `IoMem` keeps rows hash sorted),
  plus `tree` and `cell` views.
- `db.get(route, { _hash })` and `db.get(route, { id })` filter on a column
  value; any column works the same way. An unknown value gives
  `{ species: { _data: [], _type: 'components' } }`, not an error.
- `db.get(Route.fromFlat('species@<hash>'), {})` returns that one row too.
- Rows come back with their `_hash`, and `hsh(rmhsh(row))._hash` equals it,
  so hashes computed in `domain` before insert are the hashes served after.

Validation:

- `new Validate()` plus `addValidator(new BaseValidator())`; `run(document)`
  resolves to `{}` when nothing is wrong and to
  `{ base: { hasErrors: true, <check>: {...} } }` otherwise.
- A tampered row `_hash` gives `hashesNotValid`.
- Column types are only checked when the document contains a `tableCfgs`
  table and the data table points at it with `_tableCfg: <cfg hash>`.
  Then a `number` in a `string` column gives `dataDoesNotMatchColumnConfig`
  with `brokenValues: [{ table, row, column, tableCfg }]`, an unknown column
  gives `columnConfigNotFound`. Without `tableCfgs` the same document
  validates clean.
- A row without `id` in a head table passes the validator.
- The `Rljson` type has an index signature of table types, so a document
  hashed as a whole (top-level `_hash: string`) does not type check as
  `Rljson`; hash the tables individually instead.
- `hsh` throws when an object already carries a `_hash` that does not match
  its content (`throwOnWrongHashes` defaults to true). Remove hashes with
  `rmhsh` before altering a hashed row.

## What it means for rljson users

- Create every table with its InsertHistory companion before the first
  insert, and insert one logical row per `Db.insert` call if you want every
  row to have a history entry.
- Make seeding idempotent by checking `io.rowCount(table)` first; the store
  dedupes rows but not history.
- Keep the table configuration next to the data when validating outside a
  store; the store validates types on write anyway.
- Expect `detectDagBranch` to report a branch as soon as a table holds two
  independent entities. Slices B9 and D11 must decide whether "current
  version" is computed per `id` from the history rather than per table.

## Joining a reference

- `@rljson/db` 0.0.42, while building slice B3. Wrote `animals` with a
  `speciesRef` column (`ref: { tableKey: 'species', type: 'components' }`,
  see the "reference column" note below) next to the existing `species`
  table and tried `db.get` with a route that appends the reference's table
  key as a second segment.
- `Route.fromFlat('animals@<animal hash>/species')` resolves one animal's
  species: `container.rljson` holds both `animals` (the one matching row)
  and `species` (the one row `speciesRef` points at). `container.cell`
  carries the resolved species row plus the exact path
  (`['animals', '_data', 0, 'speciesRef', '_data', 0]`) into the original
  tree, which is the shape a single-entity detail endpoint wants.
- `Route.fromFlat('animals/species')`, the same route without a hash,
  resolves every reference at once: `container.rljson.animals._data` holds
  every animal row and `container.rljson.species._data` holds the
  deduplicated set of every species row any animal points at, in one
  `Db.get` call.
- When the referencing table is empty, `species` is missing from
  `container.rljson` entirely rather than present with an empty `_data`;
  code that reads the joined table must treat "table absent" and "table
  empty" the same.
- The unhashed route join silently drops a row whose reference does not
  resolve: with one valid animal and one animal whose `speciesRef` is a
  hash no species has, `Route.fromFlat('animals/species')` returns only the
  valid animal in `container.rljson.animals._data` (`_data.length` is 1,
  not 2); the broken row is not reported, not `null`, just absent. Good for
  "give me every animal that has a species", wrong for "give me every
  animal, tell me if its species is missing" or for surfacing a dangling
  reference to an operator instead of hiding it. `PetShopStore.listAnimals`
  needs the second contract (a caller must see the animal to know its
  species is missing), so it does not use the join: it fetches `animals`
  and `species` with two plain `Db.get` calls and joins them with a local
  `Map` from `species._hash` to the species row, which includes every
  animal row regardless of whether its reference resolves. This is the
  "fall back to an explicit lookup by hash" case roadmap section 3.2
  anticipated.
- The `ref` on a reference column names the _content type_ of the target
  table (`ContentType`, e.g. `'components'`), not the _JSON type_ of the
  column's own value. The column itself stays `type: 'string'` (it holds a
  hash) and carries `ref: { tableKey: 'species', type: 'components' }`
  additionally; `createInsertHistoryTableCfg` in section "What happened"
  above does exactly this for its own `<table>Ref` column.
- The `BaseValidator` step `_refsNotFound` (not `Db`, not `IoMem`) is what
  actually checks a reference: it walks every table that carries a
  `_tableCfg`, looks up each `ref` column's `tableKey` in the _same_
  document, and reports `refsNotFound` when the target table is missing
  from the document or does not contain a row whose `_hash` equals the
  reference value. The target table needs no `_tableCfg` of its own for
  this check; it only has to be present with its rows. Neither `Db.insert`
  nor `IoMem`'s write-time type check (see "What happened" above) rejects a
  dangling reference; only running `Validate` catches it.

## Candidates for upstream issues

- `Db.insert` returns one `InsertHistoryRow` per inserted row but persists
  only the first one. Reproduction: insert `_data` with two rows, then
  `getInsertHistory(table)` has one row.
- `createInsertHistoryTableCfg(cfg)` sets the `<table>Ref` column's
  `ref.tableKey` to `<table>MultiEdits` instead of `<table>`.
  Reproduction: `createInsertHistoryTableCfg({ key: 'species', ... }).columns[2].ref`.
- `Db.insert` without `_type` fails with a `TypeError` about `_hash`
  instead of a message naming the missing `_type`.
- `BaseValidator` does not enforce "rows in a head table must contain a
  non-null id" although `TableCfg` documents the rule.
- The unhashed route join (`Route.fromFlat('<table>/<refTable>')`) silently
  omits a source row whose reference column does not resolve, instead of
  including it with a missing target or reporting it; a caller that needs
  every source row (for example to display a broken reference rather than
  hide it) cannot tell "no such row" from "one row was dropped because its
  reference is broken" without a separate unfiltered read of the source
  table. Reproduction: two `animals` rows, one with a valid `speciesRef`
  and one with a hash no `species` row has;
  `Route.fromFlat('animals/species')` returns only the valid row in
  `container.rljson.animals._data`.
