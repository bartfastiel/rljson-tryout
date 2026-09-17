import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * The states an invoice can be in (roadmap section 2.6). A freshly issued
 * invoice is `open`; `paid` and `cancelled` are the two ways it ends.
 */
export const invoiceStatuses = ['open', 'paid', 'cancelled'] as const;

export type InvoiceStatus = (typeof invoiceStatuses)[number];

/**
 * One version of an invoice as it is written to the `invoices` table. The
 * content hash is added by hashing, see `HashedInvoiceRow`. `customerRef`
 * is the `_hash` of the referenced row in the `customers` table: the
 * customer version the invoice was issued to. `invoiceNumber` is the
 * number printed on the invoice (`<year>-<sequence>`, see
 * `invoiceNumbering.ts`), distinct from the technical `id`. `issuedOn` is an
 * ISO date (`YYYY-MM-DD`), the same shape `animals.bornOn` uses. The items
 * of an invoice live in `invoiceItems` and point back here through
 * `invoiceRef`.
 */
export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  customerRef: string;
  issuedOn: string;
  status: InvoiceStatus;
};

/**
 * An invoice row as it is stored and served: the row plus its `_hash`,
 * which identifies this exact version across every node.
 */
export type HashedInvoiceRow = Hashed<InvoiceRow>;

const stringColumn = (
  key: keyof InvoiceRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `invoices` table from roadmap section 2.6. It is a root table: it has
 * no parent and `id` is the stable identity of an invoice across versions.
 * `status` is a plain string column; rljson has no enumeration column
 * type, so the allowed values are enforced by `InvoiceStatus` in the code
 * that writes rows, not by the store.
 */
export const invoicesTableCfg: TableCfg = {
  key: 'invoices',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    stringColumn('invoiceNumber', 'Invoice number', 'Number'),
    {
      key: 'customerRef',
      type: 'string',
      titleLong: 'Customer reference',
      titleShort: 'Customer',
      ref: { tableKey: 'customers', type: 'components' },
    },
    stringColumn('issuedOn', 'Issued on', 'Issued'),
    stringColumn('status', 'Status', 'Status'),
  ],
};

/**
 * The InsertHistory companion of the `invoices` table. Every insert into
 * `invoices` writes one row here, which is how versions are ordered later.
 */
export const invoicesInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(invoicesTableCfg);
