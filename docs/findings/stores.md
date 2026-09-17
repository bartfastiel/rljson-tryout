# `Io` implementations: `IoMem` against `IoSqliteNode`

## What we tried

- `@rljson/io-sqlite-node` 1.0.7 next to `@rljson/io` 0.0.78 and
  `@rljson/db` 0.0.42, Node 24.18.0 (SQLite 3.53.1 through `node:sqlite`),
  while building slice C1. Read `dist/index.js` and `dist/*.d.ts` of the
  package (`IoSqliteNode`, `SqlStatements`) and `IoTools` in
  `@rljson/io/dist/io.js`.
- Put the `Io` behind `PetShopStore` (`createIo` in
  `packages/node-service/src/store/createIo.ts`, selected by `STORAGE`)
  and ran the whole store test suite and every Gherkin feature of the
  package over both implementations through `describe.each(storageKinds)`
  (`packages/node-service/src/testing/testStores.ts`), each SQLite store in
  its own file under a temporary directory per test file.
- Ran throwaway scripts against a bare `Db` over each `Io`: a table with
  every column type (`string`, `number`, `boolean`, `json`, `jsonArray`),
  rows with `null` and missing columns, quotes inside values, a `where`
  clause with a quote, a duplicate insert, a `rowCount` of an unknown
  table, a wrong type and an unknown column on write, `dump()`, and the
  InsertHistory rows `Db.insert` writes.
- Timed the seed (`seedIfEmpty`: 3 species, 8 traits, 8 persons, 4
  breeders, 5 customers, 10 animals, 19 junction rows, 6 invoices with
  their items and change sets, 220 rows over 20 tables with the history
  rows), twenty `listAnimals` and `getAnimal` reads, and ten
  `issueInvoice` calls per store, median of three runs on the Windows
  development machine, with SQLite in its default configuration and with
  the pragmas below.
- Opened, closed and reopened the same file (`initialize`, `seedIfEmpty`),
  called `init()` twice on one instance, restarted the container of the
  image with `docker restart` and killed it with `SIGKILL` between two
  invoices.

## What happened

Shape of the library:

- `new IoSqliteNode()` takes no arguments. The setter `dbFileName` decides
  where the database lives: an absolute path is used as is, a relative
  name lands under `./data/<name>` of the process working directory
  (roadmap section 3.5), and leaving it unset opens `:memory:`.
  `createIo` passes `<DATA_DIR>/petshop.sqlite`. `init()` creates the
  parent directory (`mkdirSync` recursive), opens the file, creates the
  `tableCfgs` table (`CREATE TABLE IF NOT EXISTS`) and inserts its own
  configuration row with `INSERT OR IGNORE`, then creates the `revisions`
  table through `IoTools`; `isReady()` resolves right after. `close()`
  closes the `DatabaseSync` and tolerates a second call.
- Table creation is idempotent across restarts: `createOrExtendTable`
  looks the key up in `tableCfgs`, creates the SQL table with
  `CREATE TABLE IF NOT EXISTS <key>_tbl` when it is new and otherwise
  compares the column count with the stored configuration and returns
  when nothing was added, so `PetShopStore.initialize()` runs unchanged
  on a file that already holds every table, and `seedIfEmpty()` finds the
  rows and seeds nothing (the restart test in
  `petShopStore.sqlite.test.ts`, the Docker restart below).
- Every table and column carries a suffix in SQL (`animals_tbl`,
  `_hash_col`, `id_col`) through `IoDbNameMapping` of `@rljson/io`, with
  `_hash_col TEXT PRIMARY KEY NOT NULL`. Types map as `string`, `json`,
  `jsonArray` and `jsonValue` to `TEXT`, `number` to `REAL`, `boolean` to
  `INTEGER`; objects and arrays are `JSON.stringify`ed on write and parsed
  on read, booleans become `1`/`0` and come back as booleans.
- `write` hashes the payload, checks the tables and the column types
  (`IoTools.throwWhenTableDataDoesNotMatchCfg`, the same check `IoMem`
  runs), then runs one `BEGIN` ... `COMMIT` around
  `INSERT OR IGNORE` statements, one per row. A duplicate row is ignored,
  a failed row rolls the whole write back.
- `readRows` builds its `WHERE` clause by string concatenation: a string
  value is wrapped in single quotes without escaping.

Differences observed between the two stores:

| Aspect                                                                                            | `IoMem`                                                          | `IoSqliteNode`                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row order of `readRows` and `Db.get`                                                              | sorted by `_hash`                                                | sorted by `_hash` (same `IoTools.sortTableDataAndUpdateHash`)                                                                                                               |
| Key order inside a row                                                                            | as written, `_hash` last                                         | `_hash` first, then column order of the `TableCfg`                                                                                                                          |
| A `null` or missing column                                                                        | key absent on read (the hash drops it)                           | key absent on read (`_parseData` skips `NULL`)                                                                                                                              |
| Numbers                                                                                           | as written                                                       | `REAL`, integers come back as integers; `2^53 + 1` loses precision in both (JavaScript, not the store)                                                                      |
| Booleans, `json`, `jsonArray`                                                                     | as written                                                       | identical after the round trip, nested `_hash` values included                                                                                                              |
| Strings with quotes, backslashes, newlines, tabs, non-ASCII, astral characters, 4 000+ characters | as written                                                       | byte for byte identical (`petShopStore.sqlite.test.ts`)                                                                                                                     |
| `readRows` with a quote in a `where` value                                                        | finds the row                                                    | throws `near "Hara": syntax error`                                                                                                                                          |
| Duplicate insert                                                                                  | row count unchanged, one more history row                        | same                                                                                                                                                                        |
| Wrong type or unknown column on write                                                             | `Table data does not match the configuration.`                   | same message                                                                                                                                                                |
| `rowCount` of an unknown table                                                                    | `Table "nope" not found`                                         | same                                                                                                                                                                        |
| `dump()`                                                                                          | every table plus `tableCfgs`, `revisions`, each with `_tableCfg` | same shape                                                                                                                                                                  |
| InsertHistory rows through `Db`                                                                   | `timeId`, `<table>Ref`, `route`, `origin`, `previous`, `_hash`   | same fields, different key order                                                                                                                                            |
| `init()` twice on one instance                                                                    | harmless                                                         | opens a second connection and leaks the first; the file stays locked after `close()`                                                                                        |
| Removing the file right after `close()`                                                           | not applicable                                                   | worked at once on Windows in every run; the library's own `deleteDatabase` still waits 800 ms and retries five times, so the tests remove with `maxRetries` as a safety net |

Every store method, every Gherkin scenario and the rljson validator over
the full dump (`petShopStore.invoices.test.ts`, "store integrity") behave
identically over both stores; `petShopStore.sqlite.test.ts` also compares
every list and every animal detail of a seeded SQLite store with a seeded
in-memory store and finds them `toStrictEqual`.

Timings (median of three runs, Windows 11, NVMe, Node 24.18.0):

| Store                                             | Seed (220 rows) | `listAnimals` | `getAnimal` | `issueInvoice` (3 rows plus history and change set) |
| ------------------------------------------------- | --------------: | ------------: | ----------: | --------------------------------------------------: |
| `IoMem`                                           |           33 ms |        0.2 ms |      0.1 ms |                                              0.7 ms |
| `IoSqliteNode`, library defaults                  |          698 ms |        2.3 ms |      2.3 ms |                                             28.4 ms |
| `IoSqliteNode`, `synchronous = NORMAL`            |          545 ms |        2.1 ms |      2.0 ms |                                             22.8 ms |
| `IoSqliteNode`, `journal_mode = WAL` and `NORMAL` |           49 ms |        1.0 ms |      1.0 ms |                                              2.9 ms |
| `IoSqliteNode`, `synchronous = OFF`               |          206 ms |        1.9 ms |      1.9 ms |                                              9.7 ms |

- The library opens the database with SQLite's defaults, `journal_mode =
delete` and `synchronous = FULL` (2). Since `Db.insert` is one `write`
  per row and `write` is one transaction, every row costs a rollback
  journal file and two `fsync`s, which is where the 698 ms go: the seed
  is about 130 transactions.
- `createIo` therefore returns `WriteAheadLogSqliteIo`, a subclass whose
  `init()` runs `PRAGMA journal_mode = WAL` and `PRAGMA synchronous =
NORMAL` after the library has opened the file. The journal mode is
  stored in the file and survives reopening; `synchronous` is per
  connection and is set on every start. Committed transactions remain
  durable across a crash of the process; a power loss can lose the last
  ones. The store test suite over SQLite went from 45 s to 4 s with it.
- Reads stay about ten times slower than `IoMem` in every configuration:
  every `readRows`, `write` and `rowCount` first calls
  `IoTools.tableCfgs()`, which runs `SELECT * FROM tableCfgs_tbl` and
  parses the `columns` JSON of every table configuration (22 rows here)
  before touching the data table. One millisecond per read is invisible
  behind HTTP; a large seed (slice C5) will feel the per-row transactions
  more than the reads.
- The file holds 245 760 bytes after the seed plus ten invoices; the WAL
  file next to it (`petshop.sqlite-wal`, plus `-shm`) grows until SQLite
  checkpoints at 1 000 pages or the last connection closes.

In the container and in Kubernetes:

- `node:sqlite` loads on `node:24-alpine` without a flag and without a
  warning; the image is unchanged apart from the bundle
  (`docs/findings/versions.md`). `docker run -e STORAGE=sqlite -v
<directory>:/data` with the image creates `/data/petshop.sqlite` owned by
  `node` (uid 1000), the invoice issued before `docker restart` is listed
  after it, the seed reports zeroes on the second start, and an invoice
  issued right before `docker kill -s KILL` is there after `docker start`.
- Production node1 is a `StatefulSet` with one replica and a 2 Gi
  `local-path` claim mounted at `/data` (`STORAGE=sqlite`,
  `DATA_DIR=/data`); previews keep the `Deployment` over an `emptyDir`.
  The claim also holds `identity/<domain>/node-id`, so the node id of a
  sqlite node survives a restart and a redeploy, which is what slice D7
  needs to observe for the hub's treatment of a returning identity; a
  memory node keeps getting a fresh id with its fresh `emptyDir`.

## What it means for rljson users

- Pass an absolute `dbFileName`, create the directory yourself if you
  want a clear error, and call `init()` exactly once per instance; open a
  new instance to reopen a file.
- Set `journal_mode = WAL` and `synchronous = NORMAL` on the connection
  the library opens (`io.db` is public) unless you need every single row
  to survive a power loss; with the defaults, importing data through
  `Db.insert` costs two `fsync`s per row.
- Do not pass user input into `readRows({ where })` on SQLite: a value
  with a single quote breaks the query, and a crafted one runs SQL. This
  project only reads with an empty `where` or by `_hash` (hashes are
  URL-safe base64, no quotes). `Db.get` by `_hash` is safe for the same
  reason.
- Byte-for-byte fidelity is not a concern for either store: long strings,
  nested JSON and arrays of hashes round-trip exactly, and the row hash
  recomputed from what SQLite returns equals the stored one, which is the
  check a peer will run on pulled rows (slice D15).
- Do not compare rows with `JSON.stringify`; key order differs between
  the stores. Compare structurally or by hash.
- Give the `Io` to your store from outside. `PetShopStore` never knows
  which one it has; `describe.each` over a factory keeps every test
  honest for both.

## Candidates for upstream issues

- `IoSqliteNode._whereString` interpolates `where` values into SQL
  without escaping. Reproduction: write a row with `text: "O'Hara"`, then
  `io.readRows({ table, where: { text: "O'Hara" } })` throws
  `near "Hara": syntax error`; a value like `x' OR '1'='1` returns every
  row.
- `IoSqliteNode.init()` opens a new `DatabaseSync` on every call without
  closing the previous one. Reproduction: `await io.init(); await io.init();
await io.close();` then try to delete the file on Windows (`EPERM`), or
  check the process's open handles on Linux.
- `IoSqliteNode` opens the database with `journal_mode = delete` and
  `synchronous = FULL` and commits every `write` as its own transaction,
  so `Db.insert` costs two `fsync`s per row (698 ms for 220 rows here
  against 49 ms in WAL mode). A constructor option or a documented
  recommendation for WAL would help every user.
- `IoTools.tableCfgs()` reads and parses every table configuration on
  every `readRows`, `write` and `rowCount`, and `IoSqliteNode.rawTableCfgs()`
  has no cache behind it. Reproduction: wrap `io.rawTableCfgs` in a
  counting function, call `readRows` once; the counter reads 2 (one for
  the existence check, one for the column check).
- `IoSqliteNode.deleteDatabase` sleeps 800 ms unconditionally before the
  first `unlink`, on every platform. A retry loop without the fixed sleep
  would keep test suites fast.
