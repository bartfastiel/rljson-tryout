import { IoMem, IoMulti } from '@rljson/io';
import { hashed, speciesTableCfg } from '@rljson-tryout/domain';
import { describe, expect, it } from 'vitest';

import { BorrowedIo } from './borrowedIo.ts';

const duck = hashed({
  id: 'duck',
  name: 'Duck',
  latinName: 'Anas',
  description: 'quack',
});

const openMemory = async (): Promise<IoMem> => {
  const io = new IoMem();
  await io.init();
  await io.isReady();
  return io;
};

describe('BorrowedIo', () => {
  it('delegates everything but close to the lent store', async () => {
    const owned = await openMemory();
    const borrowed = new BorrowedIo(owned);

    await borrowed.createOrExtendTable({ tableCfg: speciesTableCfg });
    await borrowed.write({
      data: { species: { _type: 'components', _data: [duck] } },
    });

    expect(borrowed.isOpen).toBe(true);
    await borrowed.isReady();
    expect(await borrowed.tableExists('species')).toBe(true);
    expect(await borrowed.contentType({ table: 'species' })).toBe('components');
    expect((await borrowed.rawTableCfgs()).map((cfg) => cfg.key)).toContain(
      'species',
    );
    expect(await borrowed.rowCount('species')).toBe(1);
    expect(await owned.rowCount('species')).toBe(1);
    expect(
      (
        await borrowed.readRows({
          table: 'species',
          where: { _hash: duck._hash },
        })
      ).species._data,
    ).toHaveLength(1);
    expect(
      (await borrowed.dumpTable({ table: 'species' })).species._data,
    ).toHaveLength(1);
    expect(Object.keys(await borrowed.dump())).toContain('species');
  });

  it('keeps the lent store open when a multi over it is closed', async () => {
    const owned = await openMemory();
    const multi = new IoMulti([
      {
        io: new BorrowedIo(owned),
        priority: 1,
        read: true,
        write: true,
        dump: true,
      },
    ]);
    await multi.init();

    await multi.close();

    expect(multi.isOpen).toBe(false);
    expect(owned.isOpen).toBe(true);
  });

  it('lets the owner initialize through it and still close the real store', async () => {
    const owned = new IoMem();
    const borrowed = new BorrowedIo(owned);

    await borrowed.init();
    expect(owned.isOpen).toBe(true);
    await borrowed.close();
    expect(owned.isOpen).toBe(true);
    await owned.close();
    expect(borrowed.isOpen).toBe(false);
  });
});
