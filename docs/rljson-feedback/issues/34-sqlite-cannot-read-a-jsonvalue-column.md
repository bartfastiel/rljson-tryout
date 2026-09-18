# `IoSqliteNode` creates a `jsonValue` column but throws `Unsupported column type jsonValue` when reading it back

- Package: `@rljson/io-sqlite-node` 1.0.7 (`SqlStatements.jsonToSqlType`,
  `_parseData`); `@rljson/io-mssql` 0.0.30 has the same gap by reading
  (`parseData` has no `jsonValue` case and drops the value silently)
- Environment: Node 24.18.0 (`node:sqlite`), Windows 11 Pro (10.0.26200)
- Severity: a column type of the format that one store cannot serve

## Reproduction

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IoMem } from '@rljson/io';
import { IoSqliteNode } from '@rljson/io-sqlite-node';

const column = (key, type) => ({ key, type, titleLong: key, titleShort: key });
const anything = {
  key: 'anything',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    column('_hash', 'string'),
    column('id', 'string'),
    column('v', 'jsonValue'),
  ],
};
const sqlite = new IoSqliteNode();
sqlite.dbFileName = join(
  mkdtempSync(join(tmpdir(), 'rljson-jsonvalue-')),
  'test.sqlite',
);
for (const [label, io] of [
  ['IoMem       ', new IoMem()],
  ['IoSqliteNode', sqlite],
]) {
  await io.init();
  await io.createOrExtendTable({ tableCfg: anything });
  for (const v of [42, 'text', true, { a: 1 }, [1, 2]]) {
    try {
      await io.write({
        data: {
          anything: {
            _type: 'components',
            _data: [{ id: JSON.stringify(v), v }],
          },
        },
      });
      const read = await io.readRows({
        table: 'anything',
        where: { id: JSON.stringify(v) },
      });
      console.log(
        label,
        JSON.stringify(v).padEnd(8),
        '-> read back',
        JSON.stringify(read.anything._data[0]?.v),
      );
    } catch (error) {
      console.log(
        label,
        JSON.stringify(v).padEnd(8),
        '-> throws:',
        error.message.split('\n')[0],
      );
    }
  }
}
```

## Expected

`jsonValue` is one of the six types `@rljson/json` 0.0.23 declares
(`jsonValueTypes`), `IoMem` supports it, and `jsonToSqlType` maps it to
`TEXT`; reading the column back should return the value.

## Actual

```text
IoMem        42       -> read back 42
IoMem        "text"   -> read back "text"
IoMem        true     -> read back true
IoMem        {"a":1}  -> read back {"a":1,"_hash":"AVq9f1zFei3ZS3WQ8ErYCE"}
IoMem        [1,2]    -> read back [1,2]
IoSqliteNode 42       -> throws: Unsupported column type jsonValue
IoSqliteNode "text"   -> throws: Unsupported column type jsonValue
IoSqliteNode true     -> throws: Unsupported column type jsonValue
IoSqliteNode {"a":1}  -> throws: Unsupported column type jsonValue
IoSqliteNode [1,2]    -> throws: Unsupported column type jsonValue
```

`_parseData` switches on `boolean`, `jsonArray`, `json`, `string` and
`number` and throws in the `default` branch; `_serializeRow` writes the
value (objects as JSON text, everything else as is), so the column fills
and can never be read. `_serializeRow` also cannot tell a stored string
`"[1,2]"` from a stored array on the way back, which a `jsonValue` column
would need.

## Impact on us

None; the project declares no `jsonValue` column. Found while mapping
the type system (`docs/rljson-feedback/data-types.md`).

## Suggested fix

Store `jsonValue` as JSON text always (`JSON.stringify` on write,
`JSON.parse` on read, so `"text"` becomes `"\"text\""` in the column and
round-trips), in both `io-sqlite-node` and `io-mssql`, or drop the type
from `jsonValueTypes` if it is not meant for columns.
