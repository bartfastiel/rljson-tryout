# `timeId()` issues `<milliseconds>:<4 random characters>`, so writes within one millisecond have no defined order

- Package: `@rljson/rljson` 0.0.81 (`timeId`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: correctness of anything that orders versions by `timeId`

## Reproduction

```js
import { timeId } from '@rljson/rljson';

const ids = Array.from({ length: 200 }, () => timeId());
let outOfOrder = 0;
for (let index = 1; index < ids.length; index++)
  if (ids[index] < ids[index - 1]) outOfOrder++;
const millis = new Set(ids.map((id) => id.split(':')[0])).size;
console.log(
  `200 timeIds issued back to back span ${millis} distinct millisecond(s); ${outOfOrder} of them sort before their predecessor`,
);
console.log('first five:', ids.slice(0, 5).join(' '));
```

## Expected

Within one process, `timeId` order equals issue order (a monotonic
counter or a monotonic clock within the millisecond).

## Actual

```text
200 timeIds issued back to back span 1 distinct millisecond(s); 98 of them sort before their predecessor
first five: 1789709198729:zwAK 1789709198729:5j89 1789709198729:oLFL 1789709198729:xnFn 1789709198729:4-xl
```

`Db.insert` on `IoMem` takes about 0.03 ms, so two chained versions of one
entity routinely land in the same millisecond; the unique part is a
random nanoid, so "newest first" by `timeId` put an older version first
in one test out of ten once writes got fast enough
(`docs/findings/seed-generator.md`). Two `timeId`s from different nodes
are of course incomparable beyond the clock; within one node, though,
the order is knowable.

## Impact on us

`packages/domain/src/entityVersions.ts` orders versions by their depth in
the `previous` chain first and falls back to `timeId` only for tips of
equal depth.

## Workaround

Order by the DAG, not by the id.

## Suggested fix

A per-process monotonic suffix within the same millisecond (a counter
encoded in the four characters, random only for the first id of a
millisecond), or a documented statement that `timeId` carries no order
and `previous` is the only order.
