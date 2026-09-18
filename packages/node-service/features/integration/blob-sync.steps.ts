import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { blobIdOf, speciesImage } from '@rljson-tryout/domain';
import { expect } from 'vitest';

import type { SyncTransfer } from '../../src/network/syncAgent.ts';
import type { StatusReport } from '../../src/routes/status.ts';
import { composeNodes, ComposeProject } from './composeProject.ts';
import { allConnected, waitForStatuses, type ComposeNode } from './statuses.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'blob-sync.feature'),
);

const convergenceTimeoutMs = 90_000;

type SpeciesResponse = {
  id: string;
  hash: string;
  imageUrl: string;
};

/** The badge of a species no node seeds, so the bytes can only travel. */
const uploadedPng = Buffer.from(speciesImage('griffin'));

const byName = (name: string): ComposeNode => {
  const node = composeNodes.find((candidate) => candidate.name === name);
  if (node === undefined) {
    throw new Error(`no compose node is named ${name}`);
  }
  return node;
};

const url = (node: ComposeNode, path: string): string =>
  `http://127.0.0.1:${node.port}${path}`;

const requestJson = async <Body>(
  node: ComposeNode,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Body }> => {
  const response = await fetch(url(node, path), {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: (await response.json()) as Body };
};

/**
 * Polls until the condition holds and returns how long that took, which
 * is the upload-to-visible latency the findings record.
 */
const until = async (
  condition: () => Promise<boolean>,
  timeoutMs: number,
): Promise<number> => {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return Date.now() - started;
};

const currentDuckHash = async (
  node: ComposeNode,
): Promise<string | undefined> =>
  (await requestJson<SpeciesResponse[]>(node, '/api/species')).body.find(
    (species) => species.id === 'duck',
  )?.hash;

/**
 * The first scenario of `features/steps/blob-sync.steps.ts` against the
 * three containers of `deploy/compose/three-nodes.yml`: discovery elects
 * the hub, so node1 and node3 are whatever role the election gave them,
 * and the blob travels client to hub to client or hub to client alike.
 * The scenario logs the upload-to-visible latency and the pull it took.
 */
describeFeature(
  feature,
  ({ Scenario, BeforeAllScenarios, AfterAllScenarios }) => {
    const project = new ComposeProject();
    let statuses: StatusReport[] = [];

    BeforeAllScenarios(async () => {
      await project.up();
    });

    AfterAllScenarios(async () => {
      const logFile = await project.saveLogs();
      console.log(`compose logs saved to ${logFile}`);
      await project.down();
    });

    const nodeIdOf = (name: string): string =>
      statuses.find((status) => status.nodeName === name)!.nodeId!;

    Scenario(
      'A species image uploaded to node1 renders on node3 within five seconds',
      ({ Given, When, Then, And }) => {
        let version: SpeciesResponse;

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            statuses = await waitForStatuses(
              allConnected,
              convergenceTimeoutMs,
            );
            console.log(
              `roles: ${statuses.map((status) => `${status.nodeName} ${status.role}`).join(', ')}`,
            );
          },
        );

        When(
          'a PNG is uploaded as the image of the species "duck" on node1',
          async () => {
            const response = await requestJson<SpeciesResponse>(
              byName('node1'),
              '/api/species/duck/image',
              {
                method: 'POST',
                headers: { 'content-type': 'image/png' },
                body: uploadedPng,
              },
            );
            expect(response.status).toBe(200);
            version = response.body;
            expect(version.imageUrl).toBe(`/api/species/${version.hash}/image`);
          },
        );

        Then(
          'node3 lists that species version as current within five seconds',
          async () => {
            const latency = await until(
              async () =>
                (await currentDuckHash(byName('node3'))) === version.hash,
              5_000,
            );
            console.log(
              `species version from node1 current on node3 after ${latency} ms`,
            );
          },
        );

        And(
          "node3 serves the same bytes at the new version's image URL as image/png",
          async () => {
            for (const name of ['node3', 'node2']) {
              const response = await fetch(
                url(byName(name), version.imageUrl),
                {
                  signal: AbortSignal.timeout(5_000),
                },
              );
              expect(response.status).toBe(200);
              expect(response.headers.get('content-type')).toBe('image/png');
              expect(response.headers.get('cache-control')).toBe(
                'public, max-age=31536000, immutable',
              );
              const bytes = Buffer.from(await response.arrayBuffer());
              expect(bytes.equals(uploadedPng)).toBe(true);
              expect(blobIdOf(bytes)).toBe(blobIdOf(uploadedPng));
            }
          },
        );

        And(
          "node3's last transfer with node1 lists the blob with its size",
          async () => {
            const transfers = async (): Promise<SyncTransfer[]> =>
              (
                await requestJson<SyncTransfer[]>(
                  byName('node3'),
                  `/api/sync/transfers?peer=${nodeIdOf('node1')}&limit=10`,
                )
              ).body;
            await until(
              async () => (await transfers())[0]?.status === 'completed',
              5_000,
            );
            const [latest] = await transfers();
            expect(latest).toMatchObject({
              direction: 'incoming',
              peerNodeId: nodeIdOf('node1'),
              changeSetId: expect.stringMatching(
                /^update-species-image-duck-/,
              ) as string,
              tables: { species: 1, speciesInsertHistory: 1 },
              blobs: [
                { blobId: blobIdOf(uploadedPng), bytes: uploadedPng.length },
              ],
              status: 'completed',
            });
            console.log(
              `node3 pulled the species version and its ${uploadedPng.length} byte blob in ${latest!.durationMs} ms`,
            );
          },
        );
      },
    );
  },
  { excludeTags: ['in-process'] },
);
