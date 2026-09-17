# `@rljson/hash`

## `apply`/`hsh` and `applyInPlace`/`hip` are typed as `T => T`, not `T => Hashed<T>`

`@rljson/hash` exports a type `Hashed<T extends Json>` that adds a `_hash`
field to every object in `T`, and that is genuinely what `hsh(value)` and
`hip(value)` return at runtime. Their declared signatures on the `Hash`
class are nevertheless `apply<T extends Json>(json: T, applyConfig?:
ApplyConfig): T` and `applyInPlace<T extends Json>(json: T, applyConfig?:
ApplyConfig): T`, so TypeScript does not know the result carries `_hash`.
Code that reads `_hash` off a hashed value has to cast the result to
`Hashed<T>` itself, for example:

```ts
import { hsh, type Hashed } from '@rljson/hash';
import type { Json } from '@rljson/json';

export const hashed = <T extends Json>(value: T): Hashed<T> =>
  hsh(value) as Hashed<T>;
```

Confirmed with `@rljson/hash` 0.0.19.

## Objects do not need a pre-existing `_hash` field

`hsh({ a: 1 })` and `hip({ a: 1 })` both work on plain objects without an
existing `_hash` property; one is added automatically. The official
example (`src/example.ts` in the `rljson/hash` repository) always seeds
`_hash: ''` up front, which reads as a stylistic convention (matching the
`Json`/`Hashed` shape ahead of time), not a requirement.

## Golden hash for `{ a: 1 }`

`hashed({ a: 1 })._hash` is `AVq9f1zFei3ZS3WQ8ErYCE` with `@rljson/hash`
0.0.19. Used as the golden value in
`packages/domain/src/hashing.test.ts`.
