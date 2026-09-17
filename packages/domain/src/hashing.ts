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

/**
 * Whether a hashed value's `_hash` is the hash of its content: the hash
 * is recomputed over a copy with every nested hash renewed too, so that a
 * changed element of a list (an item of a change set) shows up in the
 * value's own hash, and compared with the hash the value carries. This is
 * the check a node runs on every row another node served before it
 * writes the row (roadmap slices D3 and D15); a value that cannot be
 * hashed at all does not match either.
 */
export const hashMatches = (
  value: Readonly<{ _hash: string } & Record<string, unknown>>,
): boolean => {
  try {
    return (
      hsh(value as unknown as Json, {
        updateExistingHashes: true,
        throwOnWrongHashes: false,
      })._hash === value._hash
    );
  } catch {
    return false;
  }
};
