import {
  BaseValidator,
  Validate,
  type InsertHistoryRow,
  type Rljson,
  type TableCfg,
} from '@rljson/rljson';
import { hashed } from '@rljson-tryout/domain';

/**
 * The store's whole content as a document the rljson `BaseValidator`
 * accepts as input. The InsertHistory tables stay in the document (a
 * change set's items point into them), but their table configurations are
 * left out: `createInsertHistoryTableCfg` produces configurations rljson's
 * own validator rejects (`tableCfgHasRootHeadSharedError`, and a
 * `<table>Ref` column pointing at a `<table>MultiEdits` table that does
 * not exist), which would stop the validator before it reaches the
 * reference and buffet checks the store integrity tests are after
 * (`docs/findings/change-sets.md`).
 */
export const validatableDocument = (dump: Rljson): Rljson => {
  const isInsertHistory = (key: string) => key.endsWith('InsertHistory');
  const document: Rljson = {};
  for (const [key, table] of Object.entries(dump)) {
    if (key === '_hash') {
      continue;
    }
    if (key === 'tableCfgs') {
      const configurations = table._data as TableCfg[];
      document.tableCfgs = hashed({
        _type: 'tableCfgs',
        _data: configurations.filter(
          (configuration) => !isInsertHistory(configuration.key),
        ),
      });
    } else if (isInsertHistory(key)) {
      document[key] = hashed({
        _type: 'insertHistory',
        _data: table._data as InsertHistoryRow<string>[],
      });
    } else {
      document[key] = table;
    }
  }
  return document;
};

/**
 * Runs rljson's `BaseValidator` over a document: `{}` when nothing is
 * wrong, the validator's report otherwise.
 */
export const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};
