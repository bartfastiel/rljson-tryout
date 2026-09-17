import { describe, expect, it } from 'vitest';

import { createRandomSource } from './randomSource.ts';

describe('createRandomSource', () => {
  it('yields the same sequence for the same seed', () => {
    const first = createRandomSource('duckburg');
    const second = createRandomSource('duckburg');

    const firstSequence = Array.from({ length: 20 }, () =>
      first.nextFraction(),
    );
    const secondSequence = Array.from({ length: 20 }, () =>
      second.nextFraction(),
    );

    expect(firstSequence).toStrictEqual(secondSequence);
  });

  it('yields a different sequence for a different seed', () => {
    const duckburg = createRandomSource('duckburg');
    const mouseton = createRandomSource('mouseton');

    expect(duckburg.nextFraction()).not.toBe(mouseton.nextFraction());
  });

  it('yields the golden first fractions for the default seed', () => {
    const random = createRandomSource('duckburg');

    const fractions = Array.from({ length: 3 }, () => random.nextFraction());

    for (const fraction of fractions) {
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThan(1);
    }
    expect(fractions).toMatchInlineSnapshot(`
      [
        0.6681088113691658,
        0.5407183070201427,
        0.2994450356345624,
      ]
    `);
  });

  it('keeps integers inside their bounds and reaches both ends', () => {
    const random = createRandomSource('bounds');
    const seen = new Set<number>();

    for (let round = 0; round < 500; round += 1) {
      const value = random.integerBetween(3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
      expect(random.integerBelow(2)).toBeLessThan(2);
    }

    expect([...seen].sort()).toStrictEqual([3, 4, 5, 6]);
  });

  it('rejects a bound that is not a positive integer', () => {
    const random = createRandomSource('bounds');

    expect(() => random.integerBelow(0)).toThrow(RangeError);
    expect(() => random.integerBelow(1.5)).toThrow(RangeError);
  });

  it('picks only elements of the list and rejects an empty one', () => {
    const random = createRandomSource('pick');
    const items = ['goose', 'turkey', 'pig'];

    for (let round = 0; round < 50; round += 1) {
      expect(items).toContain(random.pick(items));
    }
    expect(() => random.pick([])).toThrow(RangeError);
  });

  it('shuffles into a permutation and samples distinct elements', () => {
    const random = createRandomSource('shuffle');
    const items = [1, 2, 3, 4, 5, 6, 7, 8];

    const shuffled = random.shuffle(items);
    const sampled = random.sample(items, 3);

    expect([...shuffled].sort()).toStrictEqual(items);
    expect(items).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sampled).toHaveLength(3);
    expect(new Set(sampled).size).toBe(3);
    for (const item of sampled) {
      expect(items).toContain(item);
    }
    expect(() => random.sample(items, 9)).toThrow(RangeError);
  });

  it('answers chance with a share close to the probability', () => {
    const random = createRandomSource('chance');
    let hits = 0;

    for (let round = 0; round < 2000; round += 1) {
      if (random.chance(0.25)) {
        hits += 1;
      }
    }

    expect(hits / 2000).toBeGreaterThan(0.2);
    expect(hits / 2000).toBeLessThan(0.3);
  });
});
