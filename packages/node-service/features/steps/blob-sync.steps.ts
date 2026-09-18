import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { blobIdOf, speciesImage } from '@rljson-tryout/domain';
import { describe, expect } from 'vitest';

import type { SyncTransfer } from '../../src/network/syncAgent.ts';
import type { StatusReport } from '../../src/routes/status.ts';
import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'blob-sync.feature'),
);

type NodeName = 'node1' | 'node2' | 'node3';

const nodeNames: readonly NodeName[] = ['node1', 'node2', 'node3'];

/** The node ids the scenarios give their nodes, discovery being off. */
const nodeIdOf = (name: NodeName): string => `${name}-id`;

type SpeciesResponse = {
  id: string;
  hash: string;
  name: string;
  latinName: string;
  description: string;
  imageUrl: string;
};

/**
 * The image every scenario uploads: the badge of a species the seed does
 * not have, so that no node can render it from an id and the bytes can
 * only come over the network.
 */
const uploadedPng = Buffer.from(speciesImage('griffin'));

const dataDirectories = useTemporaryDataDirectories();

const status = async (world: World): Promise<StatusReport> =>
  (await world.server.inject({ method: 'GET', url: '/status' })).json();

const until = async (
  condition: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
};

/**
 * Three nodes in this process, discovery disabled and the roles given by
 * hand: node1 serves as hub on an ephemeral port, node2 and node3 connect
 * to it, each with a seeded store of the same kind and the node ids of
 * `nodeIdOf`, like `change-set-sync.steps.ts`. The upload goes to the hub
 * here; against Compose (`features/integration`) node1 is whatever the
 * election made it.
 */
describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    const worlds = new Map<NodeName, World>();
    let hubAddress = '';

    AfterEachScenario(async () => {
      for (const name of [...nodeNames].reverse()) {
        const world = worlds.get(name);
        if (world !== undefined) {
          await closeWorld(world);
        }
      }
      worlds.clear();
    });

    const world = (name: NodeName): World => {
      const found = worlds.get(name);
      if (found === undefined) {
        throw new Error(`${name} is not running`);
      }
      return found;
    };

    const startNode = async (name: NodeName): Promise<World> => {
      const started = await createWorld({
        storage,
        dataDirectory: dataDirectories.next(),
        nodeName: name,
      });
      worlds.set(name, started);
      await started.store.seedIfEmpty();
      return started;
    };

    const joinHub = async (name: NodeName): Promise<void> => {
      await world(name).transport.becomeClient(hubAddress, {
        selfNodeId: nodeIdOf(name),
        hubNodeId: nodeIdOf('node1'),
      });
      await until(async () => {
        const transport = (await status(world(name))).transport;
        return transport.role === 'client' && transport.connectedToHub;
      });
    };

    const connectedNodes = async (): Promise<void> => {
      const hub = await startNode('node1');
      await hub.transport.becomeHub('127.0.0.1:0', {
        selfNodeId: nodeIdOf('node1'),
        hubNodeId: nodeIdOf('node1'),
      });
      hubAddress = `127.0.0.1:${hub.transport.boundPort()}`;
      for (const name of ['node2', 'node3'] as const) {
        await startNode(name);
        await joinHub(name);
      }
      await until(async () => {
        const transport = (await status(hub)).transport;
        return transport.role === 'hub' && transport.connectedClients === 2;
      });
    };

    const upload = async (on: NodeName): Promise<SpeciesResponse> => {
      const response = await world(on).server.inject({
        method: 'POST',
        url: '/api/species/duck/image',
        headers: { 'content-type': 'image/png' },
        payload: uploadedPng,
      });
      expect(response.statusCode).toBe(200);
      const version = response.json<SpeciesResponse>();
      expect(version.imageUrl).toBe(`/api/species/${version.hash}/image`);
      return version;
    };

    const currentDuckHash = async (on: NodeName): Promise<string | undefined> =>
      (await world(on).server.inject({ method: 'GET', url: '/api/species' }))
        .json<SpeciesResponse[]>()
        .find((species) => species.id === 'duck')?.hash;

    const servesUploadedBytes = async (
      on: NodeName,
      imageUrl: string,
    ): Promise<boolean> => {
      const response = await world(on).server.inject({
        method: 'GET',
        url: imageUrl,
      });
      return (
        response.statusCode === 200 &&
        response.headers['content-type'] === 'image/png' &&
        response.rawPayload.equals(uploadedPng)
      );
    };

    const lastTransferWith = async (
      on: NodeName,
      peer: NodeName,
    ): Promise<SyncTransfer | undefined> =>
      (
        await world(on).server.inject({
          method: 'GET',
          url: `/api/sync/transfers?peer=${nodeIdOf(peer)}&limit=10`,
        })
      ).json<SyncTransfer[]>()[0];

    const expectTransferWithBlob = async (
      on: NodeName,
      peer: NodeName,
      version: SpeciesResponse,
    ): Promise<void> => {
      await until(
        async () => (await lastTransferWith(on, peer))?.status === 'completed',
      );
      expect(await lastTransferWith(on, peer)).toMatchObject({
        direction: 'incoming',
        peerNodeId: nodeIdOf(peer),
        changeSetId: expect.stringMatching(
          /^update-species-image-duck-/,
        ) as string,
        tables: { species: 1, speciesInsertHistory: 1 },
        blobs: [{ blobId: blobIdOf(uploadedPng), bytes: uploadedPng.length }],
        status: 'completed',
      });
      expect(await world(on).store.hasLocalBlob(blobIdOf(uploadedPng))).toBe(
        true,
      );
      expect(await currentDuckHash(on)).toBe(version.hash);
    };

    Scenario(
      'A species image uploaded to node1 renders on node3 within five seconds',
      ({ Given, When, Then, And }) => {
        let version: SpeciesResponse;

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
          },
        );

        When(
          'a PNG is uploaded as the image of the species "duck" on node1',
          async () => {
            version = await upload('node1');
          },
        );

        Then(
          'node3 lists that species version as current within five seconds',
          async () => {
            await until(
              async () => (await currentDuckHash('node3')) === version.hash,
            );
          },
        );

        And(
          "node3 serves the same bytes at the new version's image URL as image/png",
          async () => {
            expect(await servesUploadedBytes('node3', version.imageUrl)).toBe(
              true,
            );
            expect(await servesUploadedBytes('node2', version.imageUrl)).toBe(
              true,
            );
          },
        );

        And(
          "node3's last transfer with node1 lists the blob with its size",
          async () => {
            await expectTransferWithBlob('node3', 'node1', version);
            await expectTransferWithBlob('node2', 'node1', version);
          },
        );
      },
    );

    Scenario(
      'A node that joins after the upload receives the image with the catch-up',
      ({ Given, When, Then, And }) => {
        let version: SpeciesResponse;

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
          },
        );

        And('node3 has left the network', async () => {
          await world('node3').transport.becomeStandalone();
          await until(async () => {
            const transport = (await status(world('node1'))).transport;
            return transport.role === 'hub' && transport.connectedClients === 1;
          });
        });

        When(
          'a PNG is uploaded as the image of the species "duck" on node1',
          async () => {
            version = await upload('node1');
            await until(
              async () => (await currentDuckHash('node2')) === version.hash,
            );
            expect(await currentDuckHash('node3')).not.toBe(version.hash);
          },
        );

        And('node3 joins the hub again', async () => {
          await joinHub('node3');
        });

        Then(
          "node3 serves the same bytes at the new version's image URL within ten seconds",
          async () => {
            await until(
              async () => (await currentDuckHash('node3')) === version.hash,
              10_000,
            );
            expect(await servesUploadedBytes('node3', version.imageUrl)).toBe(
              true,
            );
          },
        );

        And(
          "node3's last transfer with node1 lists the blob with its size",
          async () => {
            await expectTransferWithBlob('node3', 'node1', version);
            expect((await status(world('node3'))).sync.catchUp).toMatchObject({
              missingAtStart: 1,
              pulled: 1,
            });
          },
        );
      },
    );

    Scenario(
      'A node that holds the version without its blob fetches the image on demand',
      ({ Given, When, Then, And }) => {
        let version: SpeciesResponse;

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
          },
        );

        And(
          'a PNG uploaded as the image of the species "duck" on node1 has reached node3',
          async () => {
            version = await upload('node1');
            await until(
              async () => (await currentDuckHash('node3')) === version.hash,
            );
            await until(() =>
              world('node3').store.hasLocalBlob(blobIdOf(uploadedPng)),
            );
          },
        );

        When("node3's blob store loses the image", async () => {
          await world('node3').store.blobs.deleteBlob(blobIdOf(uploadedPng));
          expect(
            await world('node3').store.hasLocalBlob(blobIdOf(uploadedPng)),
          ).toBe(false);
        });

        Then(
          "node3 serves the same bytes at the new version's image URL again and holds the blob once more",
          async () => {
            expect(await servesUploadedBytes('node3', version.imageUrl)).toBe(
              true,
            );
            expect(
              await world('node3').store.hasLocalBlob(blobIdOf(uploadedPng)),
            ).toBe(true);
          },
        );
      },
    );
  });
});
