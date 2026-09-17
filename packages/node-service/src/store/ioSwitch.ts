import type { Io } from '@rljson/io';
import type { ContentType, Rljson, TableCfg, TableKey } from '@rljson/rljson';

type ReadRowsRequest = Parameters<Io['readRows']>[0];

/**
 * Where the row reads of an `IoSwitch` currently go: `null` for the local
 * `Io` alone, otherwise a function that returns the cascade to read
 * through. A function rather than an `Io`, because `@rljson/server`
 * replaces a `Server`'s `IoMulti` on every client join and leave
 * (`server.io` is a moving target), so the switch asks for it on every
 * call rather than holding one.
 */
export type ReadCascade = (() => Io) | null;

/**
 * The `Io` facade behind `PetShopStore`'s `Db`: a targeted row read (a
 * `readRows` with a `where` clause) goes to the current read cascade, the
 * `IoMulti` of the hub transport's `Server` or `Client` while this node
 * has a role in the network, so that a row the local store does not hold
 * is looked up on the hub (and, through the hub, on every other client)
 * and cached locally on the way back. Everything else always goes to the
 * local `Io`: writes, table creation, dumps, row counts, table lookups,
 * the lifecycle, and also a whole-table read (an empty `where`), because
 * `IoMulti` answers such a read from the first layer that holds any row
 * of the table, which for an empty local table would pull the hub's
 * entire table into this node as a side effect of listing it; what a
 * node holds is decided by the synchronisation of slice D3, not by a
 * list request. A multi of `@rljson/server` writes to and dumps from its
 * local member alone anyway (peers are read-only and not dumpable), so
 * routing those to the local `Io` directly changes nothing and keeps a
 * role transition from ever touching a write. Without a cascade
 * (discovery disabled, standalone, or between two roles) the switch is
 * transparent and the store behaves exactly as a single node.
 *
 * Chosen over re-creating the store's `Db` on every role change because
 * the `Db` is what every store method holds, and swapping it under a
 * request in flight would race; re-pointing the reads is atomic per call.
 */
export class IoSwitch implements Io {
  private readonly local: Io;
  private cascade: ReadCascade = null;

  constructor(local: Io) {
    this.local = local;
  }

  /**
   * Routes row reads through the given cascade from now on, or back to the
   * local `Io` alone with `null`.
   */
  readThrough(cascade: ReadCascade): void {
    this.cascade = cascade;
  }

  /** Whether row reads currently go through a cascade. */
  get cascading(): boolean {
    return this.cascade !== null;
  }

  private get reader(): Io {
    return this.cascade === null ? this.local : this.cascade();
  }

  get isOpen(): boolean {
    return this.local.isOpen;
  }

  init(): Promise<void> {
    return this.local.init();
  }

  close(): Promise<void> {
    return this.local.close();
  }

  isReady(): Promise<void> {
    return this.local.isReady();
  }

  dump(): Promise<Rljson> {
    return this.local.dump();
  }

  dumpTable(request: { table: string }): Promise<Rljson> {
    return this.local.dumpTable(request);
  }

  contentType(request: { table: string }): Promise<ContentType> {
    return this.local.contentType(request);
  }

  tableExists(tableKey: TableKey): Promise<boolean> {
    return this.local.tableExists(tableKey);
  }

  createOrExtendTable(request: { tableCfg: TableCfg }): Promise<void> {
    return this.local.createOrExtendTable(request);
  }

  rawTableCfgs(): Promise<TableCfg[]> {
    return this.local.rawTableCfgs();
  }

  write(request: { data: Rljson }): Promise<void> {
    return this.local.write(request);
  }

  /**
   * The one read that follows the cascade, when it asks for specific rows.
   * The optional batch read `readRowsByHashes` is deliberately not
   * implemented here: `Db` then reads hash by hash through this method,
   * which cascades each one, and `IoSqliteNode` has no batch read to
   * forward to anyway.
   */
  readRows(request: ReadRowsRequest): Promise<Rljson> {
    const targeted = Object.keys(request.where).length > 0;
    return (targeted ? this.reader : this.local).readRows(request);
  }

  rowCount(table: string): Promise<number> {
    return this.local.rowCount(table);
  }
}
