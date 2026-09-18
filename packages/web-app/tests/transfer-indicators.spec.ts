import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  boundingBoxOf,
  expectNoHorizontalScroll,
  viewportOf,
} from './support.ts';

const node2Url = 'https://node2.example.test';
const node3Url = 'https://node3.example.test';
const changeSetHash = 'Q2hhbmdlU2V0SGFzaE9uZQ';
const changeSetId = 'update-animal-bowser-the-guard-dog-1789654560429:vqqc';

/**
 * A `/status` of node1, a client of the hub node2, in an environment of
 * three nodes of which node3 has not introduced itself yet.
 */
const status = {
  nodeName: 'node1',
  nodeId: 'id-node1',
  publicUrl: 'https://node1.example.test',
  domain: 'petshop-test',
  role: 'client',
  hubNodeId: 'id-node2',
  hubAddress: '10.42.0.12:3000',
  peers: [],
  nodes: [
    {
      url: 'https://node1.example.test',
      self: true,
      name: 'node1',
      nodeId: 'id-node1',
      role: 'client',
      connectedClients: null,
      reachable: true,
      lastSeen: '2026-09-17T10:05:00.000Z',
      seenInTopology: true,
    },
    {
      url: node2Url,
      self: false,
      name: 'node2',
      nodeId: 'id-node2',
      role: 'hub',
      connectedClients: 2,
      reachable: true,
      lastSeen: '2026-09-17T10:05:00.000Z',
      seenInTopology: true,
    },
    {
      url: node3Url,
      self: false,
      name: 'node3',
      nodeId: null,
      role: null,
      connectedClients: null,
      reachable: false,
      lastSeen: null,
      seenInTopology: false,
    },
  ],
  transport: {
    role: 'client',
    hubAddress: '10.42.0.12:3000',
    connectedToHub: true,
    lastError: null,
  },
  sync: {
    announced: 1,
    received: 1,
    skipped: 44,
    pending: 0,
    failed: 0,
    lastError: null,
    transfers: [],
    catchUp: {
      lastStartedAt: null,
      lastCompletedAt: null,
      missingAtStart: 0,
      pulled: 0,
      durationMs: null,
    },
  },
  storage: 'memory',
  tables: { species: 3, animals: 10 },
};

const pendingFromNode2 = {
  direction: 'incoming',
  peerNodeId: 'id-node2',
  changeSetHash,
  changeSetId: null,
  tables: {},
  durationMs: 0,
  at: '2026-09-17T10:04:58.000Z',
  status: 'pending',
};

const completedFromNode2 = {
  ...pendingFromNode2,
  changeSetId,
  tables: {
    animals: 1,
    animalsInsertHistory: 1,
    animalTraits: 2,
    animalTraitsInsertHistory: 2,
  },
  durationMs: 12,
  status: 'completed',
};

const failedFromNode2 = {
  ...completedFromNode2,
  durationMs: 2000,
  status: 'failed',
  error: 'row animals@abc does not hash to its content, skipped',
};

/** A species image uploaded on node2, pulled with its blob (slice D5). */
const imageFromNode2 = {
  ...completedFromNode2,
  changeSetHash: 'SW1hZ2VDaGFuZ2VTZXRIYXNo',
  changeSetId: 'update-species-image-duck-1789654570000:img1',
  tables: { species: 1, speciesInsertHistory: 1 },
  blobs: [{ blobId: 'cZUR_CtM1HRbZkdIwhsEH9', bytes: 12_700 }],
  durationMs: 31,
  at: '2026-09-17T10:04:59.000Z',
};

const announcedToHub = {
  direction: 'outgoing',
  peerNodeId: 'id-node2',
  changeSetHash: 'T3V0Z29pbmdIYXNoVHdv',
  changeSetId: 'issue-invoice-2026-0009',
  tables: {
    invoices: 1,
    invoicesInsertHistory: 1,
    invoiceItems: 1,
    invoiceItemsInsertHistory: 1,
  },
  durationMs: 0,
  at: '2026-09-17T10:04:40.000Z',
  status: 'completed',
};

const announcedToEveryClient = {
  ...announcedToHub,
  peerNodeId: null,
  changeSetHash: 'QnJvYWRjYXN0SGFzaFRocmVl',
  changeSetId: 'issue-invoice-2026-0010',
};

const story = `${'Bowser guarded the money bin for nine years. '.repeat(6)}He retired in spring. ${'He now sleeps in the sun most of the day. '.repeat(5)}`;

/**
 * The payload of the edit's change set: the animal with its previous
 * version (the name and one sentence of the long story changed), its
 * history row, and one junction row with its previous pairing.
 */
const changeSetPayload = {
  hash: changeSetHash,
  id: changeSetId,
  items: [
    {
      table: 'animals',
      ref: 'QW5pbWFsUm93SGFzaE5ldw',
      row: {
        _hash: 'QW5pbWFsUm93SGFzaE5ldw',
        id: 'bowser-the-guard-dog',
        name: 'Bowser the Retired Guard Dog',
        priceCents: 61000,
        backgroundStory: story,
      },
      previousRow: {
        _hash: 'QW5pbWFsUm93SGFzaE9sZA',
        id: 'bowser-the-guard-dog',
        name: 'Bowser the Guard Dog',
        priceCents: 61000,
        backgroundStory: story.replace(
          'He retired in spring.',
          'He is still on duty.',
        ),
      },
    },
    {
      table: 'animalsInsertHistory',
      ref: 'SGlzdG9yeVJvd0hhc2g',
      row: {
        _hash: 'SGlzdG9yeVJvd0hhc2g',
        animalsRef: 'QW5pbWFsUm93SGFzaE5ldw',
        timeId: '1789654560429:vqqc',
        route: '/animals@1767225600005:seed',
        origin: 'db.insert',
        previous: ['1767225600005:seed'],
      },
      previousRow: null,
    },
    {
      table: 'animalTraits',
      ref: 'SnVuY3Rpb25Sb3dIYXNo',
      row: {
        _hash: 'SnVuY3Rpb25Sb3dIYXNo',
        id: 'bowser-the-guard-dog--loyal',
        animalRef: 'QW5pbWFsUm93SGFzaE5ldw',
        traitRef: 'VHJhaXRMb3lhbEhhc2g',
      },
      previousRow: {
        _hash: 'SnVuY3Rpb25Sb3dPbGQ',
        id: 'bowser-the-guard-dog--loyal',
        animalRef: 'QW5pbWFsUm93SGFzaE9sZA',
        traitRef: 'VHJhaXRMb3lhbEhhc2g',
      },
    },
  ],
};

/**
 * The body of one `text/event-stream` response: a short `retry`, so that
 * the browser reopens the stream quickly once this response has ended,
 * then the given `sync` events.
 */
const streamBody = (events: readonly unknown[]): string =>
  `retry: 100\n\n: connected\n\n${events
    .map(
      (event, index) =>
        `id: ${index + 1}\nevent: sync\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('')}`;

/**
 * Serves `/api/events` one response per batch: every request of the
 * browser waits until the test hands it a batch with `send`, then gets
 * it as a complete stream response, after which the browser reconnects
 * (the `retry` above) and waits for the next batch. So the test decides
 * exactly when the page hears each event.
 */
const mockEventStream = async (page: Page) => {
  const batches: unknown[][] = [];
  let waiting: ((batch: unknown[]) => void) | null = null;
  await page.route('**/api/events', async (route) => {
    const batch =
      batches.shift() ??
      (await new Promise<unknown[]>((resolve) => {
        waiting = resolve;
      }));
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
      body: streamBody(batch),
    });
  });
  return {
    send: (...events: unknown[]) => {
      if (waiting === null) {
        batches.push(events);
      } else {
        const resolve = waiting;
        waiting = null;
        resolve(events);
      }
    },
  };
};

const mockNodes = async (
  page: Page,
  transfersWithNode2: readonly unknown[] = [completedFromNode2, announcedToHub],
): Promise<void> => {
  await page.route('**/status', (route) => route.fulfill({ json: status }));
  await page.route(`${node2Url}/health`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      json: { status: 'ok', name: 'node2' },
    }),
  );
  await page.route(`${node3Url}/health`, (route) => route.abort('failed'));
  await page.route(/\/api\/sync\/transfers\?/, (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('limit')).toBe('10');
    route.fulfill({
      json:
        url.searchParams.get('peer') === 'id-node2' ? transfersWithNode2 : [],
    });
  });
  await page.route(`**/api/change-sets/${changeSetHash}`, (route) =>
    route.fulfill({ json: changeSetPayload }),
  );
  await page.route('**/api/change-sets/T3V0Z29pbmdIYXNoVHdv', (route) =>
    route.fulfill({
      status: 404,
      json: {
        statusCode: 404,
        error: 'Not Found',
        message:
          'This node holds no change set with hash "T3V0Z29pbmdIYXNoVHdv".',
      },
    }),
  );
};

const nodeBar = (page: Page): Locator =>
  page.getByRole('banner').getByRole('navigation', { name: 'Nodes' });

const partnerBadge = (page: Page, name: string): Locator =>
  nodeBar(page).getByRole('button', { name: new RegExp(`^${name}`) });

const upstreamIcon = (badge: Locator): Locator =>
  badge.locator('.transfer-icon-upstream');

const downstreamIcon = (badge: Locator): Locator =>
  badge.locator('.transfer-icon-downstream');

const animationNameOf = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => getComputedStyle(element).animationName);

const dialog = (page: Page): Locator => page.getByRole('dialog');

const transferRows = (page: Page): Locator =>
  dialog(page)
    .getByRole('list', { name: 'Transfers with node2' })
    .locator('.transfer-row');

test.describe('the transfer icons of the node bar', () => {
  test('animate the upstream icon of the sender while a change set arrives and for a second after', async ({
    page,
  }) => {
    const stream = await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    const node2 = partnerBadge(page, 'node2');
    const node3 = partnerBadge(page, 'node3');
    const icon = upstreamIcon(node2);
    await expect(icon).toHaveAttribute(
      'aria-label',
      'upstream from node2: idle',
    );
    await expect(icon).toHaveAttribute('role', 'img');
    await expect(downstreamIcon(node2)).toHaveAttribute(
      'aria-label',
      'downstream to node2: idle',
    );

    stream.send(pendingFromNode2);

    await expect(icon).toHaveClass(/is-receiving/);
    await expect(icon).toHaveAttribute('aria-label', 'receiving from node2');
    expect(await animationNameOf(icon.locator('.transfer-icon-fill'))).toBe(
      'transfer-fill',
    );
    await expect(upstreamIcon(node3)).not.toHaveClass(/is-receiving/);
    await expect(downstreamIcon(node2)).not.toHaveClass(/is-sending/);

    stream.send(completedFromNode2);

    await expect(icon).toHaveClass(/is-trailing/);
    await expect(icon).not.toHaveClass(/is-receiving/);
    await expect(icon).toHaveAttribute('aria-label', 'received from node2');
    expect(await animationNameOf(icon.locator('.transfer-icon-fill'))).toBe(
      'transfer-fill',
    );
    await expect(icon).not.toHaveClass(/is-trailing/, { timeout: 3000 });
    await expect(icon).toHaveAttribute(
      'aria-label',
      'upstream from node2: idle',
    );
    expect(await animationNameOf(icon.locator('.transfer-icon-fill'))).toBe(
      'none',
    );
  });

  test('show the downstream icon of the hub for an announcement and of every partner for a broadcast', async ({
    page,
  }) => {
    const stream = await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    const node2 = partnerBadge(page, 'node2');
    const node3 = partnerBadge(page, 'node3');
    await expect(downstreamIcon(node2)).toBeVisible();

    stream.send(announcedToHub);

    await expect(downstreamIcon(node2)).toHaveClass(/is-trailing/);
    await expect(downstreamIcon(node2)).toHaveAttribute(
      'aria-label',
      'sent to node2',
    );
    await expect(downstreamIcon(node3)).not.toHaveClass(/is-trailing/);
    await expect(downstreamIcon(node2)).not.toHaveClass(/is-trailing/, {
      timeout: 3000,
    });

    stream.send(announcedToEveryClient);

    await expect(downstreamIcon(node2)).toHaveClass(/is-trailing/);
    await expect(downstreamIcon(node3)).toHaveClass(/is-trailing/);
    await expect(upstreamIcon(node2)).not.toHaveClass(/is-trailing/);
  });

  test('flash the upstream icon red once when a pull fails', async ({
    page,
  }) => {
    const stream = await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    const icon = upstreamIcon(partnerBadge(page, 'node2'));
    await expect(icon).toBeVisible();

    stream.send(pendingFromNode2);
    await expect(icon).toHaveClass(/is-receiving/);
    stream.send(failedFromNode2);

    await expect(icon).toHaveClass(/is-failed/);
    await expect(icon).toHaveAttribute(
      'aria-label',
      'receiving from node2 failed',
    );
    const [red, green] = (
      (await icon.evaluate((element) => getComputedStyle(element).color)).match(
        /\d+/g,
      ) ?? []
    ).map(Number);
    expect(red).toBeGreaterThan(green!);
    await expect(icon).not.toHaveClass(/is-failed/, { timeout: 3000 });
  });

  test('keep animating in step when a status refresh rebuilds the badge', async ({
    page,
  }) => {
    const stream = await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    const icon = upstreamIcon(partnerBadge(page, 'node2'));
    await expect(icon).toBeVisible();

    stream.send(pendingFromNode2);
    await expect(icon).toHaveClass(/is-receiving/);
    const phase = await icon.evaluate((element) =>
      element.style.getPropertyValue('--transfer-phase'),
    );
    expect(phase).toMatch(/^-\d+ms$/);
    // The `sync` event above refreshes `/status`, which rebuilds the bar
    // and replaces the icon.
    const replaced = await icon.elementHandle();
    await expect
      .poll(() => replaced!.evaluate((element) => element.isConnected))
      .toBe(false);
    await expect(icon).toHaveClass(/is-receiving/);
    expect(
      await icon.evaluate((element) =>
        element.style.getPropertyValue('--transfer-phase'),
      ),
    ).toMatch(/^-\d+ms$/);
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows the active colour steadily instead of the animation', async ({
    page,
  }) => {
    const stream = await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    const icon = upstreamIcon(partnerBadge(page, 'node2'));
    await expect(icon).toBeVisible();

    stream.send(pendingFromNode2);

    await expect(icon).toHaveClass(/is-receiving/);
    const fill = icon.locator('.transfer-icon-fill');
    expect(await animationNameOf(fill)).toBe('none');
    expect(
      await fill.evaluate((element) => getComputedStyle(element).clipPath),
    ).toBe('none');
  });
});

test.describe('the transfer popup', () => {
  test('opens from a partner badge with its last transfers, full screen on a phone and as a dialog on a wide screen', async ({
    page,
  }) => {
    await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    const badge = partnerBadge(page, 'node2');

    await badge.click();

    const popup = dialog(page);
    await expect(popup).toBeVisible();
    await expect(
      popup.getByRole('heading', { level: 2, name: 'Transfers with node2' }),
    ).toBeVisible();
    await expect(popup.getByRole('link', { name: node2Url })).toHaveAttribute(
      'href',
      node2Url,
    );
    const close = popup.getByRole('button', { name: 'Close' });
    const closeBox = await boundingBoxOf(close);
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);

    const rows = transferRows(page);
    await expect(rows).toHaveCount(2);
    const received = rows.nth(0);
    await expect(received).toHaveClass(/transfer-row-incoming/);
    await expect(received.locator('.transfer-icon-upstream')).toBeVisible();
    await expect(received).toContainText('animals 1, animalTraits 2');
    await expect(received.locator('.transfer-row-hash')).toHaveText('Q2hhbmdl');
    await expect(received.locator('.transfer-row-hash')).toHaveAttribute(
      'title',
      changeSetHash,
    );
    await expect(received).toContainText('6 rows');
    await expect(received.locator('time')).toHaveAttribute(
      'datetime',
      '2026-09-17T10:04:58.000Z',
    );
    await expect(received.locator('time')).not.toBeEmpty();
    await expect(received).toContainText('12 ms');
    await expect(received.locator('.transfer-status')).toHaveText('completed');
    const announced = rows.nth(1);
    await expect(announced).toHaveClass(/transfer-row-outgoing/);
    await expect(announced.locator('.transfer-icon-downstream')).toBeVisible();
    await expect(announced).toContainText('invoices 1, invoiceItems 1');
    await expect(announced.locator('.transfer-row-duration')).toBeHidden();
    for (const toggle of await rows.locator('.transfer-row-toggle').all()) {
      expect((await boundingBoxOf(toggle)).height).toBeGreaterThanOrEqual(44);
    }

    const viewport = viewportOf(page);
    const box = await boundingBoxOf(popup);
    if (viewport.width < 768) {
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
      expect(box.width).toBe(viewport.width);
      expect(box.height).toBe(viewport.height);
    } else {
      expect(box.width).toBeLessThan(viewport.width - 64);
      expect(box.height).toBeLessThan(viewport.height);
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(
        2,
      );
    }
    await expectNoHorizontalScroll(page);

    await page.keyboard.press('Escape');

    await expect(popup).toHaveCount(0);
    await expect(badge).toBeFocused();
  });

  test('shows the blob a pull fetched with the rows, and nothing for a pull without one', async ({
    page,
  }) => {
    await mockEventStream(page);
    await mockNodes(page, [imageFromNode2, completedFromNode2]);
    await page.goto('/');

    await partnerBadge(page, 'node2').click();

    const rows = transferRows(page);
    await expect(rows).toHaveCount(2);
    const withBlob = rows.nth(0);
    await expect(withBlob).toContainText('species 1');
    await expect(withBlob).toContainText('2 rows');
    await expect(withBlob.locator('.transfer-row-blobs')).toHaveText(
      'blob 12.7 kB',
    );
    await expect(withBlob).toContainText('31 ms');
    await expect(rows.nth(1).locator('.transfer-row-blobs')).toBeHidden();
    await expectNoHorizontalScroll(page);
  });

  test('expands a transfer to the payload with the changed fields marked', async ({
    page,
  }) => {
    await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    await partnerBadge(page, 'node2').click();
    const row = transferRows(page).nth(0);
    const toggle = row.locator('.transfer-row-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const payload = row.locator('.transfer-payload');
    await expect(payload).toBeVisible();
    await expect(payload.locator('.payload-change-set')).toContainText(
      changeSetId,
    );
    await expect(payload.locator('.payload-change-set')).toContainText(
      '3 rows',
    );

    const animal = payload.locator('.payload-item').filter({
      has: page.getByRole('heading', { level: 3, name: /^animals/ }),
    });
    const nameRow = animal.locator('.field-row').filter({
      has: page.getByRole('rowheader', { name: 'name' }),
    });
    await expect(nameRow).toHaveClass(/field-changed/);
    await expect(nameRow.locator('.field-before')).toHaveText(
      /Bowser the Guard Dog$/,
    );
    await expect(nameRow.locator('.field-after')).toHaveText(
      /Bowser the Retired Guard Dog$/,
    );
    const priceRow = animal.locator('.field-row').filter({
      has: page.getByRole('rowheader', { name: 'priceCents' }),
    });
    await expect(priceRow).toHaveClass(/field-unchanged/);
    await expect(priceRow.locator('.field-value')).toHaveText('61000');
    await expect(priceRow.locator('.field-before')).toHaveCount(0);
    await expect(animal.locator('.payload-item-heading')).toContainText(
      'replaces QW5pbWFs',
    );
    await expect(animal.getByRole('rowheader', { name: '_hash' })).toHaveCount(
      0,
    );

    const storyRow = animal.locator('.field-row').filter({
      has: page.getByRole('rowheader', { name: 'backgroundStory' }),
    });
    await expect(storyRow).toHaveClass(/field-changed/);
    const storyAfter = storyRow.locator('.field-after');
    await expect(storyAfter.locator('.field-changed-region')).toContainText(
      'He retired in spring.',
    );
    await expect(storyAfter).toContainText('…');
    expect((await storyAfter.innerText()).length).toBeLessThan(story.length);
    const showAll = storyAfter.getByRole('button', { name: 'Show all' });
    expect((await boundingBoxOf(showAll)).height).toBeGreaterThanOrEqual(44);
    await showAll.click();
    await expect(storyAfter).toHaveText(story);
    await expect(storyAfter.getByRole('button')).toHaveCount(0);

    const junction = payload.locator('.payload-item').filter({
      has: page.getByRole('heading', { level: 3, name: /^animalTraits/ }),
    });
    await expect(
      junction.locator('.field-row').filter({
        has: page.getByRole('rowheader', { name: 'animalRef' }),
      }),
    ).toHaveClass(/field-changed/);
    await expect(
      junction.locator('.field-row').filter({
        has: page.getByRole('rowheader', { name: 'traitRef' }),
      }),
    ).toHaveClass(/field-unchanged/);

    const history = payload.locator('.payload-history');
    await expect(history).toHaveCount(1);
    await expect(history).toContainText('animalsInsertHistory');
    await expect(history).toContainText('after 1767225600005:seed');
    await expect(history).toContainText('by db.insert');

    const beforeLabel = await nameRow
      .locator('.field-before')
      .evaluate((element) => {
        const style = getComputedStyle(element, '::before');
        return { content: style.content, display: style.display };
      });
    const headers = payload.locator('.field-compare-header').first();
    if (viewportOf(page).width < 768) {
      expect(beforeLabel).toStrictEqual({
        content: '"Before"',
        display: 'block',
      });
      await expect(headers).toBeHidden();
    } else {
      expect(beforeLabel.display).toBe('none');
      await expect(headers).toBeVisible();
      await expect(headers).toContainText('Before');
    }
    await expectNoHorizontalScroll(page);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(payload).toBeHidden();
  });

  test('says so when the node does not hold a change set', async ({ page }) => {
    await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    await partnerBadge(page, 'node2').click();

    await transferRows(page).nth(1).locator('.transfer-row-toggle').click();

    const alert = transferRows(page).nth(1).getByRole('alert');
    await expect(alert).toContainText('Could not load the change set.');
    await expect(alert).toContainText(
      'This node holds no change set with hash "T3V0Z29pbmdIYXNoVHdv".',
    );
  });

  test('follows the stream while it is open', async ({ page }) => {
    const stream = await mockEventStream(page);
    await mockNodes(page, [announcedToHub]);
    await page.goto('/');
    await partnerBadge(page, 'node2').click();
    await expect(transferRows(page)).toHaveCount(1);

    stream.send(pendingFromNode2);

    await expect(transferRows(page)).toHaveCount(2);
    const pending = transferRows(page).nth(0);
    await expect(pending.locator('.transfer-status')).toHaveText('pending');
    await expect(pending).toContainText('change set');
    await expect(pending.locator('.transfer-icon-upstream')).toHaveClass(
      /is-receiving/,
    );

    stream.send(completedFromNode2);

    await expect(transferRows(page)).toHaveCount(2);
    const completed = transferRows(page).nth(0);
    await expect(completed.locator('.transfer-status')).toHaveText('completed');
    await expect(completed).toContainText('animals 1, animalTraits 2');
    await expect(transferRows(page).nth(1)).toContainText('invoices 1');
  });

  test('can be opened, expanded and closed with the keyboard', async ({
    page,
  }) => {
    await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');
    const badge = partnerBadge(page, 'node2');
    await badge.focus();

    await page.keyboard.press('Enter');

    const popup = dialog(page);
    await expect(popup).toBeVisible();
    await expect(
      popup.getByRole('heading', { level: 2, name: 'Transfers with node2' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(popup.getByRole('link', { name: node2Url })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(popup.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Tab');
    const firstToggle = transferRows(page)
      .nth(0)
      .locator('.transfer-row-toggle');
    await expect(firstToggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(
      transferRows(page).nth(0).locator('.transfer-payload'),
    ).toContainText(changeSetId);

    await page.keyboard.press('Escape');

    await expect(popup).toHaveCount(0);
    await expect(badge).toBeFocused();
  });

  test('explains that a node without an id has no transfers to show', async ({
    page,
  }) => {
    await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/');

    await partnerBadge(page, 'node3').click();

    const popup = dialog(page);
    await expect(
      popup.getByRole('heading', { level: 2, name: 'Transfers with node3' }),
    ).toBeVisible();
    await expect(popup.getByRole('status')).toContainText(
      'has not learned the id of node3 yet',
    );
    await popup.getByRole('button', { name: 'Close' }).click();
    await expect(popup).toHaveCount(0);
  });

  test('opens from a partner card of the network view, whose cards carry the icons too', async ({
    page,
  }) => {
    const stream = await mockEventStream(page);
    await mockNodes(page);
    await page.goto('/#/network');
    const card = page.locator('.node-card').nth(1);
    await expect(card).toContainText('node2');
    await expect(card.locator('.transfer-icon-upstream')).toBeVisible();

    stream.send(pendingFromNode2);
    await expect(card.locator('.transfer-icon-upstream')).toHaveClass(
      /is-receiving/,
    );

    const button = card.getByRole('button', { name: 'Transfers with node2' });
    expect((await boundingBoxOf(button)).height).toBeGreaterThanOrEqual(44);
    await button.click();

    await expect(
      dialog(page).getByRole('heading', {
        level: 2,
        name: 'Transfers with node2',
      }),
    ).toBeVisible();
    await expect(transferRows(page)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
  });
});
