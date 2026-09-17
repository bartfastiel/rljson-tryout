import { hsh, type Hashed } from '@rljson/hash';
import type { Json } from '@rljson/json';

/**
 * Returns a hashed copy of the given value. The input itself is left
 * unchanged; every object in the returned copy carries a deterministic
 * `_hash` property derived from its content. `hsh` is typed as `T => T`
 * upstream even though it adds `_hash`, so the result is cast to the
 * library's own `Hashed<T>` type to reflect what it actually returns.
 */
export const hashed = <T extends Json>(value: T): Hashed<T> =>
  hsh(value) as Hashed<T>;
