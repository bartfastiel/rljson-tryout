# `hsh` and `hip` are typed to return `T`, so `hsh(row)._hash` does not compile although the package exports `Hashed<T>`

- Package: `@rljson/hash` 0.0.19 (`Hash.apply`, `Hash.applyInPlace`)
- Environment: TypeScript 6.0.3, Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: ergonomics (every caller casts)

## Reproduction

`repro.ts`:

```ts
import { hsh, type Hashed } from '@rljson/hash';
const hashed = hsh({ a: 1 });
console.log(hashed._hash);
const typed = hsh({ a: 1 }) as Hashed<{ a: number }>;
console.log(typed._hash);
```

```sh
tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck repro.ts
```

## Expected

Compiles: the runtime value carries `_hash`, and the package exports the
type that says so.

## Actual

```text
repro.ts(3,20): error TS2339: Property '_hash' does not exist on type '{ a: number; }'.
```

`apply` and `applyInPlace` are declared `<T extends Json>(json: T,
applyConfig?: ApplyConfig) => T`. The cast on line 4 compiles, which is
what every call site in the project does through one helper
(`hashed<T>(value): Hashed<T>` in `packages/domain/src/hashing.ts`).

## Suggested fix

Declare the return type as `Hashed<T>` (or `T & { _hash: string }`) on
`apply`, `applyInPlace`, `hsh` and `hip`.
