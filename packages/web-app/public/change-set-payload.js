// @ts-check
import { element } from './dom.js';

/**
 * One item of `GET /api/change-sets/:hash`: the table and hash the change
 * set names, the row as this node holds it (`null` when it lacks it) and
 * the row of the version it supersedes when the node holds that one.
 *
 * @typedef {object} ChangeSetPayloadItem
 * @property {string} table
 * @property {string} ref
 * @property {Record<string, unknown> | null} row
 * @property {Record<string, unknown> | null} previousRow
 */

/**
 * @typedef {object} ChangeSetPayload
 * @property {string} hash
 * @property {string} id
 * @property {ChangeSetPayloadItem[]} items
 */

/**
 * Texts longer than this are shown by their changed region, or their
 * beginning, with a button for the whole text.
 */
const longTextLength = 200;

/** How many characters around a changed region stay visible. */
const contextLength = 40;

/**
 * @param {string} table
 */
export const isHistoryTable = (table) => table.endsWith('InsertHistory');

/**
 * A row's value as text: strings as they are, everything else as JSON,
 * so that a `jsonArray` of references reads the way it is stored.
 *
 * @param {unknown} value
 */
const valueText = (value) =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? '');

/**
 * @param {string} hash
 */
const shortHash = (hash) => hash.slice(0, 8);

/**
 * The fields of a row, or of two versions of it, in the order the row
 * lists them with the fields only the other version has appended; the
 * `_hash` stays out, the heading of the item shows it.
 *
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown> | null} previousRow
 */
const fieldNames = (row, previousRow) => {
  const names = Object.keys(row);
  for (const name of Object.keys(previousRow ?? {})) {
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names.filter((name) => name !== '_hash');
};

/**
 * The region of two texts that differs: the offset where they start to
 * differ and how many characters each keeps after the common end.
 *
 * @param {string} before
 * @param {string} after
 */
const changedRegion = (before, after) => {
  let prefix = 0;
  const shortest = Math.min(before.length, after.length);
  while (prefix < shortest && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
};

/**
 * A long text cut to the given region with context and ellipses, or to
 * its beginning when no region is given, followed by a button that shows
 * the whole text.
 *
 * @param {string} text
 * @param {{ prefix: number, suffix: number } | null} region
 */
const collapsedText = (text, region) => {
  const start =
    region === null ? 0 : Math.max(0, region.prefix - contextLength);
  const end =
    region === null
      ? longTextLength
      : Math.min(text.length, text.length - region.suffix + contextLength);
  const excerpt = element('span', 'field-excerpt');
  excerpt.append(
    element('span', '', start > 0 ? '…' : ''),
    element(
      'span',
      region === null ? '' : 'field-changed-region',
      text.slice(start, end),
    ),
    element('span', '', end < text.length ? '…' : ''),
  );
  const container = element('span', 'field-text');
  const showAll = element('button', 'field-show-all', 'Show all');
  showAll.type = 'button';
  showAll.addEventListener('click', () => {
    container.replaceChildren(element('span', 'field-full-text', text));
  });
  container.append(excerpt, showAll);
  return container;
};

/**
 * The cell for one field's value: the text as it is when it is short,
 * collapsed to the changed region (or the beginning) when it is long.
 *
 * @param {string} text
 * @param {string | null} otherText the same field of the other version, when compared
 */
const valueCell = (text, otherText) => {
  if (text.length <= longTextLength) {
    return element('span', 'field-text', text);
  }
  if (otherText === null || otherText === text) {
    return collapsedText(text, null);
  }
  return collapsedText(text, changedRegion(otherText, text));
};

/**
 * The fields of a row that has no predecessor, one line per field.
 *
 * @param {Record<string, unknown>} row
 */
const fieldList = (row) => {
  const list = element('dl', 'field-list');
  for (const name of fieldNames(row, null)) {
    list.append(element('dt', 'field-name', name));
    const definition = element('dd', 'field-value');
    definition.append(valueCell(valueText(row[name]), null));
    list.append(definition);
  }
  return list;
};

/**
 * @param {string} className
 * @param {HTMLElement} content
 */
const cell = (className, content) => {
  const created = element('span', className);
  created.setAttribute('role', 'cell');
  created.append(content);
  return created;
};

/**
 * The fields of a row next to the version it supersedes: per field its
 * name and, when it changed, the value before and the value after on a
 * tinted background, or its one value muted when it did not. One grid;
 * the stylesheet puts before and after side by side on wide screens and
 * stacks them, labelled, on a phone.
 *
 * @param {Record<string, unknown>} previousRow
 * @param {Record<string, unknown>} row
 */
const comparison = (previousRow, row) => {
  const grid = element('div', 'field-compare');
  grid.setAttribute('role', 'table');
  grid.setAttribute('aria-label', 'Before and after');
  const header = element('div', 'field-compare-header');
  header.setAttribute('role', 'row');
  for (const text of ['Field', 'Before', 'After']) {
    const heading = element('span', 'field-compare-heading', text);
    heading.setAttribute('role', 'columnheader');
    header.append(heading);
  }
  grid.append(header);
  for (const name of fieldNames(row, previousRow)) {
    const before = name in previousRow ? valueText(previousRow[name]) : '';
    const after = name in row ? valueText(row[name]) : '';
    const changed = before !== after;
    const fieldRow = element(
      'div',
      `field-row ${changed ? 'field-changed' : 'field-unchanged'}`,
    );
    fieldRow.setAttribute('role', 'row');
    const nameCell = element('span', 'field-name', name);
    nameCell.setAttribute('role', 'rowheader');
    fieldRow.append(nameCell);
    if (changed) {
      fieldRow.append(
        cell('field-value field-before', valueCell(before, after)),
        cell('field-value field-after', valueCell(after, before)),
      );
    } else {
      fieldRow.append(cell('field-value field-same', valueCell(after, null)));
    }
    grid.append(fieldRow);
  }
  return grid;
};

/**
 * An InsertHistory row in one line: its table, the row it was written
 * for, its time id, what it superseded and what wrote it.
 *
 * @param {ChangeSetPayloadItem} item
 */
const historyLine = (item) => {
  const line = element('p', 'payload-history');
  const row = item.row ?? {};
  const referenceColumn = Object.keys(row).find(
    (name) => name.endsWith('Ref') && name !== '_hash',
  );
  const previous = Array.isArray(row.previous) ? row.previous : [];
  line.append(
    element('span', 'payload-history-table', item.table),
    element('code', 'payload-hash', shortHash(item.ref)),
    element(
      'span',
      'payload-history-detail',
      item.row === null
        ? 'not on this node'
        : [
            `for ${shortHash(valueText(referenceColumn === undefined ? '' : row[referenceColumn]))}`,
            `at ${valueText(row.timeId)}`,
            previous.length === 0
              ? 'first version'
              : `after ${previous.map(valueText).join(', ')}`,
            `by ${valueText(row.origin)}`,
          ].join(' · '),
    ),
  );
  line.title = item.ref;
  return line;
};

/**
 * A data row of the change set: its table and hash as the heading, then
 * the comparison with the version it supersedes, or its fields alone, or
 * a note when this node lacks the row.
 *
 * @param {ChangeSetPayloadItem} item
 */
const dataItem = (item) => {
  const section = element('section', 'payload-item');
  const heading = element('h3', 'payload-item-heading');
  heading.append(
    element('span', 'payload-item-table', item.table),
    element('code', 'payload-hash', shortHash(item.ref)),
  );
  heading.title = item.ref;
  if (item.previousRow !== null) {
    const replaces = element(
      'span',
      'payload-item-replaces',
      `replaces ${shortHash(valueText(item.previousRow._hash))}`,
    );
    replaces.title = valueText(item.previousRow._hash);
    heading.append(replaces);
  }
  section.append(heading);
  if (item.row === null) {
    section.append(
      element('p', 'payload-note', 'This node does not hold the row.'),
    );
  } else if (item.previousRow === null) {
    section.append(fieldList(item.row));
  } else {
    section.append(comparison(item.previousRow, item.row));
  }
  return section;
};

/**
 * The payload of a change set as the expanded transfer row shows it: the
 * change set itself in one line, every data row with its fields (next to
 * the version it supersedes, changed fields marked), and every history
 * row in one line.
 *
 * @param {ChangeSetPayload} payload
 */
export const changeSetPayloadView = (payload) => {
  const view = element('div', 'change-set-payload');
  const heading = element('p', 'payload-change-set');
  heading.append(
    element('span', 'payload-change-set-id', payload.id),
    element('code', 'payload-hash', payload.hash),
    element(
      'span',
      'payload-change-set-count',
      `${payload.items.length} ${payload.items.length === 1 ? 'row' : 'rows'}`,
    ),
  );
  view.append(heading);
  for (const item of payload.items) {
    view.append(
      isHistoryTable(item.table) ? historyLine(item) : dataItem(item),
    );
  }
  return view;
};
