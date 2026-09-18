import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  boundingBoxOf,
  expectNoHorizontalScroll,
  mainNavigation,
  viewportOf,
} from './support.ts';

const node2Url = 'https://node2.example.test';
const node3Url = 'https://node3.example.test';

/**
 * A `/status` of a node that discovered node2 but not node3, in an
 * environment of three nodes, as the node service would answer it.
 */
const threeNodeStatus = {
  nodeName: 'node1',
  nodeId: 'id-node1',
  identity: {
    persistent: true,
    startedAt: '2026-09-17T10:00:03.000Z',
    identityPath: '/data/identity/petshop-test/node-id',
  },
  publicUrl: 'https://node1.example.test',
  domain: 'petshop-test',
  role: 'client',
  hubNodeId: 'id-node2',
  hubAddress: '10.42.0.12:3000',
  peers: [
    {
      nodeId: 'id-node2',
      name: 'node2',
      hostname: 'node2-pod',
      addresses: ['10.42.0.12'],
      port: 3000,
      role: 'hub',
      startedAt: '2026-09-17T10:00:00.000Z',
      firstSeen: '2026-09-17T10:00:05.000Z',
      lastSeen: '2026-09-17T10:05:00.000Z',
      probe: {
        reachable: true,
        latencyMs: 0.8,
        measuredAt: '2026-09-17T10:05:00.000Z',
      },
      excludedFromElection: true,
    },
  ],
  nodes: [
    {
      url: 'https://node1.example.test',
      self: true,
      name: 'node1',
      nodeId: 'id-node1',
      role: 'client',
      connectedClients: null,
      identity: { persistent: true, startedAt: '2026-09-17T10:00:03.000Z' },
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
      identity: { persistent: false, startedAt: '2026-09-17T10:00:00.000Z' },
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
      identity: null,
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
    announced: 45,
    received: 2,
    skipped: 44,
    pending: 1,
    failed: 0,
    lastError: null,
    transfers: [
      {
        direction: 'incoming',
        peerNodeId: 'id-node2',
        changeSetHash: 'Q2hhbmdlU2V0SGFzaE9uZQ',
        changeSetId: 'issue-invoice-2026-0007',
        tables: {
          invoices: 1,
          invoicesInsertHistory: 1,
          invoiceItems: 1,
          invoiceItemsInsertHistory: 1,
        },
        durationMs: 12,
        at: '2026-09-17T10:04:58.000Z',
        status: 'completed',
      },
      {
        direction: 'outgoing',
        peerNodeId: 'id-node2',
        changeSetHash: 'T3V0Z29pbmdIYXNoVHdv',
        changeSetId: 'update-animal-bowser-the-guard-dog-1789654560429:vqqc',
        tables: { animals: 1, animalsInsertHistory: 1 },
        durationMs: 0,
        at: '2026-09-17T10:04:40.000Z',
        status: 'completed',
      },
      {
        direction: 'incoming',
        peerNodeId: null,
        changeSetHash: 'UGVuZGluZ0hhc2hUaHJlZQ',
        changeSetId: null,
        tables: {},
        durationMs: 5000,
        at: '2026-09-17T10:04:20.000Z',
        status: 'pending',
        error: 'pull of changeSets@UGVuZGluZ0hhc2hUaHJlZQ exceeded 5000 ms',
      },
    ],
  },
  storage: 'memory',
  tables: { species: 3, animals: 10 },
};

/**
 * Serves the three-node status and lets this browser reach node2's
 * `/health` (with the cross-origin header the node service sends) but not
 * node3's.
 */
const mockThreeNodes = async (page: Page): Promise<void> => {
  await page.route('**/status', (route) =>
    route.fulfill({ json: threeNodeStatus }),
  );
  await page.route(`${node2Url}/health`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      json: { status: 'ok', name: 'node2' },
    }),
  );
  await page.route(`${node3Url}/health`, (route) => route.abort('failed'));
};

const nodeBar = (page: Page): Locator =>
  page.getByRole('banner').getByRole('navigation', { name: 'Nodes' });

const borderColorOf = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => getComputedStyle(element).borderTopColor);

const channelsOf = (cssColor: string): number[] =>
  (cssColor.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

test.describe('with three nodes in the environment', () => {
  test.beforeEach(async ({ page }) => {
    await mockThreeNodes(page);
  });

  test('shows this node as the active badge and the others as buttons that open their transfers', async ({
    page,
  }) => {
    await page.goto('/');
    const bar = nodeBar(page);

    const badge = bar.locator('.node-badge-active');
    await expect(badge).toHaveText(/node1/);
    await expect(badge).toHaveAttribute('aria-current', 'true');
    await expect(badge).toContainText('Connected to node');

    const partners = bar.getByRole('button');
    await expect(partners).toHaveCount(2);
    await expect(partners.nth(0)).toContainText('node2');
    await expect(partners.nth(1)).toContainText('node3');
    await expect(partners.nth(0)).toContainText('show transfers');
    await expect(bar.getByRole('link')).toHaveCount(0);
  });

  test('outlines a node green when discovery sees it and red otherwise', async ({
    page,
  }) => {
    await page.goto('/');
    const bar = nodeBar(page);
    const seen = bar.getByRole('button', { name: /node2/ });
    const unseen = bar.getByRole('button', { name: /node3/ });

    await expect(seen).toHaveClass(/node-partner-seen/);
    await expect(unseen).toHaveClass(/node-partner-unseen/);
    await expect(seen).toContainText('in the discovery topology');
    await expect(unseen).toContainText('not in the discovery topology');

    const [red, green] = channelsOf(await borderColorOf(seen));
    expect(green).toBeGreaterThan(red);
    const [unseenRed, unseenGreen] = channelsOf(await borderColorOf(unseen));
    expect(unseenRed).toBeGreaterThan(unseenGreen);
  });

  test("marks the browser's own probe separately from the discovery outline", async ({
    page,
  }) => {
    await page.goto('/');
    const bar = nodeBar(page);

    await expect(
      bar.getByRole('button', { name: /node2/ }).locator('.browser-probe'),
    ).toHaveClass(/browser-probe-ok/);
    await expect(
      bar.getByRole('button', { name: /node3/ }).locator('.browser-probe'),
    ).toHaveClass(/browser-probe-failed/);
    await expect(bar.getByRole('button', { name: /node2/ })).toContainText(
      'reachable from your browser',
    );
    await expect(bar.getByRole('button', { name: /node3/ })).toContainText(
      'not reachable from your browser',
    );
  });

  test('shows the connected clients of the hub as a small badge', async ({
    page,
  }) => {
    await page.goto('/');
    const bar = nodeBar(page);

    const hubBadge = bar
      .getByRole('button', { name: /node2/ })
      .locator('.node-clients');
    await expect(hubBadge).toHaveText(/2/);
    await expect(hubBadge).toHaveAttribute('title', '2 connected clients');
    await expect(bar.getByRole('button', { name: /node2/ })).toContainText(
      '2 connected clients',
    );
    await expect(
      bar.getByRole('button', { name: /node3/ }).locator('.node-clients'),
    ).toHaveCount(0);
    await expect(bar.locator('.node-badge-active .node-clients')).toHaveCount(
      0,
    );
  });

  test('keeps every node of the header visible without scrolling, at least 44 pixels tall', async ({
    page,
  }) => {
    await page.goto('/');
    const bar = nodeBar(page);
    await expect(bar.getByRole('button')).toHaveCount(2);

    await expectNoHorizontalScroll(page);
    const viewportWidth = viewportOf(page).width;
    const entries = [
      bar.locator('.node-badge-active'),
      ...(await bar.getByRole('button').all()),
    ];
    for (const entry of entries) {
      const box = await boundingBoxOf(entry);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
    }
  });

  test('lists this node and every node of the environment on the network view', async ({
    page,
  }) => {
    await page.goto('/#/network');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Network' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('Network · Duckburg Pet Shop');
    await expect(
      mainNavigation(page).getByRole('link', { name: 'Network' }),
    ).toHaveAttribute('aria-current', 'page');

    const thisNode = page.locator('.network-section').first();
    await expect(thisNode).toContainText('node1');
    await expect(thisNode.locator('.role-badge')).toHaveText('client');
    await expect(thisNode).toContainText('id-node1');
    await expect(thisNode).toContainText('petshop-test');
    await expect(thisNode).toContainText('node2 (10.42.0.12:3000)');
    await expect(thisNode).toContainText(
      'connected to the hub at 10.42.0.12:3000',
    );
    await expect(thisNode).toContainText(
      'persistent id, restored from the data directory (/data/identity/petshop-test/node-id)',
    );

    const cards = page.locator('.node-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('node1 (this node)');
    await expect(cards.nth(0).getByRole('link')).toHaveCount(0);
    await expect(
      cards.nth(1).getByRole('link', { name: 'node2' }),
    ).toHaveAttribute('href', node2Url);
    await expect(cards.nth(1).locator('.role-badge')).toHaveText('hub');
    await expect(cards.nth(1).locator('.node-clients')).toHaveText(/2/);
    await expect(cards.nth(0).locator('.node-clients')).toHaveCount(0);
    await expect(cards.nth(0).locator('.identity-badge')).toHaveText(
      'persistent id',
    );
    await expect(cards.nth(0).locator('.identity-badge')).toHaveClass(
      /identity-persistent/,
    );
    await expect(cards.nth(1).locator('.identity-badge')).toHaveText(
      'fresh id',
    );
    await expect(cards.nth(2).locator('.identity-badge')).toHaveCount(0);
    await expect(cards.nth(1).locator('.topology-dot')).toHaveClass(
      /topology-dot-seen/,
    );
    await expect(cards.nth(1)).toContainText('In the discovery topology');
    await expect(cards.nth(1)).toContainText("Reachable by this node's probe");
    await expect(cards.nth(1)).toContainText('Reachable from your browser');
    await expect(cards.nth(1)).toContainText('Last seen');
    await expect(
      cards.nth(2).getByRole('link', { name: 'node3' }),
    ).toHaveAttribute('href', node3Url);
    await expect(cards.nth(2).locator('.topology-dot')).toHaveClass(
      /topology-dot-unseen/,
    );
    await expect(cards.nth(2)).toContainText('Not in the discovery topology');
    await expect(cards.nth(2)).toContainText(
      "Not reachable by this node's probe",
    );
    await expect(cards.nth(2)).toContainText('Not reachable from your browser');
    await expect(cards.nth(2)).toContainText('Never seen by this node');

    const peers = page.locator('.peer-card');
    await expect(peers).toHaveCount(1);
    await expect(peers.first()).toContainText('node2');
    await expect(peers.first()).toContainText('10.42.0.12:3000');
    await expect(peers.first()).toContainText('reachable, 0.8 ms');
    await expect(peers.first()).toContainText(
      'Electionexcluded by this node (it restarted or denies the hub role)',
    );

    await expectNoHorizontalScroll(page);
  });

  test('shows the synchronisation counters and the last transfers with their nodes', async ({
    page,
  }) => {
    await page.goto('/#/network');

    const section = page.locator('.network-section').filter({
      has: page.getByRole('heading', { level: 2, name: 'Synchronisation' }),
    });
    await expect(section).toContainText('Announced45');
    await expect(section).toContainText('Received2');
    await expect(section).toContainText('Skipped44 already held');
    await expect(section).toContainText('Pending1');
    await expect(section).toContainText('Failed0');
    await expect(section).toContainText('Last errornone');

    const transfers = section.getByRole('list', { name: 'Last transfers' });
    const items = transfers.locator('.transfer');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveClass(/transfer-incoming/);
    await expect(items.nth(0)).toContainText('Received from node2');
    await expect(items.nth(0)).toContainText('issue-invoice-2026-0007');
    await expect(items.nth(0)).toContainText('Q2hhbmdl');
    await expect(items.nth(0)).toContainText('4 rows in 4 tables');
    await expect(items.nth(0)).toContainText('12 ms');
    await expect(items.nth(0).locator('.transfer-status')).toHaveText(
      'completed',
    );
    await expect(items.nth(0).locator('.transfer-rows')).toHaveAttribute(
      'title',
      'invoices: 1, invoicesInsertHistory: 1, invoiceItems: 1, invoiceItemsInsertHistory: 1',
    );
    await expect(items.nth(1)).toHaveClass(/transfer-outgoing/);
    await expect(items.nth(1)).toContainText('Announced to node2');
    await expect(items.nth(1)).toContainText('2 rows in 2 tables');
    await expect(items.nth(2)).toContainText('Received from the hub');
    await expect(items.nth(2).locator('.transfer-status')).toHaveText(
      'pending',
    );
    await expect(items.nth(2)).toContainText(
      'pull of changeSets@UGVuZGluZ0hhc2hUaHJlZQ exceeded 5000 ms',
    );

    await expectNoHorizontalScroll(page);
  });
});

test.describe('with a single node', () => {
  test('shows just the active badge in the header', async ({ page }) => {
    await page.goto('/');
    const bar = nodeBar(page);

    await expect(bar.locator('.node-badge-active')).toContainText(
      'node-under-test',
    );
    await expect(bar.getByRole('button')).toHaveCount(0);
  });

  test('reports the node as standalone without peers on the network view', async ({
    page,
  }) => {
    await page.goto('/#/network');

    const thisNode = page.locator('.network-section').first();
    await expect(thisNode.locator('.role-badge')).toHaveText('standalone');
    await expect(thisNode).toContainText('none elected');
    await expect(thisNode).toContainText('idle, this node runs on its own');
    await expect(thisNode).toContainText(
      'fresh id, generated at this start, not written to disk',
    );
    await expect(page.locator('.node-clients')).toHaveCount(0);
    await expect(page.locator('.node-card')).toHaveCount(1);
    await expect(page.locator('.node-card').first()).toContainText(
      'node-under-test (this node)',
    );
    await expect(page.getByRole('status')).toHaveText([
      'No change sets transferred yet.',
      'No peers discovered yet.',
    ]);
  });
});

test('shows an error with a retry button when /status fails', async ({
  page,
}) => {
  let nodeIsBroken = true;
  await page.route('**/status', async (route) => {
    if (nodeIsBroken) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'discovery unavailable',
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto('/#/network');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the network status.');
  await expect(alert).toContainText('500');
  await expect(nodeBar(page)).toContainText('unknown node');

  nodeIsBroken = false;
  await alert.getByRole('button', { name: 'Retry' }).click();

  await expect(page.locator('.node-card')).toHaveCount(1);
  await expect(alert).toHaveCount(0);
  await expect(nodeBar(page)).toContainText('node-under-test');
});

test('navigates to the network view from the main navigation', async ({
  page,
}) => {
  await page.goto('/#/animals');

  await mainNavigation(page).getByRole('link', { name: 'Network' }).click();

  await expect(page).toHaveURL(/#\/network$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Network' }),
  ).toBeVisible();
});
