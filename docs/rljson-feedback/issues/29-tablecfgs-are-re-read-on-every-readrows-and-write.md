# `IoTools.tableCfgs()` re-reads and re-parses every table configuration on every `readRows` and `write` of `IoSqliteNode`

- Packages: `@rljson/io` 0.0.78 (`IoTools.tableCfgs`),
  `@rljson/io-sqlite-node` 1.0.7 (`rawTableCfgs` without a cache)
- Environment: Node 24.18.0 (`node:sqlite`), Windows 11 Pro (10.0.26200)
- Severity: performance (reads stay about ten times slower than `IoMem`
  regardless of pragmas)

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
const cfg = (key) => ({
  key,
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
});
const io = new IoSqliteNode();
io.dbFileName = join(
  mkdtempSync(join(tmpdir(), 'rljson-cfgs-')),
  'test.sqlite',
);
await io.init();
for (let index = 0; index < 20; index++)
  await io.createOrExtendTable({ tableCfg: cfg(`table${index}`) });
await io.write({
  data: {
    table0: { _type: 'components', _data: [{ id: 'one', name: 'One' }] },
  },
});

let calls = 0;
const original = io.rawTableCfgs.bind(io);
io.rawTableCfgs = async () => {
  calls++;
  return original();
};
const count = async (label, run) => {
  calls = 0;
  const started = performance.now();
  await run();
  console.log(
    label.padEnd(36),
    `rawTableCfgs() called ${calls} time(s), ${(performance.now() - started).toFixed(2)} ms`,
  );
};
await count('readRows(table0, where: {})', () =>
  io.readRows({ table: 'table0', where: {} }),
);
await count('readRows(table0, where: { id })', () =>
  io.readRows({ table: 'table0', where: { id: 'one' } }),
);
await count('rowCount(table0)', () => io.rowCount('table0'));
await count('write(one row into table0)', () =>
  io.write({
    data: {
      table0: { _type: 'components', _data: [{ id: 'two', name: 'Two' }] },
    },
  }),
);
await io.close();
```

## Expected

Table configurations change only through `createOrExtendTable`; one read
per instance (invalidated on schema change) is enough.

## Actual

```text
readRows(table0, where: {})          rawTableCfgs() called 2 time(s), 0.54 ms
readRows(table0, where: { id })      rawTableCfgs() called 2 time(s), 0.40 ms
rowCount(table0)                     rawTableCfgs() called 0 time(s), 0.13 ms
write(one row into table0)           rawTableCfgs() called 2 time(s), 3.36 ms
```

Every `readRows` and every `write` runs `SELECT * FROM tableCfgs_tbl`
twice (once for the existence check, once for the column check) and
parses the `columns` JSON of every configuration; with the project's 22
tables that is what keeps a `listAnimals` at 1 ms on SQLite against 0.2 ms
in memory (`docs/findings/stores.md`).

## Impact on us

Invisible behind HTTP for single reads; noticeable when a request reads
six tables.

## Suggested fix

Cache the parsed configurations in `IoTools` (or in `IoSqliteNode`) keyed
by the `tableCfgs` row count or a schema version, invalidated in
`createOrExtendTable`.
