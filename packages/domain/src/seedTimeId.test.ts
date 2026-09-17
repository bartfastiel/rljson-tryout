import { isTimeId, Route } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import {
  createSeedClock,
  isSeedTimeId,
  seedEpochMilliseconds,
  seedTimeId,
} from './seedTimeId.ts';

describe('seedTimeId', () => {
  it('starts at the seed epoch and advances one millisecond per sequence', () => {
    expect(seedTimeId(0)).toBe('1767225600000:seed');
    expect(seedTimeId(1)).toBe('1767225600001:seed');
    expect(seedTimeId(4321)).toBe(`${seedEpochMilliseconds + 4321}:seed`);
  });

  it('is a timeId in the eyes of rljson and a history reference in a route', () => {
    expect(isTimeId(seedTimeId(0))).toBe(true);
    expect(
      Route.fromFlat(`animals@${seedTimeId(7)}`).segment(0)[
        'animalsInsertHistoryRef'
      ],
    ).toBe(seedTimeId(7));
  });

  it('lies before any timeId issued at runtime', () => {
    expect(seedEpochMilliseconds).toBeLessThan(Date.now());
    expect(seedEpochMilliseconds).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('rejects a sequence that is not a whole non-negative number', () => {
    expect(() => seedTimeId(-1)).toThrow(RangeError);
    expect(() => seedTimeId(1.5)).toThrow(RangeError);
  });

  it('tells a seed timeId from a runtime one', () => {
    expect(isSeedTimeId(seedTimeId(3))).toBe(true);
    expect(isSeedTimeId('1789654560429:vqqc')).toBe(false);
  });
});

describe('createSeedClock', () => {
  it('hands out the sequence from zero, and two clocks agree', () => {
    const first = createSeedClock();
    const second = createSeedClock();

    expect([first.next(), first.next(), first.next()]).toStrictEqual([
      seedTimeId(0),
      seedTimeId(1),
      seedTimeId(2),
    ]);
    expect(second.next()).toBe(seedTimeId(0));
  });
});
