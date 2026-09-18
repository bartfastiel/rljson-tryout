# `IoMem` re-hashes the whole store on the next `dumpTable` after any write; `Db.getInsertHistory` inherits the cost

- Packages: `@rljson/io` 0.0.78 (`IoMem._refreshHashes`,
  `_updateGlobalHash`), `@rljson/db` 0.0.42 (`Db.getInsertHistory` reads
  through `Core.dumpTable`), `@rljson/hash` 0.0.19 (`hip` defaults)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: performance (about 100 ms per `dumpTable` of a 5-row table in
  a store of 40 000 rows; 230 ms per call in a store of 25 000 domain rows
  plus history)

## Reproduction

```js
import { IoMem } from '@rljson/io';

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
  columns: [column('_hash'), column('id'), column('text')],
});

const io = new IoMem();
await io.init();
await io.createOrExtendTable({ tableCfg: cfg('big') });
await io.createOrExtendTable({ tableCfg: cfg('tiny') });
const rows = Array.from({ length: 40_000 }, (_, index) => ({
  id: `row-${index}`,
  text: 'x'.repeat(200),
}));
await io.write({ data: { big: { _type: 'components', _data: rows } } });
await io.write({
  data: { tiny: { _type: 'components', _data: [{ id: 'one', text: 'one' }] } },
});

const time = async (label, run) => {
  const started = performance.now();
  await run();
  console.log(label.padEnd(56), (performance.now() - started).toFixed(1), 'ms');
};
await time('dumpTable(tiny), first call after the bulk writes', () =>
  io.dumpTable({ table: 'tiny' }),
);
await time('dumpTable(tiny), again, nothing written since', () =>
  io.dumpTable({ table: 'tiny' }),
);
for (const id of ['two', 'three', 'four']) {
  await time(`write one row into tiny (${id})`, () =>
    io.write({
      data: { tiny: { _type: 'components', _data: [{ id, text: id }] } },
    }),
  );
  await time('dumpTable(tiny) after that one-row write', () =>
    io.dumpTable({ table: 'tiny' }),
  );
}
await io.write({
  data: {
    tiny: { _type: 'components', _data: [{ id: 'five', text: 'five' }] },
  },
});
await time('readRows(tiny, where: {}) after a one-row write', () =>
  io.readRows({ table: 'tiny', where: {} }),
);
```

## Expected

Dumping a five-row table costs what five rows cost, independent of the
other tables in the store.

## Actual

```text
dumpTable(tiny), first call after the bulk writes        116.3 ms
dumpTable(tiny), again, nothing written since            0.0 ms
write one row into tiny (two)                            0.1 ms
dumpTable(tiny) after that one-row write                 103.9 ms
write one row into tiny (three)                          0.1 ms
dumpTable(tiny) after that one-row write                 94.9 ms
write one row into tiny (four)                           0.1 ms
dumpTable(tiny) after that one-row write                 100.6 ms
readRows(tiny, where: {}) after a one-row write          0.2 ms
```

`_refreshHashes` re-hashes only the dirty tables (with `throwOnWrongHashes:
false`), but then calls `_updateGlobalHash`, which runs
`hip(this._mem, { updateExistingHashes: false })` with the default
`throwOnWrongHashes: true`; that validates the existing hash of every row
of every table, which means hashing them all again. Replacing that one
call shows the cause:

```js
io._updateGlobalHash = function () {
  this._mem._hash = '';
  hip(this._mem, { updateExistingHashes: false, throwOnWrongHashes: false });
};
```

```text
as shipped: dumpTable(tiny) after a one-row write                95.2 ms
with throwOnWrongHashes: false in _updateGlobalHash: dumpTable(tiny) after a one-row write 0.0 ms
```

`Db.getInsertHistory` reads through `Core.dumpTable`, so every list that
read a history table after a write paid this; a profile of an edit on the
`large` seed (24 759 domain rows plus history) put 86 percent of 453 ms
under `IoMem._updateGlobalHash` (`docs/findings/seed-generator.md`).

## Impact on us

`updateAnimal` went from 453 ms to 16 ms and `listInvoices` from 497 ms to
22 ms once history rows were read through `Io.readRows` instead of
`Db.getInsertHistory`.

## Workaround

Never call `dump` or `dumpTable` on a hot path of a store that is written
to; read history tables with `io.readRows({ table, where: {} })`.

## Suggested fix

`_updateGlobalHash` with `throwOnWrongHashes: false` (the store wrote
those hashes itself), or compute the global hash from the table hashes
instead of walking the rows, and let `Db.getInsertHistory` read through
`Core.readRows`.
