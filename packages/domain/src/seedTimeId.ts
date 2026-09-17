/**
 * The `timeId`s of the seed's InsertHistory rows. rljson issues a `timeId`
 * as `<milliseconds since epoch>:<4 random characters>` at write time,
 * which makes the history rows, and with them the change sets that name
 * them, differ between two nodes that seed the same rows. Once nodes
 * exchange change sets, two history rows for one seed entity would look
 * like two tips of its version DAG, a conflict where none exists
 * (`docs/findings/change-set-sync.md`). The seed therefore issues its own
 * `timeId`s: the same fixed epoch plus a counter on every node, with a
 * constant unique part that still satisfies rljson's `isTimeId` (four
 * characters after the colon), so that every node seeding the same size
 * writes identical history rows and identical change sets, and a seed
 * change set received from another node is a no-op by hash.
 */

/**
 * The moment the seed's history begins: the first day of the year the
 * hand-written invoices are dated in, well before any edit a node makes at
 * runtime, so that a version written through the API always carries a
 * newer `timeId` than the seed version it supersedes.
 */
export const seedEpochMilliseconds = Date.parse('2026-01-01T00:00:00.000Z');

/**
 * The constant unique part of every seed `timeId`. Four characters, as
 * rljson's `isTimeId` demands; it also marks a history row as seeded in
 * any table dump.
 */
export const seedTimeIdSuffix = 'seed';

/**
 * The `timeId` of the `sequence`-th history row the seed writes, counting
 * from zero: one millisecond after the previous one, so that the ids stay
 * distinct and ordered by write order.
 */
export const seedTimeId = (sequence: number): string => {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RangeError(
      `A seed timeId sequence must be a whole number of at least 0, got ${sequence}.`,
    );
  }
  return `${seedEpochMilliseconds + sequence}:${seedTimeIdSuffix}`;
};

/**
 * Whether a `timeId` was issued by the seed rather than at runtime.
 */
export const isSeedTimeId = (timeId: string): boolean =>
  timeId.endsWith(`:${seedTimeIdSuffix}`);

/**
 * Hands out the seed's `timeId`s in write order, starting at
 * `seedTimeId(0)`. One clock per seeding run; a store that seeds the same
 * size on every node runs through the same sequence.
 */
export type SeedClock = {
  next: () => string;
};

export const createSeedClock = (): SeedClock => {
  let sequence = 0;
  return {
    next: () => {
      const timeId = seedTimeId(sequence);
      sequence += 1;
      return timeId;
    },
  };
};
