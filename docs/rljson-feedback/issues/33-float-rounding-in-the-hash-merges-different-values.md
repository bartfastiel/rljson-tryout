# `@rljson/hash` rounds non-integers before hashing, so two rows with different `number` values can share a hash and the second one is silently dropped by the store

- Packages: `@rljson/hash` 0.0.19 (`floatRep`), `@rljson/io` 0.0.78
  (`IoMem._write` deduplicates by hash), `@rljson/io-sqlite-node` 1.0.7
  (`INSERT OR IGNORE` on `_hash`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: silent data loss for `number` values with more significant
  digits than the rounding tier keeps; undocumented

## Reproduction

```js
import { floatRep, hsh } from '@rljson/hash';
import { IoMem } from '@rljson/io';

const column = (key, type) => ({ key, type, titleLong: key, titleShort: key });
const readings = {
  key: 'readings',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    column('_hash', 'string'),
    column('id', 'string'),
    column('value', 'number'),
  ],
};

for (const value of [0.1 + 0.2, 0.3, 1234567.891, 1234567.894, 1e14 + 0.5]) {
  try {
    console.log(String(value).padEnd(20), 'floatRep ->', floatRep(value));
  } catch (error) {
    console.log(String(value).padEnd(20), 'floatRep ->', error.message);
  }
}
console.log(
  'hash {value: 1234567.891} === hash {value: 1234567.894}:',
  hsh({ value: 1234567.891 })._hash === hsh({ value: 1234567.894 })._hash,
);

const io = new IoMem();
await io.init();
await io.createOrExtendTable({ tableCfg: readings });
await io.write({
  data: {
    readings: { _type: 'components', _data: [{ id: 'a', value: 1234567.891 }] },
  },
});
await io.write({
  data: {
    readings: { _type: 'components', _data: [{ id: 'a', value: 1234567.894 }] },
  },
});
const rows = (await io.readRows({ table: 'readings', where: {} })).readings
  ._data;
console.log(
  'rows after writing .891 and .894:',
  rows.length,
  '- stored value:',
  rows[0].value,
);
```

## Expected

Either every distinct JavaScript `number` has a distinct canonical form
(the JSON text, as `JSON.stringify` produces it), or the rounding is a
documented, visible property of the `number` type with an error or a
warning when a value carries more digits than the tier keeps.

## Actual

```text
0.30000000000000004  floatRep -> 30000000p8
0.3                  floatRep -> 30000000p8
1234567.891          floatRep -> 123456789p2
1234567.894          floatRep -> 123456789p2
100000000000000.5    floatRep -> Float value 100000000000000.5 must be between -90071992547410 and 90071992547409.
hash {value: 1234567.891} === hash {value: 1234567.894}: true
rows after writing .891 and .894: 1 - stored value: 1234567.891
```

`floatRep` (`dist/hash.js`) prints integers with `toString()` and rounds
a non-integer to 8 decimal places below 10, 7 below 100, 6 below 1 000,
5 below 10 000, 4 below 100 000, 3 below 1 000 000 and 2 from there on;
non-integers beyond ±90 071 992 547 409 throw. The intent (a hash that
survives representation noise such as `0.1 + 0.2`) is sound, but the
tiers are coarse enough to merge real values: `1234567.891` and
`1234567.894` are one row in every store, the second write is a no-op,
`Db.insert` still returns and records a history row for it, and a peer
serving one value for the other's hash passes the cascade's hash check.
`HashConfig` exposes `hashLength` and `hashAlgorithm` only; the tiers are
not configurable, and neither the public README nor the `TableCfg`
documentation mentions them. The same behaviour holds on
`IoSqliteNode` (`INSERT OR IGNORE` keyed by `_hash`).

## Impact on us

None in this project: prices are integer cents, coordinates are not stored, and
`clientTimestamp`s are integer milliseconds. It rules out storing
measured floats above 1 000 000 with more than two decimals, and below
that anything past the tier, without scaling them to integers first
(`docs/rljson-feedback/data-types.md`).

## Workaround

Integers in the smallest unit; decimals as strings in a `string` column.

## Suggested fix

Use the JSON text of the number (`JSON.stringify` is deterministic for a
given double, and `0.1 + 0.2` is then a different value, which is the
truth) or make the tiers explicit: an `integer` type that skips
`floatRep`, a `number` with a declared precision, and a thrown error when
a value has more digits than the tier keeps. Document whichever applies
next to `hsh`.
