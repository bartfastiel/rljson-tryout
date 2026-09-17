import { describe, expect, it } from 'vitest';

import {
  compareTimeIdsNewestFirst,
  currentRows,
  currentVersions,
  referenceColumnOf,
  versionsOf,
  type VersionHistoryRow,
} from './entityVersions.ts';
import { hashed } from './hashing.ts';

type Row = { _hash: string; id: string; priceCents: number };

const row = (id: string, priceCents: number): Row => hashed({ id, priceCents });

/**
 * A history row the way `Db.insert` writes one for the `animals` table:
 * `animalsRef` names the row, `previous` the `timeId`s it supersedes.
 */
const history = (
  animal: Row,
  timeId: string,
  previous: string[] = [],
): VersionHistoryRow => ({
  timeId,
  animalsRef: animal._hash,
  route: '/animals',
  origin: 'db.insert',
  previous,
});

describe('referenceColumnOf', () => {
  it('derives the reference column name the same way createInsertHistoryTableCfg does', () => {
    expect(referenceColumnOf('animals')).toBe('animalsRef');
    expect(referenceColumnOf('species')).toBe('speciesRef');
  });
});

describe('compareTimeIdsNewestFirst', () => {
  it('orders by timestamp, newest first', () => {
    expect(compareTimeIdsNewestFirst('200:aaaa', '100:zzzz')).toBeLessThan(0);
    expect(compareTimeIdsNewestFirst('100:zzzz', '200:aaaa')).toBeGreaterThan(
      0,
    );
  });

  it('breaks a timestamp tie by the unique part so the order is total', () => {
    expect(compareTimeIdsNewestFirst('100:bbbb', '100:aaaa')).toBeLessThan(0);
    expect(compareTimeIdsNewestFirst('100:aaaa', '100:aaaa')).toBe(0);
  });

  it('breaks the tie by code points, not by locale collation', () => {
    expect(compareTimeIdsNewestFirst('100:Zaaa', '100:abbb')).toBeGreaterThan(
      0,
    );
    expect(compareTimeIdsNewestFirst('100:_aaa', '100:-aaa')).toBeLessThan(0);
    expect(compareTimeIdsNewestFirst('100:a', '100:-')).toBeLessThan(0);
  });

  it('sorts a list newest first', () => {
    const sorted = ['100:aaaa', '300:aaaa', '200:aaaa', '200:bbbb'].sort(
      compareTimeIdsNewestFirst,
    );

    expect(sorted).toStrictEqual([
      '300:aaaa',
      '200:bbbb',
      '200:aaaa',
      '100:aaaa',
    ]);
  });
});

describe('currentVersions', () => {
  it('treats every independently inserted entity as current', () => {
    const donald = row('donald', 100);
    const daisy = row('daisy', 200);

    const result = currentVersions(
      [donald, daisy],
      [history(donald, '1:aaaa'), history(daisy, '2:aaaa')],
      'animals',
    );

    expect([...result.currentById.entries()]).toStrictEqual([
      ['donald', donald],
      ['daisy', daisy],
    ]);
    expect(result.conflictingIds.size).toBe(0);
  });

  it('follows previous to the tip of a chain, regardless of timestamps', () => {
    const first = row('donald', 100);
    const second = row('donald', 200);
    const third = row('donald', 300);

    const result = currentVersions(
      [third, first, second],
      [
        history(third, '3:aaaa', ['9:aaaa']),
        history(first, '1:aaaa'),
        history(second, '9:aaaa', ['1:aaaa']),
      ],
      'animals',
    );

    expect(result.currentById.get('donald')).toStrictEqual(third);
    expect(result.conflictingIds.size).toBe(0);
  });

  it('reports an entity with two tips as conflicting and picks the newest tip as current', () => {
    const base = row('donald', 100);
    const left = row('donald', 200);
    const right = row('donald', 300);

    const result = currentVersions(
      [base, left, right],
      [
        history(base, '1:aaaa'),
        history(left, '3:aaaa', ['1:aaaa']),
        history(right, '2:aaaa', ['1:aaaa']),
      ],
      'animals',
    );

    expect(result.conflictingIds).toStrictEqual(new Set(['donald']));
    expect(result.currentById.get('donald')).toStrictEqual(left);
  });

  it('closes a branch with a merge version whose previous names both tips', () => {
    const base = row('donald', 100);
    const left = row('donald', 200);
    const right = row('donald', 300);
    const merged = row('donald', 250);

    const result = currentVersions(
      [base, left, right, merged],
      [
        history(base, '1:aaaa'),
        history(left, '2:aaaa', ['1:aaaa']),
        history(right, '3:aaaa', ['1:aaaa']),
        history(merged, '4:aaaa', ['2:aaaa', '3:aaaa']),
      ],
      'animals',
    );

    expect(result.conflictingIds.size).toBe(0);
    expect(result.currentById.get('donald')).toStrictEqual(merged);
  });

  it('counts a row written twice as two versions of the same content', () => {
    const original = row('donald', 100);
    const changed = row('donald', 200);

    const result = currentVersions(
      [original, changed],
      [
        history(original, '1:aaaa'),
        history(changed, '2:aaaa', ['1:aaaa']),
        history(original, '3:aaaa', ['2:aaaa']),
      ],
      'animals',
    );

    expect(result.currentById.get('donald')).toStrictEqual(original);
    expect(result.conflictingIds.size).toBe(0);
  });

  it('ignores a history row whose reference matches no row', () => {
    const donald = row('donald', 100);

    const result = currentVersions(
      [donald],
      [history(donald, '1:aaaa'), { timeId: '2:aaaa', animalsRef: 'gone' }],
      'animals',
    );

    expect([...result.currentById.keys()]).toStrictEqual(['donald']);
  });

  it('lists no version for a row no history row references', () => {
    const donald = row('donald', 100);
    const orphan = row('orphan', 100);

    const result = currentVersions(
      [donald, orphan],
      [history(donald, '1:aaaa')],
      'animals',
    );

    expect([...result.currentById.keys()]).toStrictEqual(['donald']);
  });

  it('keeps an entity whose history forms a cycle, with its newest version current', () => {
    const first = row('donald', 100);
    const second = row('donald', 200);

    const result = currentVersions(
      [first, second],
      [
        history(first, '1:aaaa', ['2:aaaa']),
        history(second, '2:aaaa', ['1:aaaa']),
      ],
      'animals',
    );

    expect(result.currentById.get('donald')).toStrictEqual(second);
    expect(result.conflictingIds.size).toBe(0);
    expect(
      versionsOf(
        [first, second],
        [
          history(first, '1:aaaa', ['2:aaaa']),
          history(second, '2:aaaa', ['1:aaaa']),
        ],
        'animals',
        'donald',
      ).map((version) => version.current),
    ).toStrictEqual([true, false]);
  });

  it('treats a history row without previous as a tip', () => {
    const donald = row('donald', 100);

    const result = currentVersions(
      [donald],
      [{ timeId: '1:aaaa', animalsRef: donald._hash }],
      'animals',
    );

    expect(result.currentById.get('donald')).toStrictEqual(donald);
  });
});

describe('currentRows', () => {
  it('returns the current rows ordered by id', () => {
    const daisy = row('daisy', 100);
    const donaldOld = row('donald', 100);
    const donaldNew = row('donald', 200);

    const rows = currentRows(
      [donaldNew, daisy, donaldOld],
      [
        history(donaldOld, '1:aaaa'),
        history(daisy, '2:aaaa'),
        history(donaldNew, '3:aaaa', ['1:aaaa']),
      ],
      'animals',
    );

    expect(rows).toStrictEqual([daisy, donaldNew]);
  });
});

describe('versionsOf', () => {
  it('lists every version of one entity newest first with only the tip current', () => {
    const first = row('donald', 100);
    const second = row('donald', 200);
    const third = row('donald', 300);
    const daisy = row('daisy', 50);

    const versions = versionsOf(
      [first, second, third, daisy],
      [
        history(first, '1:aaaa'),
        history(daisy, '2:aaaa'),
        history(second, '3:aaaa', ['1:aaaa']),
        history(third, '4:aaaa', ['3:aaaa']),
      ],
      'animals',
      'donald',
    );

    expect(versions).toStrictEqual([
      { row: third, timeId: '4:aaaa', previous: ['3:aaaa'], current: true },
      { row: second, timeId: '3:aaaa', previous: ['1:aaaa'], current: false },
      { row: first, timeId: '1:aaaa', previous: [], current: false },
    ]);
  });

  it('flags both tips of a branch as current', () => {
    const base = row('donald', 100);
    const left = row('donald', 200);
    const right = row('donald', 300);

    const versions = versionsOf(
      [base, left, right],
      [
        history(base, '1:aaaa'),
        history(left, '2:aaaa', ['1:aaaa']),
        history(right, '3:aaaa', ['1:aaaa']),
      ],
      'animals',
      'donald',
    );

    expect(versions.map((version) => version.current)).toStrictEqual([
      true,
      true,
      false,
    ]);
  });

  it('returns an empty list for an unknown id', () => {
    const donald = row('donald', 100);

    expect(
      versionsOf([donald], [history(donald, '1:aaaa')], 'animals', 'daisy'),
    ).toStrictEqual([]);
  });

  it('copies previous so a caller cannot alter the history row', () => {
    const donald = row('donald', 100);
    const historyRow = history(donald, '2:aaaa', ['1:aaaa']);

    const [version] = versionsOf([donald], [historyRow], 'animals', 'donald');
    version!.previous.push('tampered');

    expect(historyRow.previous).toStrictEqual(['1:aaaa']);
  });
});

/**
 * The measurement `docs/findings/entity-versions.md` reports: 1 000
 * entities with 10 versions each, 10 000 history rows in one chain per
 * entity. The bound is generous so the test never flakes on a slow CI
 * runner; the finding records the actual numbers.
 */
describe('at 10 000 history rows', () => {
  const entities = 1000;
  const versionsPerEntity = 10;
  const rows: Row[] = [];
  const historyRows: VersionHistoryRow[] = [];
  let timestamp = 1;
  for (let entity = 0; entity < entities; entity += 1) {
    let previous: string[] = [];
    for (let version = 0; version < versionsPerEntity; version += 1) {
      const current = row(`animal-${entity}`, version);
      const timeId = `${timestamp}:aaaa`;
      timestamp += 1;
      rows.push(current);
      historyRows.push(history(current, timeId, previous));
      previous = [timeId];
    }
  }

  it('resolves the current version of every entity in well under a second', () => {
    const started = performance.now();
    const result = currentVersions(rows, historyRows, 'animals');
    const elapsed = performance.now() - started;

    expect(result.currentById.size).toBe(entities);
    expect(result.conflictingIds.size).toBe(0);
    expect(result.currentById.get('animal-0')?.priceCents).toBe(
      versionsPerEntity - 1,
    );
    expect(elapsed).toBeLessThan(1000);
  });

  it('lists the versions of one entity in well under a second', () => {
    const started = performance.now();
    const versions = versionsOf(rows, historyRows, 'animals', 'animal-999');
    const elapsed = performance.now() - started;

    expect(versions).toHaveLength(versionsPerEntity);
    expect(versions[0]!.current).toBe(true);
    expect(versions.slice(1).every((version) => !version.current)).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
