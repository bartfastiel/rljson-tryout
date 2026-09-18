# A `jsonArray` column cannot declare an element type, and the validator checks only that the value is an array

- Package: `@rljson/rljson` 0.0.81 (`ColumnCfg`,
  `BaseValidator._dataDoesNotMatchColumnConfig`), `@rljson/json` 0.0.23
  (`jsonValueMatchesType`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: schema gap (a multi-reference column is only safe because
  `_refsNotFound` happens to look every element up)

## Reproduction

```js
import { hsh } from '@rljson/hash';
import { BaseValidator, Validate } from '@rljson/rljson';

const column = (key, type = 'string') => ({
  key,
  type,
  titleLong: key,
  titleShort: key,
});
const notes = hsh({
  key: 'notes',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('tags', 'jsonArray')],
});
const validate = new Validate();
validate.addValidator(new BaseValidator());
const documentWith = (tagsValue) => ({
  tableCfgs: hsh({ _type: 'tableCfgs', _data: [notes] }),
  notes: hsh({
    _type: 'components',
    _tableCfg: notes._hash,
    _data: [{ id: 'n1', tags: tagsValue }],
  }),
});
console.log(
  'tags: "not an array"  ->',
  JSON.stringify(await validate.run(documentWith('not an array'))),
);
console.log(
  'tags: [1, "two", {}]  ->',
  JSON.stringify(await validate.run(documentWith([1, 'two', {}]))),
);
console.log(
  'tags: [null, [[]]]    ->',
  JSON.stringify(await validate.run(documentWith([null, [[]]]))),
);
```

## Expected

`ColumnCfg` offers an element type for `jsonArray` (for example
`items: JsonValueType`), and a mixed array against `items: 'string'` is
reported under `dataDoesNotMatchColumnConfig`.

## Actual

```text
tags: "not an array"  -> {"base":{"hasErrors":true,"dataDoesNotMatchColumnConfig":{"error":"Table values have wrong types","brokenValues":[{"table":"notes","row":"OTCQ3zj-zIkRukJwTre1QX","column":"tags","tableCfg":"avn4whNhKpKp28IzQmIfxA"}]}}}
tags: [1, "two", {}]  -> {}
tags: [null, [[]]]    -> {}
```

`ColumnCfg` has `key`, `type`, `titleLong`, `titleShort` and `ref`; there
is no place for an element type. For a `jsonArray` column that carries a
`ref` (a multi-reference such as `traitsRefs`), `_refsNotFound` looks
every element up as a hash, so a number or a boolean element is rejected
as a broken reference (`refsNotFound`, confirmed by the reviewer of pull
request #24), which is a useful side effect but the wrong error class. A
`jsonArray` without a `ref` accepts anything.

## Impact on us

`traitsRefs` is safe through the reference check; nothing else in the
schema uses a plain `jsonArray` for data. Element order is part of the
row hash, so the project sorts multi-references canonically before
hashing (`traitsRefsOf` in `packages/domain/src/tables/animals.ts`); that
too is something a schema could say (`ordered: false`).

## Suggested fix

`ColumnCfg.items?: JsonValueType` checked per element, and an explicit
statement in the documentation that a `ref` on a `jsonArray` column
validates each element as a reference.
