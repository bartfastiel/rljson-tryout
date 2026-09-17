import type { Io } from '@rljson/io';
import type { ContentType, Rljson, TableCfg, TableKey } from '@rljson/rljson';

type ReadRowsRequest = Parameters<Io['readRows']>[0];

/**
 * The node's local `Io` as it is lent to `@rljson/server`: everything
 * delegates to the real store except `close()`, which does nothing here.
 *
 * `Server.tearDown()` closes its `IoMulti`, and `IoMulti.close()` closes
 * every member including the local one, so a node that steps down from
 * hub to client would close its own SQLite file (or flag its `IoMem`
 * closed) and every later read would fail with "Local Io must be
 * initialized and open". `Client` has an `ownsStores: false` option for
 * exactly this case; `Server` has none, so the store is lent through this
 * facade to both. It also keeps a peer from closing the store over the
 * wire: `IoPeerBridge` and `IoServer` expose `close` as a socket event
 * next to `readRows` (`docs/findings/hub-transport.md`). The store's
 * owner closes the real `Io` on shutdown as before.
 */
export class BorrowedIo implements Io {
  private readonly io: Io;

  constructor(io: Io) {
    this.io = io;
  }

  get isOpen(): boolean {
    return this.io.isOpen;
  }

  init(): Promise<void> {
    return this.io.init();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  isReady(): Promise<void> {
    return this.io.isReady();
  }

  dump(): Promise<Rljson> {
    return this.io.dump();
  }

  dumpTable(request: { table: string }): Promise<Rljson> {
    return this.io.dumpTable(request);
  }

  contentType(request: { table: string }): Promise<ContentType> {
    return this.io.contentType(request);
  }

  tableExists(tableKey: TableKey): Promise<boolean> {
    return this.io.tableExists(tableKey);
  }

  createOrExtendTable(request: { tableCfg: TableCfg }): Promise<void> {
    return this.io.createOrExtendTable(request);
  }

  rawTableCfgs(): Promise<TableCfg[]> {
    return this.io.rawTableCfgs();
  }

  write(request: { data: Rljson }): Promise<void> {
    return this.io.write(request);
  }

  readRows(request: ReadRowsRequest): Promise<Rljson> {
    return this.io.readRows(request);
  }

  rowCount(table: string): Promise<number> {
    return this.io.rowCount(table);
  }
}
