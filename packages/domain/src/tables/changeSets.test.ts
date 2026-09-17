import type { Json } from '@rljson/json';
import {
  BaseValidator,
  Validate,
  throwOnInvalidTableCfg,
  type Buffet,
  type Rljson,
} from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { customersSeed } from '../seed/customers.ts';
import {
  changeSetsInsertHistoryTableCfg,
  changeSetsTableCfg,
  type ChangeSetRow,
} from './changeSets.ts';
import { customersTableCfg } from './customers.ts';

/**
 * Builds an rljson document holding the customers seed, an InsertHistory
 * row for its first customer and the given change set rows, wired together
 * through `_tableCfg` on `changeSets`. The rljson validator resolves a
 * buffet's items only against tables that are part of the same document
 * (`docs/findings/change-sets.md`), the same way it resolves a reference
 * column.
 */
const customerHistoryRow = hashed({
  timeId: '1789650880813:1fPL',
  customersRef: customersSeed[0]!._hash,
  route: '/customers',
  origin: 'db.insert',
  previous: [],
});

const changeSetsDocument = (rows: Buffet[]): Rljson => ({
  tableCfgs: hashed({
    _type: 'tableCfgs',
    _data: [customersTableCfg, changeSetsTableCfg],
  }),
  customers: hashed({ _type: 'components', _data: [...customersSeed] }),
  customersInsertHistory: hashed({
    _type: 'insertHistory',
    _data: [customerHistoryRow],
  }),
  changeSets: hashed({
    _type: 'buffets',
    _tableCfg: hashed(changeSetsTableCfg)._hash,
    _data: rows,
  }),
});

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

const changeSetRow: ChangeSetRow = {
  id: 'seed-customer',
  items: [
    { table: 'customers', ref: customersSeed[0]!._hash },
    { table: 'customersInsertHistory', ref: customerHistoryRow._hash },
  ],
};

describe('changeSetsTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(changeSetsTableCfg)).not.toThrow();
  });

  it('is a buffets root table keyed changeSets', () => {
    expect(changeSetsTableCfg).toMatchObject({
      key: 'changeSets',
      type: 'buffets',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has _hash, id and a jsonArray items column', () => {
    expect(
      changeSetsTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['items', 'jsonArray'],
    ]);
  });

  it('validates a change set whose items all exist in the document', async () => {
    const errors = await validationErrors(
      changeSetsDocument([hashed(changeSetRow)]),
    );

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when an item names a row the table does not hold', async () => {
    const errors = await validationErrors(
      changeSetsDocument([
        hashed({
          ...changeSetRow,
          items: [{ table: 'customers', ref: 'no-such-customer-hash' }],
        }),
      ]),
    );

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('buffetReferencedItemsNotFound');
    expect(errors.base.buffetReferencedItemsNotFound).toMatchObject({
      brokenItems: [
        {
          buffetTable: 'changeSets',
          itemTable: 'customers',
          missingItem: 'no-such-customer-hash',
        },
      ],
    });
  });

  it('is rejected by the validator when an item names a table the document does not hold', async () => {
    const errors = await validationErrors(
      changeSetsDocument([
        hashed({
          ...changeSetRow,
          items: [{ table: 'ghosts', ref: customersSeed[0]!._hash }],
        }),
      ]),
    );

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('buffetReferencedTablesNotFound');
    expect(errors.base.buffetReferencedTablesNotFound).toMatchObject({
      brokenBuffets: [
        { buffetTable: 'changeSets', missingItemTable: 'ghosts' },
      ],
    });
  });

  it('is rejected by the validator when items is not an array', async () => {
    // Deliberately not a `Buffet`: the point is what the validator says to
    // a row whose `items` has the wrong JSON type.
    const brokenRow = hashed({ id: 'broken', items: 'not-a-list' });
    const errors = await validationErrors(
      changeSetsDocument([brokenRow as unknown as Buffet]),
    );

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('dataDoesNotMatchColumnConfig');
    expect(errors.base.dataDoesNotMatchColumnConfig).toMatchObject({
      brokenValues: [{ table: 'changeSets', column: 'items' }],
    });
  });

  it('is rejected by the validator when a row hash is tampered with', async () => {
    const document = changeSetsDocument([hashed(changeSetRow)]);
    const changeSetsTable = document.changeSets as { _data: Json[] };
    changeSetsTable._data[0]._hash = 'tampered';

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('hashesNotValid');
  });
});

describe('changeSetsInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the changeSets table', () => {
    expect(changeSetsInsertHistoryTableCfg).toMatchObject({
      key: 'changeSetsInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(changeSetsInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references change set rows through a changeSetsRef column typed buffets', () => {
    const changeSetsRef = changeSetsInsertHistoryTableCfg.columns.find(
      (column) => column.key === 'changeSetsRef',
    );

    expect(changeSetsRef?.ref?.type).toBe('buffets');
    expect(
      changeSetsInsertHistoryTableCfg.columns.map((column) => column.key),
    ).toStrictEqual([
      '_hash',
      'timeId',
      'changeSetsRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
