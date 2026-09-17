import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { IoMem, type Io } from '@rljson/io';
import { IoSqliteNode } from '@rljson/io-sqlite-node';
import type { FastifyBaseLogger } from 'fastify';

import type { Configuration } from '../configuration.ts';

/**
 * The name of the SQLite database file inside `DATA_DIR`. One file per
 * node; the node identity of discovery lives next to it under `identity/`,
 * so a node with a volume keeps both across restarts.
 */
export const sqliteDatabaseFileName = 'petshop.sqlite';

export type IoConfiguration = Pick<Configuration, 'storage' | 'dataDirectory'>;

/**
 * `IoSqliteNode` with the database switched to write-ahead logging and
 * `synchronous = NORMAL` right after it opens the file. The library opens
 * the database with SQLite's defaults (`journal_mode = delete`,
 * `synchronous = FULL`), and since every `Io.write` is its own
 * transaction, seeding the store means one journal file and two `fsync`s
 * per row: 0.7 s for the seed and 28 ms per invoice on the development
 * machine, against 70 ms and 3.5 ms with these two pragmas
 * (`docs/findings/stores.md`). Committed transactions stay durable across
 * a crash of the process; only a power loss can lose the last ones, which
 * this project accepts.
 */
export class WriteAheadLogSqliteIo extends IoSqliteNode {
  override async init(): Promise<void> {
    await super.init();
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
  }
}

/**
 * Builds the `Io` the configured `STORAGE` names, not yet initialized:
 * `PetShopStore.initialize` opens it. `memory` is `IoMem`; `sqlite` is
 * `IoSqliteNode` over `<DATA_DIR>/petshop.sqlite`, passed as an absolute
 * path because a relative `dbFileName` lands under `./data/` of the
 * working directory instead (roadmap section 3.5), with the directory
 * created first so that a missing or unwritable `DATA_DIR` fails here
 * with a path in the message rather than inside the library.
 */
export const createIo = (
  configuration: IoConfiguration,
  logger: FastifyBaseLogger,
): Io => {
  if (configuration.storage === 'memory') {
    logger.info({ storage: 'memory' }, 'store keeps its data in memory');
    return new IoMem();
  }

  mkdirSync(configuration.dataDirectory, { recursive: true });
  const databaseFile = join(
    configuration.dataDirectory,
    sqliteDatabaseFileName,
  );
  const io = new WriteAheadLogSqliteIo();
  io.dbFileName = databaseFile;
  logger.info(
    { storage: 'sqlite', databaseFile },
    'store keeps its data in a SQLite file',
  );
  return io;
};
