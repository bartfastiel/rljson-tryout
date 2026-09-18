# `BaseValidator` does not enforce the documented head-table rules: a row without `id`, with `id: null`, or two rows with the same `id` pass

- Package: `@rljson/rljson` 0.0.81 (`BaseValidator`,
  `validateRljsonAgainstTableCfg`, `TableCfg` documentation)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: documented rule without a check

## Reproduction

```js
import { hsh } from '@rljson/hash';
import {
  BaseValidator,
  Validate,
  validateRljsonAgainstTableCfg,
} from '@rljson/rljson';

const column = (key) => ({
  key,
  type: 'string',
  titleLong: key,
  titleShort: key,
});
const species = hsh({
  key: 'species',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
});
const validate = new Validate();
validate.addValidator(new BaseValidator());
const documentWith = (rows) => ({
  tableCfgs: hsh({ _type: 'tableCfgs', _data: [species] }),
  species: hsh({ _type: 'components', _tableCfg: species._hash, _data: rows }),
});

const withoutId = [{ name: 'Duck' }];
const nullId = [{ id: null, name: 'Duck' }];
const duplicateId = [
  { id: 'duck', name: 'Duck' },
  { id: 'duck', name: 'Mallard' },
];
console.log(
  'row without id in a head table:       ',
  JSON.stringify(await validate.run(documentWith(withoutId))),
);
console.log(
  'row with id: null in a head table:    ',
  JSON.stringify(await validate.run(documentWith(nullId))),
);
console.log(
  'two rows with the same id:            ',
  JSON.stringify(await validate.run(documentWith(duplicateId))),
);
console.log(
  'validateRljsonAgainstTableCfg(no id): ',
  JSON.stringify(validateRljsonAgainstTableCfg(withoutId, species)),
);
```

## Expected

`TableCfg.isHead` documents: "Head tables must contain an id column. Rows
in an head table must contain a non-null id. Same row ids must refer to
the same physical object." The validator has `_rootOrHeadTableHasNoIdColumn`
for the column; the row-level rules should fail too, at least the
non-null one.

## Actual

```text
row without id in a head table:        {}
row with id: null in a head table:     {}
two rows with the same id:             {}
validateRljsonAgainstTableCfg(no id):  []
```

Note that "two rows with the same id" is legitimate for two versions of
one entity, so a uniqueness check would have to be per tip (issue 23)
rather than per table; the non-null rule has no such caveat.

## Impact on us

Junction table ids (`<animalId>--<traitId>`) and entity ids are kept
unique by construction and by unit tests, not by the format.

## Suggested fix

A `headTableRowWithoutId` step in `BaseValidator`; document that `id`
uniqueness is per current version, not per table.
