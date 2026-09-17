import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One version of an invoice item as it is written to the `invoiceItems`
 * table. The content hash is added by hashing, see `HashedInvoiceItemRow`.
 * `invoiceRef` is the `_hash` of the invoice this line belongs to,
 * `animalRef` the `_hash` of the animal version that was sold. `quantity`
 * is a whole number of at least one. `unitPriceCents` is copied from the
 * animal's `priceCents` at the moment the invoice is issued, so a later
 * price change never rewrites an issued invoice.
 */
export type InvoiceItemRow = {
  id: string;
  invoiceRef: string;
  animalRef: string;
  quantity: number;
  unitPriceCents: number;
};

/**
 * An invoice item row as it is stored and served: the row plus its
 * `_hash`, which identifies this exact version across every node.
 */
export type HashedInvoiceItemRow = Hashed<InvoiceItemRow>;

const stringColumn = (
  key: keyof InvoiceItemRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `invoiceItems` table from roadmap section 2.6. Like every other
 * domain table it is a root table with its own `id`, even though an item
 * never exists without its invoice: a shared child table would give up the
 * stable `id` and the InsertHistory the "current version" rule of section
 * 2.6 relies on.
 */
export const invoiceItemsTableCfg: TableCfg = {
  key: 'invoiceItems',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    {
      key: 'invoiceRef',
      type: 'string',
      titleLong: 'Invoice reference',
      titleShort: 'Invoice',
      ref: { tableKey: 'invoices', type: 'components' },
    },
    {
      key: 'animalRef',
      type: 'string',
      titleLong: 'Animal reference',
      titleShort: 'Animal',
      ref: { tableKey: 'animals', type: 'components' },
    },
    {
      key: 'quantity',
      type: 'number',
      titleLong: 'Quantity',
      titleShort: 'Quantity',
    },
    {
      key: 'unitPriceCents',
      type: 'number',
      titleLong: 'Unit price in cents',
      titleShort: 'Unit price',
    },
  ],
};

/**
 * The InsertHistory companion of the `invoiceItems` table. Every insert
 * into `invoiceItems` writes one row here, which is how versions are
 * ordered later.
 */
export const invoiceItemsInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(invoiceItemsTableCfg);
