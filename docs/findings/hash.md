# `@rljson/hash`

## What we tried

- `@rljson/hash` 0.0.19, `@rljson/json` 0.0.23, TypeScript 6.0.3, Node 24.18.0.
- Wrote `hashed<T extends Json>(value: T): T { return hsh(value); }` in
  `packages/domain/src/hashing.ts` and ran `tsc --noEmit` on it.
- Called `hsh({ a: 1 })` and `hip({ a: 1 })` (objects with no pre-existing
  `_hash` property) directly with `node --experimental-strip-types`.
- Ran the golden-hash calculation for `{ a: 1 }` once with
  `hsh({ a: 1 })._hash` to obtain the value asserted in
  `packages/domain/src/hashing.test.ts`.

## What happened

- `tsc --noEmit` compiled the naive `hashed<T>(value) { return hsh(value); }` cleanly, but a caller reading `hashed({ a: 1 })._hash` failed with `error TS2339: Property '_hash' does not exist on type '{ a: number; }'.` The `Hash` class declares both `apply` and `applyInPlace` (bound to the exports `hsh` and `hip`) with the generic signature `<T extends Json>(json: T, applyConfig?: ApplyConfig) => T`, returning `T` unchanged, even though the package separately exports a `Hashed<T extends Json>` type that adds `_hash` and matches what the value actually carries at runtime.
- `hsh({ a: 1 })` and `hip({ a: 1 })` both ran without error and produced an
  object with a freshly computed `_hash`; no pre-existing `_hash` property
  was required on the input.
- `hashed({ a: 1 })._hash` evaluated to `AVq9f1zFei3ZS3WQ8ErYCE`, matching
  the value the library's own `src/example.ts` computes for
  `{ a: 1, _hash: 'invalid' }` under `throwOnWrongHashes: false` (the
  invalid stated hash is discarded and recomputed from content), which we
  take as independent confirmation the hash is deterministic on content
  alone.

## What it means for rljson users

- Do not rely on `hsh`'s or `hip`'s declared return type to see `_hash`;
  cast the result to the library's own `Hashed<T>` type to get an accurate
  type, for example:

  ```ts
  import { hsh, type Hashed } from '@rljson/hash';
  import type { Json } from '@rljson/json';

  export const hashed = <T extends Json>(value: T): Hashed<T> =>
    hsh(value) as Hashed<T>;
  ```

- Objects do not need a pre-existing `_hash` field before calling `hsh` or
  `hip`; one is added automatically. The library's own example always
  seeds `_hash: ''` up front, which reads as a stylistic convention
  (matching the `Json`/`Hashed` shape ahead of time), not a requirement.

## Candidates for upstream issues

- `apply`/`applyInPlace` on the `Hash` class (and therefore the exported
  `hsh`/`hip`) are typed to return `T` instead of `Hashed<T>`, even though
  the library exports a `Hashed<T>` type that matches their actual runtime
  result. Reproduction: `const h: { a: number } = hsh({ a: 1 }); h._hash;`
  fails to compile with TS2339 under `@rljson/hash` 0.0.19, even though
  `h._hash` exists at runtime.
