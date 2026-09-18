# `Db.insert` through `table@<reference>` does not check the reference: a nonexistent `timeId` lands in `previous` verbatim, a nonexistent hash gives `previous: []`, and a hash names every history row of that content

- Package: `@rljson/db` 0.0.42 (`Db._insert`, `getTimeIdsForRef`),
  `@rljson/rljson` 0.0.81 (`Route.fromFlat`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: correctness of the version DAG (a mistyped reference silently
  starts a new, unchained version or closes a branch by accident)

## Reproduction

```js
import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route } from '@rljson/rljson';

const column = (key) => ({
  key,
  type: 'string',
  titleLong: key,
  titleShort: key,
});
const animals = {
  key: 'animals',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
};
const io = new IoMem();
await io.init();
const db = new Db(io);
await db.core.createTableWithInsertHistory(animals);
const insert = (route, name) =>
  db.insert(Route.fromFlat(route), {
    animals: { _type: 'components', _data: [{ id: 'bowser', name }] },
  });

const [first] = await insert('animals', 'Bowser');
console.log(
  'first version:                  ',
  JSON.stringify({ timeId: first.timeId, previous: first.previous }),
);
const [chained] = await insert(`animals@${first.timeId}`, 'Bowser II');
console.log(
  'chained by real timeId:         ',
  JSON.stringify({ route: chained.route, previous: chained.previous }),
);
const [ghostTimeId] = await insert('animals@1234567890123:zzzz', 'Bowser III');
console.log(
  'chained by nonexistent timeId:  ',
  JSON.stringify({ route: ghostTimeId.route, previous: ghostTimeId.previous }),
);
const [ghostHash] = await insert(
  'animals@NoSuchRowHash0000000000',
  'Bowser IV',
);
console.log(
  'chained by nonexistent row hash:',
  JSON.stringify({ route: ghostHash.route, previous: ghostHash.previous }),
);
console.log(
  'Route.fromFlat("animals@a:b").segment(0) keys:  ',
  Object.keys(Route.fromFlat('animals@a:b').segment(0)),
);
console.log(
  'Route.fromFlat("animals@a:b:c").segment(0) keys:',
  Object.keys(Route.fromFlat('animals@a:b:c').segment(0)),
);
```

## Expected

A reference that matches no history row and no row is an error; the two
forms (history `timeId`, row hash) are documented, and "supersede the
current version of this content" is expressible.

## Actual

```text
first version:                   {"timeId":"1789708735363:pgGG","previous":[]}
chained by real timeId:          {"route":"/animals@1789708735363:pgGG","previous":["1789708735363:pgGG"]}
chained by nonexistent timeId:   {"route":"/animals@1234567890123:zzzz","previous":["1234567890123:zzzz"]}
chained by nonexistent row hash: {"route":"/animals@NoSuchRowHash0000000000","previous":[]}
Route.fromFlat("animals@a:b").segment(0) keys:   [ 'tableKey', 'animalsInsertHistoryRef' ]
Route.fromFlat("animals@a:b:c").segment(0) keys: [ 'tableKey', 'animalsRef' ]
```

- A `timeId` nobody issued is written into `previous` as given; the
  history row then names a predecessor that does not exist.
- A hash nobody has yields `previous: []`, indistinguishable from "no
  reference": the write silently becomes a new root, a second tip.
- `Route.fromFlat` decides between the two forms by the number of `:` in
  the reference (exactly two parts means a `timeId`). Undocumented, and a
  future hash alphabet containing `:` would flip the meaning.
- The hash form sets `previous` to every `timeId` whose history row
  references that hash. After a restore-to-earlier-content edit (the same
  row hash written twice) that is two entries, so a caller who means "the
  current one" cannot say so through the hash:

```text
history rows for the hash of A: 2 (A and the restore)
previous of C, chained by hash: ["1789709198734:heU-","1789709198735:e7va"] - the tip was 1789709198735:e7va
```

## Impact on us

The edit endpoint chains by `timeId` only and resolves the current
version's `timeId` itself before every write
(`docs/findings/entity-versions.md`); a peer that sends a history row with
a forged `previous` is accepted by the store as it stands.

## Workaround

Always chain by `timeId`, read it from the history row the previous insert
returned, validate references in application code.

## Suggested fix

Reject a reference that resolves to nothing, document the `timeId`/hash
distinction (or make it explicit in the route syntax), and give the hash
form a defined meaning (the newest history row of that hash, or an error
when there is more than one).
