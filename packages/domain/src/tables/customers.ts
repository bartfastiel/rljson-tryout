import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One version of a customer as it is written to the `customers` table. The
 * content hash is added by hashing, see `HashedCustomerRow`. `personRef` is
 * the `_hash` of the referenced row in the `persons` table: the person this
 * customer account belongs to at the time this row was written. A person
 * can be a breeder and a customer at once (Grandma Duck is both in the
 * seed); the two roles reference the same `persons` row independently.
 * `customerNumber` is the number printed on invoices and quoted by the
 * customer, distinct from the technical `id`.
 */
export type CustomerRow = {
  id: string;
  personRef: string;
  customerNumber: string;
};

/**
 * A customer row as it is stored and served: the row plus its `_hash`,
 * which identifies this exact version across every node.
 */
export type HashedCustomerRow = Hashed<CustomerRow>;

const stringColumn = (
  key: keyof CustomerRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `customers` table from roadmap section 2.6. It is a root table: it
 * has no parent and `id` is the stable identity of a customer across
 * versions, the same pattern `breeders` follows for the other role a
 * person can take.
 */
export const customersTableCfg: TableCfg = {
  key: 'customers',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    {
      key: 'personRef',
      type: 'string',
      titleLong: 'Person reference',
      titleShort: 'Person',
      ref: { tableKey: 'persons', type: 'components' },
    },
    stringColumn('customerNumber', 'Customer number', 'Number'),
  ],
};

/**
 * The InsertHistory companion of the `customers` table. Every insert into
 * `customers` writes one row here, which is how versions are ordered later.
 */
export const customersInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(customersTableCfg);
