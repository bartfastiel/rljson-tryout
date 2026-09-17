/**
 * A small deterministic pseudo random source for the seed generator: the
 * same seed string yields the same sequence on every node and every run,
 * which is what makes the generated rows hash identically everywhere
 * (`docs/plan.md`, "Seed data"). Implemented here rather than pulled in as
 * a dependency because it is a dozen lines and the project pins what it
 * depends on deliberately.
 */
export type RandomSource = {
  /** A number in `[0, 1)`. */
  nextFraction(): number;
  /** An integer in `[0, maxExclusive)`. */
  integerBelow(maxExclusive: number): number;
  /** An integer in `[minimum, maximum]`, both inclusive. */
  integerBetween(minimum: number, maximum: number): number;
  /** One element of a non-empty list. */
  pick<Item>(items: readonly Item[]): Item;
  /** `count` distinct elements of a list, in random order. */
  sample<Item>(items: readonly Item[], count: number): Item[];
  /** `true` with the given probability. */
  chance(probability: number): boolean;
  /** A copy of the list in random order. */
  shuffle<Item>(items: readonly Item[]): Item[];
};

/**
 * FNV-1a over the UTF-16 code units of a string, so that a readable seed
 * such as `duckburg` turns into the 32-bit state the generator starts from.
 */
const seedStateOf = (seed: string): number => {
  let state = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return state >>> 0;
};

/**
 * Creates a random source seeded from a string. The sequence is
 * `mulberry32`, a 32-bit generator whose period and distribution are far
 * more than seeding a pet shop needs and whose whole state is one integer,
 * so it has no hidden dependency on the platform's `Math.random`.
 */
export const createRandomSource = (seed: string): RandomSource => {
  let state = seedStateOf(seed);

  const nextFraction = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };

  const integerBelow = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError(
        `integerBelow needs a positive integer bound, got ${maxExclusive}.`,
      );
    }
    return Math.floor(nextFraction() * maxExclusive);
  };

  const integerBetween = (minimum: number, maximum: number): number =>
    minimum + integerBelow(maximum - minimum + 1);

  const pick = <Item>(items: readonly Item[]): Item => {
    if (items.length === 0) {
      throw new RangeError('pick needs a non-empty list.');
    }
    return items[integerBelow(items.length)];
  };

  const shuffle = <Item>(items: readonly Item[]): Item[] => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = integerBelow(index + 1);
      [copy[index], copy[other]] = [copy[other], copy[index]];
    }
    return copy;
  };

  const sample = <Item>(items: readonly Item[], count: number): Item[] => {
    if (count > items.length) {
      throw new RangeError(
        `sample of ${count} needs at least ${count} items, got ${items.length}.`,
      );
    }
    return shuffle(items).slice(0, count);
  };

  const chance = (probability: number): boolean => nextFraction() < probability;

  return {
    nextFraction,
    integerBelow,
    integerBetween,
    pick,
    sample,
    chance,
    shuffle,
  };
};
