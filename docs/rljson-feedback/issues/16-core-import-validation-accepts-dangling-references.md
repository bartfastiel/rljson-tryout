# `Core.import` with validation on accepts dangling references but rejects a buffet whose targets are already in the store

- Package: `@rljson/db` 0.0.42 (`Core.import`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: misleading option (the one check a user expects from
  `validate` is the one that is skipped; the one that fires is about rows
  the store already has)

## Reproduction

```js
import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route } from '@rljson/rljson';

const column = (key, extra = {}) => ({
  key,
  type: 'string',
  titleLong: key,
  titleShort: key,
  ...extra,
});
const species = {
  key: 'species',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
};
const animals = {
  key: 'animals',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    column('_hash'),
    column('id'),
    column('speciesRef', { ref: { tableKey: 'species', type: 'components' } }),
  ],
};
const changeSets = {
  key: 'changeSets',
  type: 'buffets',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    column('_hash'),
    column('id'),
    {
      key: 'items',
      type: 'jsonArray',
      titleLong: 'items',
      titleShort: 'items',
    },
  ],
};

const io = new IoMem();
await io.init();
const db = new Db(io);
for (const cfg of [species, animals, changeSets])
  await db.core.createTableWithInsertHistory(cfg);
const [{ speciesRef }] = await db.insert(Route.fromFlat('species'), {
  species: { _type: 'components', _data: [{ id: 'duck', name: 'Duck' }] },
});

const attempt = async (label, payload) => {
  try {
    await db.core.import(payload);
    console.log(label, '-> accepted');
  } catch (error) {
    console.log(label, '-> rejected:', error.message.split('\n')[0]);
  }
};
await attempt('animals row with a dangling speciesRef, validate on   ', {
  animals: {
    _type: 'components',
    _data: [{ id: 'ghost', speciesRef: 'NoSuchSpecies0000000000' }],
  },
});
await attempt('change set naming a species row the store holds       ', {
  changeSets: {
    _type: 'buffets',
    _data: [{ id: 'c1', items: [{ table: 'species', ref: speciesRef }] }],
  },
});
await attempt('same change set with the species row in the payload   ', {
  species: { _type: 'components', _data: [{ id: 'duck', name: 'Duck' }] },
  changeSets: {
    _type: 'buffets',
    _data: [{ id: 'c1', items: [{ table: 'species', ref: speciesRef }] }],
  },
});
console.log('animals rows now in the store:', await io.rowCount('animals'));
```

## Expected

Validation against the store: a dangling `speciesRef` is rejected, a
buffet whose items name rows the store holds is accepted.

## Actual

```text
animals row with a dangling speciesRef, validate on    -> accepted
change set naming a species row the store holds        -> rejected: The imported rljson data is not valid:
same change set with the species row in the payload    -> accepted
animals rows now in the store: 1
```

The rejection detail is `buffetReferencedTablesNotFound` with
`missingItemTable: "species"`. `Core.import` validates the payload as a
self-contained document and then ignores `refsNotFound` and
`layerBasesNotFound` (`db.js`, `import`: it throws only when the result has
errors other than those two). So a dangling reference passes, which also
means the per-row validation inside `ComponentController.insert` never
rejects one, while a buffet item pointing at a stored row fails because
the target table is not in the payload. Importing 2 000 generated animals
whose `speciesRef`, `breederRef` and `traitsRefs` pointed nowhere
succeeded with validation on (`docs/findings/seed-generator.md`).

## Impact on us

Change sets are imported with `validate: false` (the rows they name were
written a moment earlier); reference integrity is checked by running
`BaseValidator` over a dump in tests, not on write.

## Workaround

`validate: false` plus own checks; `BaseValidator` over the whole store in
tests.

## Suggested fix

Validate against the union of payload and store for reference and buffet
checks (a `readRowsByHashes` per referenced table is enough), and make the
exception list explicit in the option's documentation otherwise.
