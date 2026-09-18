# `createInsertHistoryTableCfg` produces a configuration `BaseValidator` rejects, and its `<table>Ref` column points at `<table>MultiEdits`

- Package: `@rljson/rljson` 0.0.81 (`createInsertHistoryTableCfg`,
  `BaseValidator._tableCfgHasRootHeadSharedError`, `_refsNotFound`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: a store dump that includes its own `tableCfgs` can never pass
  the validator

## Reproduction

```js
import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import {
  BaseValidator,
  Route,
  Validate,
  createInsertHistoryTableCfg,
} from '@rljson/rljson';

const column = (key) => ({
  key,
  type: 'string',
  titleLong: key,
  titleShort: key,
});
const species = {
  key: 'species',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
};

const history = createInsertHistoryTableCfg(species);
console.log('flags of the derived config:', {
  isHead: history.isHead,
  isRoot: history.isRoot,
  isShared: history.isShared,
});
console.log(
  'speciesRef column ref:',
  JSON.stringify(history.columns.find((c) => c.key === 'speciesRef').ref),
);

const io = new IoMem();
await io.init();
const db = new Db(io);
await db.core.createTableWithInsertHistory(species);
await db.insert(Route.fromFlat('species'), {
  species: { _type: 'components', _data: [{ id: 'duck', name: 'Duck' }] },
});

const validate = new Validate();
validate.addValidator(new BaseValidator());
console.log(JSON.stringify(await validate.run(await io.dump()), null, 2));
```

## Expected

The dump of a store that only ever used the library's own factories
validates clean: the derived configuration carries a consistent flag set
(`isShared: true` fits a history table best) and its reference column
points at the table it references (`species`).

## Actual

```text
flags of the derived config: { isHead: false, isRoot: false, isShared: false }
speciesRef column ref: {"tableKey":"speciesMultiEdits","type":"components"}
{
  "base": {
    "hasErrors": true,
    "tableCfgHasRootHeadSharedError": {
      "error": "Table configs have inconsistent root/head/shared settings",
      "tables": [
        {
          "error": "Tables must be either root, root+head or shared",
          "table": "speciesInsertHistory",
          "tableCfg": "KBjjKubES6JWAPEUTGzAqY"
        }
      ]
    }
  }
}
```

The validator stops at the first failing step, so this is all a full dump
ever reports. Patching the flag to `isShared: true` (creating the derived
configuration by hand with `db.core.createTable`) gets one step further:

```text
"refsNotFound": {
  "error": "Broken references",
  "missingRefs": [
    {
      "error": "Target table \"speciesMultiEdits\" not found.",
      "sourceTable": "speciesInsertHistory",
      "sourceKey": "speciesRef",
      "sourceItemHash": "4GbI7IbtRWzSZzLydVt4if",
      "targetItemHash": "2oW5VA_HZnUeUFkgjgvEVy",
      "targetTable": "speciesMultiEdits"
    }
  ]
}
```

`speciesRef` holds the hash of a `species` row, but the configuration says
it references `speciesMultiEdits`, a table that does not exist in a store
that never used multi edits.

## Impact on us

The store integrity test cannot validate `io.dump()` as is; it validates a
document with the InsertHistory configurations removed from `tableCfgs`
while the history tables themselves stay in
(`packages/node-service/src/store/petShopStore.invoices.test.ts`). The
reference check therefore never covers `<table>Ref` of history rows.

## Workaround

Validate a copy of the dump without the derived configurations.

## Suggested fix

`createInsertHistoryTableCfg` sets `isShared: true` and
`ref.tableKey = cfg.key`; or the validator learns that `insertHistory`
tables are exempt from the root/head/shared rule.
