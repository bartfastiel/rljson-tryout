import { IoMem, IoMulti } from '@rljson/io';
import type { Rljson } from '@rljson/rljson';
import { animalsTableCfg, hashed } from '@rljson-tryout/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { isRejectedByCascade } from './syncAgent.ts';

type ReadRowsRequest = Parameters<IoMem['readRows']>[0];

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const animal = hashed({
  id: 'bowser-the-guard-dog',
  name: 'Bowser',
  speciesRef: 'species-hash',
  breederRef: 'breeder-hash',
  bornOn: '2020-01-01',
  priceCents: 1000,
  backgroundStory: 'A guard dog.',
  traitsRefs: [],
});

/** The animal with its content changed after it was hashed. */
const tampered = { ...animal, name: 'Tampered' };

/**
 * A peer that serves rows whose content was changed after they were
 * hashed, the way a hostile or broken node would (slice D15).
 */
class TamperingIo extends IoMem {
  override async readRows(request: ReadRowsRequest): Promise<Rljson> {
    const rljson = await super.readRows(request);
    const table = rljson[request.table]!;
    return {
      [request.table]: {
        ...table,
        _data: table._data.map((row) => ({ ...row, name: 'Tampered' })),
      },
    } as Rljson;
  }
}

const openedIo = async <Store extends IoMem>(io: Store): Promise<Store> => {
  await io.init();
  await io.isReady();
  await io.createOrExtendTable({ tableCfg: animalsTableCfg });
  cleanups.push(() => io.close());
  return io;
};

const failureOf = (attempt: Promise<unknown>): Promise<unknown> =>
  attempt.then(
    () => undefined,
    (error: unknown) => error,
  );

/**
 * Holds the agent's reading of the library's hash rejections against the
 * pinned `@rljson/io` and `@rljson/hash`: the read cascade validates what
 * a peer served before it caches it, a store validates what it is asked
 * to write, and both failures must be the ones `isRejectedByCascade`
 * recognises, or an upgrade of either package would turn a tampered row
 * into twenty retries (`docs/findings/change-set-sync.md`).
 */
describe('the hash rejections of the library', () => {
  it('fails a cascade read of a tampered row with a message the agent recognises, and the row never lands locally', async () => {
    const local = await openedIo(new IoMem());
    const peer = await openedIo(new TamperingIo());
    await peer.write({
      data: { animals: { _type: 'components', _data: [animal] } } as Rljson,
    });
    const cascade = new IoMulti([
      { io: local, priority: 1, read: true, write: true, dump: true },
      { io: peer, priority: 2, read: true, write: false, dump: false },
    ]);
    await cascade.init();

    const failure = await failureOf(
      cascade.readRows({ table: 'animals', where: { _hash: animal._hash } }),
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(
      /^Hash "[A-Za-z0-9_-]+" is wrong\. Should be "[A-Za-z0-9_-]+"\.$/u,
    );
    expect(isRejectedByCascade(failure)).toBe(true);
    expect(await local.rowCount('animals')).toBe(0);
  });

  it('fails a write of a tampered row with a message the agent recognises', async () => {
    const local = await openedIo(new IoMem());

    const failure = await failureOf(
      local.write({
        data: {
          animals: { _type: 'components', _data: [tampered] },
        } as Rljson,
      }),
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      `Hash "${animal._hash}" does not match the newly calculated one`,
    );
    expect(isRejectedByCascade(failure)).toBe(true);
    expect(await local.rowCount('animals')).toBe(0);
  });

  it('does not mistake a peer that cannot answer for a rejection', async () => {
    const local = await openedIo(new IoMem());
    const peer = await openedIo(new IoMem());
    const cascade = new IoMulti([
      { io: local, priority: 1, read: true, write: true, dump: true },
      { io: peer, priority: 2, read: true, write: false, dump: false },
    ]);
    await cascade.init();
    await peer.close();

    const failure = await failureOf(
      cascade.readRows({ table: 'animals', where: { _hash: 'SomeHash' } }),
    );

    expect(failure).toBeInstanceOf(Error);
    expect(isRejectedByCascade(failure)).toBe(false);
    expect(isRejectedByCascade(new Error('Io "io-1" is closed'))).toBe(false);
  });
});
