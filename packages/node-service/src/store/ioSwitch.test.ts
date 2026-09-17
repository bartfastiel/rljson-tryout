import { IoMem, IoMulti } from '@rljson/io';
import { hashed, speciesTableCfg } from '@rljson-tryout/domain';
import { describe, expect, it } from 'vitest';

import { IoSwitch } from './ioSwitch.ts';

const duck = hashed({
  id: 'duck',
  name: 'Duck',
  latinName: 'Anas',
  description: 'quack',
});
const goose = hashed({
  id: 'goose',
  name: 'Goose',
  latinName: 'Anser',
  description: 'honk',
});

const openMemory = async (): Promise<IoMem> => {
  const io = new IoMem();
  await io.init();
  await io.isReady();
  await io.createOrExtendTable({ tableCfg: speciesTableCfg });
  return io;
};

const speciesOf = (rljson: Awaited<ReturnType<IoMem['readRows']>>) =>
  (rljson.species._data as { id: string }[]).map((row) => row.id).sort();

/**
 * A local store, a remote store and a cascade over both the way
 * `@rljson/server` builds one: the local layer first, read, write and
 * dump; the remote layer read-only behind it.
 */
const stores = async () => {
  const local = await openMemory();
  const remote = await openMemory();
  await remote.write({
    data: { species: { _type: 'components', _data: [duck] } },
  });
  const cascade = new IoMulti([
    { io: local, priority: 1, read: true, write: true, dump: true },
    { io: remote, priority: 2, read: true, write: false, dump: false },
  ]);
  await cascade.init();
  const io = new IoSwitch(local);
  return { local, remote, cascade, io };
};

describe('IoSwitch', () => {
  it('reads and writes the local store alone until a cascade is set', async () => {
    const { local, io } = await stores();

    await io.write({
      data: { species: { _type: 'components', _data: [goose] } },
    });

    expect(io.cascading).toBe(false);
    expect(await io.rowCount('species')).toBe(1);
    expect(await local.rowCount('species')).toBe(1);
    expect(
      speciesOf(
        await io.readRows({ table: 'species', where: { _hash: duck._hash } }),
      ),
    ).toStrictEqual([]);
  });

  it('routes a targeted read through the cascade and caches the row locally', async () => {
    const { local, cascade, io } = await stores();
    io.readThrough(() => cascade);

    const found = await io.readRows({
      table: 'species',
      where: { _hash: duck._hash },
    });

    expect(io.cascading).toBe(true);
    expect(speciesOf(found)).toStrictEqual(['duck']);
    expect(await local.rowCount('species')).toBe(1);
    expect(
      speciesOf(
        await local.readRows({ table: 'species', where: { id: 'duck' } }),
      ),
    ).toStrictEqual(['duck']);
  });

  it('answers a whole-table read from the local store even with a cascade', async () => {
    const { local, cascade, io } = await stores();
    io.readThrough(() => cascade);

    const all = await io.readRows({ table: 'species', where: {} });

    expect(speciesOf(all)).toStrictEqual([]);
    expect(await local.rowCount('species')).toBe(0);
  });

  it('writes, counts and dumps locally while a cascade is set', async () => {
    const { local, remote, cascade, io } = await stores();
    io.readThrough(() => cascade);

    await io.write({
      data: { species: { _type: 'components', _data: [goose] } },
    });

    expect(await io.rowCount('species')).toBe(1);
    expect(await remote.rowCount('species')).toBe(1);
    expect(
      speciesOf(await local.dumpTable({ table: 'species' })),
    ).toStrictEqual(['goose']);
    expect(speciesOf(await io.dumpTable({ table: 'species' }))).toStrictEqual([
      'goose',
    ]);
    expect(Object.keys(await io.dump())).toContain('species');
    expect(await io.tableExists('species')).toBe(true);
    expect(await io.contentType({ table: 'species' })).toBe('components');
    expect((await io.rawTableCfgs()).map((cfg) => cfg.key)).toContain(
      'species',
    );
  });

  it('asks for the cascade on every read and goes back to local when reset', async () => {
    const { cascade, io } = await stores();
    let resolved = 0;
    io.readThrough(() => {
      resolved += 1;
      return cascade;
    });

    await io.readRows({ table: 'species', where: { id: 'goose' } });
    await io.readRows({ table: 'species', where: { id: 'goose' } });
    io.readThrough(null);
    await io.readRows({ table: 'species', where: { id: 'goose' } });

    expect(resolved).toBe(2);
    expect(io.cascading).toBe(false);
  });

  it('delegates the lifecycle to the local store', async () => {
    const local = new IoMem();
    const io = new IoSwitch(local);

    expect(io.isOpen).toBe(false);
    await io.init();
    await io.isReady();
    expect(io.isOpen).toBe(true);
    expect(local.isOpen).toBe(true);
    await io.close();
    expect(local.isOpen).toBe(false);
  });
});
