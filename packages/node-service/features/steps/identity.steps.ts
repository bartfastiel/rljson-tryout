import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { expect } from 'vitest';

import type { NodeReport } from '../../src/network/nodeDirectory.ts';
import { RoleOrchestrator } from '../../src/network/roleOrchestrator.ts';
import { TopologyRepair } from '../../src/network/topologyRepair.ts';
import {
  FakeDiscoveryManager,
  fakeNodeInfo,
} from '../../src/testing/fakeDiscoveryManager.ts';
import { FakeTransport } from '../../src/testing/fakeTransport.ts';
import { recordingLogger } from '../../src/testing/recordingLogger.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'identity.feature'),
);

const selfNodeId = 'survivor-id';
const hubNodeId = 'hub-id';
const hubFirstStart = 1_700_000_000_000;
const selfStart = hubFirstStart + 10_000;
const hubSecondStart = hubFirstStart + 120_000;

const settle = (): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, 20));

/**
 * The split view of `docs/findings/network-discovery.md` from the
 * survivor's side, driven by hand: the orchestrator runs over a fake
 * manager whose peer table holds the hub's first start time, the
 * directory's poll is a report the scenario writes, and a clock the
 * scenario advances drives the repair's grace period.
 */
describeFeature(
  feature,
  ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
    let dataDirectory = '';
    let now = selfStart + 60_000;
    let reports: NodeReport[] = [];
    let manager: FakeDiscoveryManager;
    let orchestrator: RoleOrchestrator;
    let transport: FakeTransport;
    let repair: TopologyRepair;
    let records: ReturnType<typeof recordingLogger>['records'];

    BeforeEachScenario(() => {
      dataDirectory = mkdtempSync(join(tmpdir(), 'identity-feature-'));
      now = selfStart + 60_000;
      reports = [];
      const logging = recordingLogger();
      records = logging.records;
      transport = new FakeTransport();
      orchestrator = new RoleOrchestrator(
        {
          rljsonDomain: 'petshop-test',
          hubPort: 0,
          broadcastPort: 0,
          dataDirectory,
          discovery: 'enabled',
        },
        logging.logger,
        transport,
        {
          createDiscoveryManager: (config) => {
            manager = new FakeDiscoveryManager(
              config,
              fakeNodeInfo(selfNodeId, { startedAt: selfStart }),
            );
            return manager;
          },
          now: () => now,
        },
      );
      repair = new TopologyRepair(
        {
          network: () => orchestrator.snapshot(),
          reports: () => reports,
          excludeFromElection: (nodeId, durationMs) =>
            orchestrator.excludeFromElection(nodeId, durationMs),
        },
        logging.logger,
        { now: () => now },
      );
    });

    AfterEachScenario(async () => {
      repair.stop();
      await orchestrator.stop();
      rmSync(dataDirectory, { recursive: true, force: true });
    });

    Scenario(
      'A survivor stops following a hub that returned with a new start time',
      ({ Given, When, Then, And }) => {
        Given('a node that follows an earlier peer as hub', async () => {
          await orchestrator.start();
          manager.join(
            fakeNodeInfo(hubNodeId, {
              localIps: ['10.0.0.9'],
              startedAt: hubFirstStart,
            }),
          );
          manager.elect(hubNodeId, '10.0.0.9:3000');
          await settle();
          reports = [
            {
              nodeId: hubNodeId,
              role: 'hub',
              startedAt: new Date(hubFirstStart).toISOString(),
            },
          ];
          repair.check();

          expect(orchestrator.snapshot()).toMatchObject({
            role: 'client',
            hubNodeId,
            peers: [
              {
                nodeId: hubNodeId,
                startedAt: new Date(hubFirstStart).toISOString(),
                excludedFromElection: false,
              },
            ],
          });
          expect(transport.calls.at(-1)).toMatchObject({
            kind: 'client',
            hubAddress: '10.0.0.9:3000',
          });
        });

        When(
          'that peer answers its status with the same node id and a later start time',
          () => {
            reports = [
              {
                nodeId: hubNodeId,
                role: 'client',
                startedAt: new Date(hubSecondStart).toISOString(),
              },
            ];
            repair.check();
            expect(manager.exclusions).toStrictEqual([]);
          },
        );

        Then(
          'within the grace period the node excludes the peer from its election and becomes the hub itself',
          async () => {
            now += 4_999;
            repair.check();
            expect(manager.exclusions).toStrictEqual([]);
            now += 1;
            repair.check();
            await settle();

            expect(manager.exclusions).toStrictEqual([
              { nodeId: hubNodeId, durationMs: 90_000 },
            ]);
            expect(orchestrator.snapshot()).toMatchObject({
              role: 'hub',
              hubNodeId: selfNodeId,
              peers: [{ nodeId: hubNodeId, excludedFromElection: true }],
            });
            expect(transport.calls.at(-1)).toMatchObject({ kind: 'hub' });
          },
        );

        And('the exclusion is logged with its cause', () => {
          expect(records).toContainEqual(
            expect.objectContaining({
              level: 'warn',
              message: 'peer excluded from the hub election',
              fields: expect.objectContaining({
                nodeId: hubNodeId,
                cause: 'peer-restarted',
                knownStartedAt: new Date(hubFirstStart).toISOString(),
                reportedStartedAt: new Date(hubSecondStart).toISOString(),
                observedForMs: 5_000,
              }) as Record<string, unknown>,
            }),
          );
        });
      },
    );
  },
  { includeTags: ['in-process'] },
);
