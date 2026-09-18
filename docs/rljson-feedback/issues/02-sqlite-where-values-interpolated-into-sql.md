# `IoSqliteNode.readRows` interpolates `where` values into SQL without escaping

- Package: `@rljson/io-sqlite-node` 1.0.7 (`_whereString`)
- Environment: Node 24.18.0 (`node:sqlite`, SQLite 3.53.1), Windows 11 Pro
  (10.0.26200); the same on `node:24-alpine`
- Severity: security (SQL injection), correctness (values with a quote
  cannot be queried)

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
const persons = {
  key: 'persons',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
};

const io = new IoSqliteNode();
io.dbFileName = join(
  mkdtempSync(join(tmpdir(), 'rljson-where-')),
  'test.sqlite',
);
await io.init();
await io.createOrExtendTable({ tableCfg: persons });
await io.write({
  data: {
    persons: {
      _type: 'components',
      _data: [
        { id: 'scrooge', name: 'Scrooge McDuck' },
        { id: 'ohara', name: "Maureen O'Hara" },
      ],
    },
  },
});

const read = async (where) => {
  try {
    const result = await io.readRows({ table: 'persons', where });
    return `${result.persons._data.length} row(s): ${result.persons._data.map((row) => row.id).join(', ')}`;
  } catch (error) {
    return `threw: ${error.message}`;
  }
};
console.log(
  'where { name: "Scrooge McDuck" }   ->',
  await read({ name: 'Scrooge McDuck' }),
);
console.log(
  'where { name: "Maureen O\'Hara" }   ->',
  await read({ name: "Maureen O'Hara" }),
);
console.log(
  "where { id: \"x' OR '1'='1\" }        ->",
  await read({ id: "x' OR '1'='1" }),
);
await io.close();
```

## Expected

The second read finds one row, the third finds none. `IoMem` behaves that
way for the same calls.

## Actual

```text
where { name: "Scrooge McDuck" }   -> 1 row(s): scrooge
where { name: "Maureen O'Hara" }   -> threw: near "Hara": syntax error
where { id: "x' OR '1'='1" }        -> 2 row(s): scrooge, ohara
```

`_whereString` builds `` `${column} = '${value}' AND ` `` by string
concatenation (`dist/index.js`, line 548 of 1.0.7). Through the hub
transport a `where` arrives from other nodes as it was sent (issue 01), so
on a SQLite node the clause is reachable from the network.

## Impact on us

Every value that may enter a `where` is checked against
`/^[A-Za-z0-9_-]+$/` before the call (`isSafeWhereValue` in
`packages/node-service/src/store/petShopStore.ts`); a search by name is
done in JavaScript over a whole-table read instead of a `where`. Nothing in
the project can search a `string` column through the store on SQLite.

## Workaround

Only hashes, `timeId`s and slug ids ever reach a `where`; everything else
is filtered in memory.

## Suggested fix

Bind parameters: build `column = ? AND ...` and pass the values to
`prepare(query).all(...values)`; `node:sqlite` supports positional and
named parameters. `Db.get` by `_hash` is safe today only because hashes
contain no quotes.
