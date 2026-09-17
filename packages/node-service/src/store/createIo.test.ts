import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IoMem } from '@rljson/io';
import { IoSqliteNode } from '@rljson/io-sqlite-node';
import { afterAll, describe, expect, it } from 'vitest';

import { recordingLogger } from '../testing/recordingLogger.ts';
import { createIo, sqliteDatabaseFileName } from './createIo.ts';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'create-io-'));
afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

describe('createIo', () => {
  it('returns an in-memory Io for STORAGE=memory and touches no directory', () => {
    const dataDirectory = join(temporaryDirectory, 'untouched');
    const { logger, records } = recordingLogger();

    const io = createIo({ storage: 'memory', dataDirectory }, logger);

    expect(io).toBeInstanceOf(IoMem);
    expect(existsSync(dataDirectory)).toBe(false);
    expect(records).toStrictEqual([
      {
        level: 'info',
        message: 'store keeps its data in memory',
        fields: { storage: 'memory' },
      },
    ]);
  });

  it('returns a SQLite Io over <DATA_DIR>/petshop.sqlite for STORAGE=sqlite', async () => {
    const dataDirectory = join(temporaryDirectory, 'nested', 'data');
    const databaseFile = join(dataDirectory, sqliteDatabaseFileName);
    const { logger, records } = recordingLogger();

    const io = createIo({ storage: 'sqlite', dataDirectory }, logger);

    expect(io).toBeInstanceOf(IoSqliteNode);
    expect((io as IoSqliteNode).dbFileName).toBe(databaseFile);
    expect(statSync(dataDirectory).isDirectory()).toBe(true);
    expect(records).toStrictEqual([
      {
        level: 'info',
        message: 'store keeps its data in a SQLite file',
        fields: { storage: 'sqlite', databaseFile },
      },
    ]);

    await io.init();
    await io.isReady();
    const database = (io as IoSqliteNode).db;
    expect(database.prepare('PRAGMA journal_mode').get()).toMatchObject({
      journal_mode: 'wal',
    });
    expect(database.prepare('PRAGMA synchronous').get()).toMatchObject({
      synchronous: 1,
    });
    await io.close();
    expect(statSync(databaseFile).isFile()).toBe(true);
  });

  it('reuses an existing data directory', () => {
    const dataDirectory = join(temporaryDirectory, 'existing');
    const first = createIo(
      { storage: 'sqlite', dataDirectory },
      recordingLogger().logger,
    );

    const second = createIo(
      { storage: 'sqlite', dataDirectory },
      recordingLogger().logger,
    );

    expect((second as IoSqliteNode).dbFileName).toBe(
      (first as IoSqliteNode).dbFileName,
    );
  });
});
