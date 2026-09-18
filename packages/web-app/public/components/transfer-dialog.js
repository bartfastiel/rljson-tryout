// @ts-check
import { fetchJson } from '../api.js';
import { changeSetPayloadView, isHistoryTable } from '../change-set-payload.js';
import { element } from '../dom.js';
import { liveEvents } from '../live-events.js';
import {
  concernsPartner,
  sideOf,
  transferActivity,
} from '../transfer-activity.js';
import { applyActivityTo, transferIcon } from '../transfer-icon.js';
import { errorState, statusMessage, timeFormat } from '../view-helpers.js';

/**
 * The partner node a popup is about: its id as the transfers name it
 * (`null` while this node has not learned it), its display name and the
 * URL its web app answers at.
 *
 * @typedef {object} TransferPartner
 * @property {string | null} nodeId
 * @property {string} name
 * @property {string} url
 */

/** How many transfers the popup lists at most. */
const listedTransfers = 10;

/**
 * The key that identifies a transfer in the list: a pull's start and its
 * outcome carry the same hash and direction, so the outcome replaces the
 * start.
 *
 * @param {import('../status-feed.js').SyncTransfer} transfer
 */
const transferKey = (transfer) =>
  `${transfer.direction}:${transfer.changeSetHash}`;

/**
 * The data tables a transfer named with their row counts, "animals 1,
 * animalTraits 2"; the history tables are implied.
 *
 * @param {Record<string, number>} tables
 */
const tablesSummary = (tables) => {
  const entries = Object.entries(tables).filter(
    ([table]) => !isHistoryTable(table),
  );
  return entries.map(([table, count]) => `${table} ${count}`).join(', ');
};

/**
 * "6 rows" for the rows a transfer named, nothing while they are not
 * known yet (a pull that just started).
 *
 * @param {Record<string, number>} tables
 */
const rowCountText = (tables) => {
  const rows = Object.values(tables).reduce((sum, count) => sum + count, 0);
  if (rows === 0) {
    return '';
  }
  return `${rows} ${rows === 1 ? 'row' : 'rows'}`;
};

/**
 * "12.7 kB" for a size in bytes, one decimal from a kilobyte on.
 *
 * @param {number} bytes
 */
const formatBytes = (bytes) =>
  bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;

/**
 * "blob 12.7 kB" for the one blob a pull fetched with the rows (the image
 * of a species version), "2 blobs 25.4 kB" for several, nothing for a
 * transfer that fetched none.
 *
 * @param {import('../status-feed.js').TransferredBlob[] | undefined} blobs
 */
const blobsText = (blobs) => {
  if (blobs === undefined || blobs.length === 0) {
    return '';
  }
  const bytes = blobs.reduce((sum, blob) => sum + blob.bytes, 0);
  const count = blobs.length === 1 ? 'blob' : `${blobs.length} blobs`;
  return `${count} ${formatBytes(bytes)}`;
};

let nextId = 0;

/**
 * What the row's button shows: the direction icon, the tables, the
 * short hash, the row count, the blobs the pull fetched, the time, the
 * duration of a pull and the status, then the chevron.
 *
 * @param {import('../status-feed.js').SyncTransfer} transfer
 * @param {TransferPartner} partner
 */
const rowSummary = (transfer, partner) => {
  const summary = tablesSummary(transfer.tables);
  const time = element('time', 'transfer-row-time');
  time.dateTime = transfer.at;
  time.textContent = timeFormat.format(new Date(transfer.at));
  const hash = element(
    'code',
    'transfer-row-hash',
    transfer.changeSetHash.slice(0, 8),
  );
  hash.title = transfer.changeSetHash;
  const pulled =
    transfer.direction === 'incoming' && transfer.status !== 'pending';
  return [
    transferIcon(sideOf(transfer), partner.nodeId ?? '', partner.name),
    element(
      'span',
      'visually-hidden',
      transfer.direction === 'incoming' ? 'Received' : 'Announced',
    ),
    element(
      'span',
      'transfer-row-tables',
      summary === '' ? 'change set' : summary,
    ),
    hash,
    element('span', 'transfer-row-count', rowCountText(transfer.tables)),
    element('span', 'transfer-row-blobs', blobsText(transfer.blobs)),
    time,
    element(
      'span',
      'transfer-row-duration',
      pulled ? `${transfer.durationMs} ms` : '',
    ),
    element(
      'span',
      `transfer-status transfer-status-${transfer.status}`,
      transfer.status,
    ),
    element('span', 'transfer-row-chevron'),
  ];
};

/**
 * The hidden part of a row and the button that shows it: the change
 * set's payload, loaded from the node the first time the row expands,
 * with a Retry when that fails (a change set that has not arrived yet
 * answers 404).
 *
 * @param {import('../status-feed.js').SyncTransfer} transfer
 */
const expandablePayload = (transfer) => {
  nextId += 1;
  const payload = element('div', 'transfer-payload');
  payload.id = `transfer-payload-${nextId}`;
  payload.hidden = true;
  const toggle = element('button', 'transfer-row-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', payload.id);
  let loaded = false;
  const load = async () => {
    payload.replaceChildren(statusMessage('Loading the change set…'));
    try {
      const changeSet =
        /** @type {import('../change-set-payload.js').ChangeSetPayload} */ (
          await fetchJson(`/api/change-sets/${transfer.changeSetHash}`)
        );
      payload.replaceChildren(changeSetPayloadView(changeSet));
      loaded = true;
    } catch (error) {
      payload.replaceChildren(
        errorState('Could not load the change set.', error, () => void load()),
      );
    }
  };
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    payload.hidden = expanded;
    if (!expanded && !loaded) {
      void load();
    }
  });
  return { toggle, payload };
};

/**
 * One transfer as a row of the popup: a button with the summary that
 * expands the row to the change set's payload, and the error of a
 * failed or retried pull below it.
 *
 * @param {import('../status-feed.js').SyncTransfer} transfer
 * @param {TransferPartner} partner
 */
const transferRow = (transfer, partner) => {
  const row = element('li', `transfer-row transfer-row-${transfer.direction}`);
  row.dataset.key = transferKey(transfer);
  const { toggle, payload } = expandablePayload(transfer);
  toggle.append(...rowSummary(transfer, partner));
  row.append(toggle, payload);
  if (transfer.error !== undefined) {
    row.append(element('p', 'transfer-row-error', transfer.error));
  }
  return row;
};

/**
 * The popup for one partner node: a modal dialog, full screen on a
 * phone and centred on a wide screen, with the partner's name and link,
 * a close button, and the last ten transfers with that partner, newest
 * first, read from `GET /api/sync/transfers` when it opens and kept
 * current from the `sync` events of the stream while it is open (a
 * pull's outcome replaces its start, a new transfer goes on top, the
 * list stays at ten). The title takes the focus when it opens, so that
 * the name is read first and Tab reaches the link, the close button and
 * the rows in order; Escape and the close button close it; the element
 * that opened it gets the focus back. One instance serves the page.
 */
class TransferDialog extends HTMLElement {
  #dialog = element('dialog', 'transfer-dialog');
  #title = element('h2', 'transfer-dialog-title');
  #link = element('a', 'transfer-dialog-link');
  #body = element('div', 'transfer-dialog-body');
  /** @type {HTMLUListElement | null} */
  #list = null;
  /** @type {TransferPartner | null} */
  #partner = null;
  /** @type {HTMLElement | null} */
  #opener = null;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {(() => void) | null} */
  #unsubscribeActivity = null;

  /**
   * Builds the dialog the first time the element enters the document; a
   * constructor must not give a custom element children.
   */
  connectedCallback() {
    if (this.#dialog.isConnected) {
      return;
    }
    this.#dialog.setAttribute('aria-labelledby', 'transfer-dialog-title');
    this.#title.id = 'transfer-dialog-title';
    this.#title.tabIndex = -1;
    const close = element('button', 'transfer-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.append(element('span', '', '✕'));
    close.addEventListener('click', () => this.#dialog.close());
    const heading = element('div', 'transfer-dialog-heading');
    heading.append(this.#title, this.#link);
    const header = element('header', 'transfer-dialog-header');
    header.append(heading, close);
    this.#dialog.append(header, this.#body);
    this.#dialog.addEventListener('close', () => this.#closed());
    this.append(this.#dialog);
  }

  /**
   * Opens the popup for a partner; `opener` receives the focus back when
   * it closes.
   *
   * @param {TransferPartner} partner
   * @param {HTMLElement} opener
   */
  open(partner, opener) {
    if (!this.isConnected) {
      document.body.append(this);
    }
    this.#partner = partner;
    this.#opener = opener;
    this.#title.textContent = `Transfers with ${partner.name}`;
    this.#link.href = partner.url;
    this.#link.textContent = partner.url;
    this.#list = null;
    this.#body.replaceChildren(statusMessage('Loading the transfers…'));
    this.#dialog.showModal();
    this.#title.focus();
    this.#follow();
    void this.#load();
  }

  async #load() {
    const partner = this.#partner;
    if (partner === null) {
      return;
    }
    if (partner.nodeId === null) {
      this.#body.replaceChildren(
        statusMessage(
          `This node has not learned the id of ${partner.name} yet, so no transfer can be attributed to it.`,
        ),
      );
      return;
    }
    let transfers;
    try {
      transfers = /** @type {import('../status-feed.js').SyncTransfer[]} */ (
        await fetchJson(
          `/api/sync/transfers?peer=${encodeURIComponent(partner.nodeId)}&limit=${listedTransfers}`,
        )
      );
    } catch (error) {
      if (this.#partner === partner) {
        this.#body.replaceChildren(
          errorState(
            'Could not load the transfers.',
            error,
            () => void this.#load(),
          ),
        );
      }
      return;
    }
    if (this.#partner !== partner || !this.#dialog.open) {
      return;
    }
    const list = element('ul', 'transfer-rows');
    list.setAttribute('aria-label', `Transfers with ${partner.name}`);
    this.#list = list;
    for (const transfer of transfers.slice(0, listedTransfers)) {
      list.append(transferRow(transfer, partner));
    }
    this.#body.replaceChildren(list);
    if (transfers.length === 0) {
      this.#body.prepend(
        statusMessage(`No change sets transferred with ${partner.name} yet.`),
      );
    }
    applyActivityTo(this);
  }

  #follow() {
    this.#unsubscribe?.();
    this.#unsubscribeActivity?.();
    this.#unsubscribeActivity = transferActivity.subscribe(() =>
      applyActivityTo(this),
    );
    this.#unsubscribe = liveEvents.on(
      'sync',
      /** @param {import('../status-feed.js').SyncTransfer} transfer */ (
        transfer,
      ) => this.#onTransfer(transfer),
    );
  }

  /**
   * @param {import('../status-feed.js').SyncTransfer} transfer
   */
  #onTransfer(transfer) {
    const partner = this.#partner;
    const nodeId = partner?.nodeId ?? null;
    const list = this.#list;
    if (
      partner === null ||
      nodeId === null ||
      list === null ||
      !concernsPartner(transfer, nodeId)
    ) {
      return;
    }
    const row = transferRow(transfer, partner);
    const existing = list.querySelector(
      `[data-key="${CSS.escape(transferKey(transfer))}"]`,
    );
    if (existing !== null) {
      existing.replaceWith(row);
    } else {
      list.prepend(row);
      while (list.children.length > listedTransfers) {
        list.lastElementChild?.remove();
      }
    }
    this.#body.querySelector('.status:not(.status-error)')?.remove();
    applyActivityTo(this);
  }

  /**
   * Gives the focus back to the element that opened the popup or, when a
   * status refresh rebuilt the header or the network view meanwhile, to
   * its successor for the same partner (`data-transfer-partner`).
   */
  #closed() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#unsubscribeActivity?.();
    this.#unsubscribeActivity = null;
    this.#partner = null;
    this.#list = null;
    const opener = this.#opener;
    this.#opener = null;
    this.remove();
    if (opener === null) {
      return;
    }
    if (opener.isConnected) {
      opener.focus();
      return;
    }
    const key = opener.dataset.transferPartner;
    const successor =
      key === undefined
        ? null
        : document.querySelector(
            `[data-transfer-partner="${CSS.escape(key)}"]`,
          );
    if (successor instanceof HTMLElement) {
      successor.focus();
    }
  }
}

customElements.define('transfer-dialog', TransferDialog);

/** @type {TransferDialog | null} */
let instance = null;

/**
 * Opens the transfer popup for a partner node from the element that was
 * activated, the node's badge in the header or its button on the network
 * view.
 *
 * @param {TransferPartner} partner
 * @param {HTMLElement} opener
 */
export const openTransferDialog = (partner, opener) => {
  instance ??= /** @type {TransferDialog} */ (
    document.createElement('transfer-dialog')
  );
  instance.open(partner, opener);
};
