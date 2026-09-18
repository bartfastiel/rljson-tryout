# `IoSqliteNode` opens with `journal_mode = delete`, `synchronous = FULL` and commits every `write` on its own: about 35 times slower than WAL for row-by-row inserts

- Package: `@rljson/io-sqlite-node` 1.0.7
- Environment: Node 24.18.0 (`node:sqlite`, SQLite 3.53.1), Windows 11 Pro
  (10.0.26200), NVMe
- Severity: performance (seeding 220 rows took 698 ms against 49 ms; the
  `large` seed 16 s in WAL mode against 1.4 s in memory)

## Reproduction

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IoSqliteNode } from '@rljson/io-sqlite-node';

const column = (key) => ({
  key,
  type: 'string',
  titleLong: key,
  titleShort: key,
});
const rows = {
  key: 'rows',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('text')],
};
const directory = mkdtempSync(join(tmpdir(), 'rljson-fsync-'));

const measure = async (label, pragmas) => {
  const io = new IoSqliteNode();
  io.dbFileName = join(directory, `${label.replaceAll(/\W/g, '-')}.sqlite`);
  await io.init();
  for (const pragma of pragmas) io.db.exec(pragma);
  await io.createOrExtendTable({ tableCfg: rows });
  const started = performance.now();
  for (let index = 0; index < 200; index++) {
    await io.write({
      data: {
        rows: {
          _type: 'components',
          _data: [{ id: `row-${index}`, text: 'x'.repeat(100) }],
        },
      },
    });
  }
  const elapsed = performance.now() - started;
  console.log(
    label.padEnd(44),
    `200 single-row writes: ${elapsed.toFixed(0)} ms (${(elapsed / 200).toFixed(2)} ms per write)`,
  );
  await io.close();
};
await measure('library defaults (delete, FULL)', []);
await measure('journal_mode = WAL, synchronous = NORMAL', [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
]);
```

## Expected

A documented choice, or a constructor option: row-by-row writes are what
`Db.insert` produces (one `Io.write` per call, issue 04), so the default
should not cost a rollback journal file and two `fsync`s per row.

## Actual

```text
library defaults (delete, FULL)              200 single-row writes: 643 ms (3.22 ms per write)
journal_mode = WAL, synchronous = NORMAL     200 single-row writes: 18 ms (0.09 ms per write)
```

`init()` opens the file with SQLite's defaults (`PRAGMA journal_mode`
reports `delete`, `PRAGMA synchronous` reports `2`); `write` runs one
`BEGIN ... COMMIT` around its `INSERT OR IGNORE` statements. Measured on
the project's seed (220 rows over 20 tables): 698 ms with the defaults,
545 ms with `synchronous = NORMAL` alone, 49 ms with WAL and NORMAL, 206
ms with `synchronous = OFF`; an invoice (3 rows plus history and change
set) 28.4 ms against 2.9 ms (`docs/findings/stores.md`). The store test
suite over SQLite went from 45 s to 4 s.

## Impact on us

Every SQLite node runs a subclass whose `init()` sets the two pragmas
after the library opened the file (`WriteAheadLogSqliteIo` in
`packages/node-service/src/store/createIo.ts`). Committed transactions stay
durable across a process crash; a power loss can lose the last ones, which
the project accepts.

## Workaround

`io.db.exec('PRAGMA journal_mode = WAL'); io.db.exec('PRAGMA synchronous =
NORMAL')` after `init()`; `io.db` is public.

## Suggested fix

A constructor or `init` option for the journal mode and synchronous level,
WAL and NORMAL as the documented recommendation for anything that writes
through `Db.insert`, or a batch API so that a seed is one transaction.
