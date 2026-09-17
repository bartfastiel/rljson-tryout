import { describe, expect, it } from 'vitest';

import { isSeedSize, seedPlans, seedSizes } from './seedSizes.ts';

describe('seedSizes', () => {
  it('lists the four sizes of roadmap section 2.4 in growing order', () => {
    expect(seedSizes).toStrictEqual(['none', 'small', 'medium', 'large']);
  });

  it('recognises a size and rejects anything else', () => {
    for (const size of seedSizes) {
      expect(isSeedSize(size)).toBe(true);
    }
    expect(isSeedSize('huge')).toBe(false);
    expect(isSeedSize('')).toBe(false);
  });

  it('keeps the hand-written seed in every size but none, and generates only for medium and large', () => {
    expect(seedPlans.none).toStrictEqual({
      handWritten: false,
      generated: null,
    });
    expect(seedPlans.small).toStrictEqual({
      handWritten: true,
      generated: null,
    });
    expect(seedPlans.medium.handWritten).toBe(true);
    expect(seedPlans.large.handWritten).toBe(true);
    expect(seedPlans.large.generated).toMatchObject({
      species: 50,
      traits: 40,
      animals: 2000,
      customers: 300,
      breeders: 50,
      invoices: 5000,
      invoiceItems: 12000,
    });
  });

  it('asks for fewer rows of every kind in medium than in large', () => {
    const medium = seedPlans.medium.generated!;
    const large = seedPlans.large.generated!;

    for (const key of Object.keys(medium) as (keyof typeof medium)[]) {
      expect(medium[key]).toBeGreaterThan(0);
      expect(medium[key]).toBeLessThan(large[key]);
    }
  });
});
