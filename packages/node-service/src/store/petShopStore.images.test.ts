import { BsMem, type Bs } from '@rljson/bs';
import {
  blobIdOf,
  hashed,
  speciesImage,
  speciesImageMimeType,
  speciesSeed,
  speciesTableCfg,
  type HashedChangeSetRow,
  type SpeciesRow,
} from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordingLogger } from '../testing/recordingLogger.ts';
import {
  storageKinds,
  testStore,
  useTemporaryDataDirectories,
} from '../testing/testStores.ts';
import {
  BlobMismatchError,
  speciesImagePath,
  type PetShopStore,
  type SpeciesImageLookup,
} from './petShopStore.ts';

const dataDirectories = useTemporaryDataDirectories();

const blobIdsOf = async (store: PetShopStore): Promise<string[]> =>
  (await store.blobs.listBlobs()).blobs.map((blob) => blob.blobId).sort();

const seededBlobIds = [...speciesSeed]
  .map((species) => species.imageBlobId)
  .sort();

const [duck] = speciesSeed;

/** The three bytes of a JPEG start, enough for an upload the store accepts. */
const uploadedJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

const found = (lookup: SpeciesImageLookup) => {
  expect(lookup.outcome).toBe('found');
  return lookup.outcome === 'found' ? lookup.image : undefined;
};

/**
 * A blob store standing in for the multi of the hub transport: what the
 * test puts into it is "what the network holds", and it counts the
 * reads.
 */
const networkBlobs = (): { multi: Bs; store: BsMem; reads: string[] } => {
  const store = new BsMem();
  const reads: string[] = [];
  const multi: Bs = {
    ...store,
    setBlob: (content) => store.setBlob(content),
    getBlob: (blobId, options) => {
      reads.push(blobId);
      return store.getBlob(blobId, options);
    },
    getBlobStream: (blobId) => store.getBlobStream(blobId),
    deleteBlob: (blobId) => store.deleteBlob(blobId),
    blobExists: (blobId) => store.blobExists(blobId),
    getBlobProperties: (blobId) => store.getBlobProperties(blobId),
    listBlobs: (options) => store.listBlobs(options),
    generateSignedUrl: (blobId, expiresIn, permissions) =>
      store.generateSignedUrl(blobId, expiresIn, permissions),
  };
  return { multi, store, reads };
};

describe.each(storageKinds)('over the %s store', (storage) => {
  describe('species images', () => {
    let store: PetShopStore;
    let blobs: BsMem;

    beforeEach(async () => {
      blobs = new BsMem();
      store = await testStore(
        { storage, dataDirectory: dataDirectories.next() },
        { blobs },
      );
    });

    afterEach(async () => {
      await store.close();
    });

    it('stores one blob per seeded species under the id the species row names', async () => {
      await store.seedIfEmpty();

      expect(await blobIdsOf(store)).toStrictEqual(seededBlobIds);
      expect(blobs.size).toBe(3);
    });

    it('stores nothing when the store already holds rows', async () => {
      await store.seedIfEmpty();
      await store.seedIfEmpty();

      expect(blobs.size).toBe(3);
    });

    it('keeps one blob when the same image is stored twice', async () => {
      await store.seedIfEmpty();

      const again = await store.blobs.setBlob(
        Buffer.from(speciesImage(duck.id)),
      );

      expect(again.blobId).toBe(duck.imageBlobId);
      expect(blobs.size).toBe(3);
    });

    it('serves the PNG and media type of a species version by its hash without storing anything new', async () => {
      await store.seedIfEmpty();

      const image = found(await store.speciesImage(duck._hash));

      expect(image?.mimeType).toBe(speciesImageMimeType);
      expect(image?.content).toStrictEqual(Buffer.from(speciesImage('duck')));
      expect(blobs.size).toBe(3);
    });

    it('answers unknown-version for an unknown hash and for a hash that is no hash', async () => {
      await store.seedIfEmpty();

      for (const hash of ['NoSuchSpeciesVersion00', 'not a hash', '']) {
        expect(await store.speciesImage(hash)).toStrictEqual({
          outcome: 'unknown-version',
        });
      }
    });

    it('renders and stores the image again when the blob store lost it', async () => {
      await store.seedIfEmpty();
      await blobs.deleteBlob(duck.imageBlobId);
      expect(blobs.size).toBe(2);

      const image = found(await store.speciesImage(duck._hash));

      expect(image?.content).toStrictEqual(Buffer.from(speciesImage('duck')));
      expect(blobs.size).toBe(3);
      expect(await blobs.blobExists(duck.imageBlobId)).toBe(true);
    });

    it('links every animal to the image of its species version', async () => {
      await store.seedIfEmpty();

      const { items } = await store.listAnimals();
      const detail = await store.getAnimal(items[0]!.id);

      for (const animal of items) {
        const species = speciesSeed.find(
          (candidate) => candidate.id === animal.speciesId,
        );
        expect(animal.speciesImageUrl).toBe(speciesImagePath(species!._hash));
      }
      expect(detail?.speciesImageUrl).toBe(items[0]!.speciesImageUrl);
      expect(speciesImagePath(duck._hash)).toBe(
        `/api/species/${duck._hash}/image`,
      );
    });

    it('answers unavailable with a warning for a version whose blob nobody holds and nothing renders', async () => {
      const { logger, records } = recordingLogger();
      const uploaded = hashed({
        id: 'griffin',
        name: 'Griffin',
        latinName: 'Gryphus fabulosus',
        description: 'Half eagle, half lion, entirely a customs problem.',
        imageBlobId: 'AnIdNoRendererProduces',
        imageMimeType: 'image/jpeg',
      } satisfies SpeciesRow);
      await store.close();
      store = await testStore(
        { storage, dataDirectory: dataDirectories.next() },
        { blobs, logger },
      );
      await store.writeReceivedRows([
        { table: speciesTableCfg.key, row: uploaded },
      ]);

      const lookup = await store.speciesImage(uploaded._hash);

      expect(lookup).toStrictEqual({
        outcome: 'unavailable',
        blobId: 'AnIdNoRendererProduces',
        reason: 'no node holds the blob',
      });
      expect(blobs.size).toBe(0);
      expect(records).toMatchObject([
        {
          level: 'warn',
          fields: {
            speciesId: 'griffin',
            speciesHash: uploaded._hash,
            imageBlobId: 'AnIdNoRendererProduces',
            reason: 'no node holds the blob',
          },
        },
      ]);
    });

    describe('uploading', () => {
      it('writes a new species version naming the uploaded bytes, chained to the current one, with a change set', async () => {
        await store.seedIfEmpty();
        const changeSets: HashedChangeSetRow[] = [];
        const entityIds: string[][] = [];
        store.onChangeSetWritten((changeSet, ids) => {
          changeSets.push(changeSet);
          entityIds.push([...ids]);
        });

        const version = await store.updateSpeciesImage(
          'duck',
          uploadedJpeg,
          'image/jpeg',
        );

        expect(version).toMatchObject({
          id: 'duck',
          name: duck.name,
          latinName: duck.latinName,
          description: duck.description,
          imageBlobId: blobIdOf(uploadedJpeg),
          imageMimeType: 'image/jpeg',
        });
        expect(version!._hash).not.toBe(duck._hash);
        expect(await blobs.blobExists(blobIdOf(uploadedJpeg))).toBe(true);
        expect(blobs.size).toBe(4);
        const listed = await store.listSpecies();
        expect(listed.find((row) => row.id === 'duck')?._hash).toBe(
          version!._hash,
        );
        expect(listed).toHaveLength(3);
        expect(changeSets).toHaveLength(1);
        expect(changeSets[0]).toMatchObject({
          id: expect.stringMatching(
            /^update-species-image-duck-\d+:/,
          ) as string,
          items: [
            { table: 'species', ref: version!._hash },
            {
              table: 'speciesInsertHistory',
              ref: expect.any(String) as string,
            },
          ],
        });
        expect(entityIds).toStrictEqual([['duck']]);
        expect(await store.holdsChangeSet(changeSets[0]!._hash)).toBe(true);
        const payload = await store.changeSetPayload(changeSets[0]!._hash);
        expect(payload?.items[0]).toMatchObject({
          row: { imageBlobId: blobIdOf(uploadedJpeg) },
          previousRow: { imageBlobId: duck.imageBlobId },
        });
        expect(payload?.items[1]?.row).toMatchObject({
          speciesRef: version!._hash,
          previous: [expect.stringMatching(/:seed$/) as string],
        });
      });

      it('serves the uploaded bytes with their media type at the new version and the badge at the old one', async () => {
        await store.seedIfEmpty();

        const version = await store.updateSpeciesImage(
          'duck',
          uploadedJpeg,
          'image/jpeg',
        );

        expect(found(await store.speciesImage(version!._hash))).toStrictEqual({
          content: uploadedJpeg,
          mimeType: 'image/jpeg',
        });
        expect(found(await store.speciesImage(duck._hash))).toStrictEqual({
          content: Buffer.from(speciesImage('duck')),
          mimeType: speciesImageMimeType,
        });
      });

      it('writes no second version for the bytes the current version names already', async () => {
        await store.seedIfEmpty();
        const first = await store.updateSpeciesImage(
          'duck',
          uploadedJpeg,
          'image/jpeg',
        );
        const changeSets: HashedChangeSetRow[] = [];
        store.onChangeSetWritten((changeSet) => changeSets.push(changeSet));

        const second = await store.updateSpeciesImage(
          'duck',
          Buffer.from(uploadedJpeg),
          'image/jpeg',
        );

        expect(second).toStrictEqual(first);
        expect(changeSets).toStrictEqual([]);
        expect(blobs.size).toBe(4);
        expect(await store.localIo.rowCount('speciesInsertHistory')).toBe(4);
      });

      it('chains two uploads of one species instead of branching them', async () => {
        await store.seedIfEmpty();
        const png = Buffer.from(speciesImage('griffin'));

        const [first, second] = await Promise.all([
          store.updateSpeciesImage('duck', uploadedJpeg, 'image/jpeg'),
          store.updateSpeciesImage('duck', png, 'image/png'),
        ]);

        expect(first?.imageBlobId).toBe(blobIdOf(uploadedJpeg));
        expect(second?.imageBlobId).toBe(blobIdOf(png));
        const listed = await store.listSpecies();
        expect(listed.find((row) => row.id === 'duck')?._hash).toBe(
          second!._hash,
        );
        expect(listed).toHaveLength(3);
      });

      it('answers undefined for an unknown species and writes nothing', async () => {
        await store.seedIfEmpty();

        expect(
          await store.updateSpeciesImage('unicorn', uploadedJpeg, 'image/jpeg'),
        ).toBeUndefined();

        expect(blobs.size).toBe(3);
        expect(await store.localIo.rowCount('species')).toBe(3);
      });
    });

    describe('pulling blobs through the network', () => {
      it('reads a blob the network holds, checks it and caches it locally', async () => {
        const network = networkBlobs();
        const content = Buffer.from('a photo of a duck, allegedly');
        const { blobId } = await network.store.setBlob(content);
        store.fetchBlobsThrough(() => network.multi);

        expect(await store.hasLocalBlob(blobId)).toBe(false);
        expect(await store.pullBlob(blobId)).toStrictEqual({
          content,
          source: 'network',
        });
        expect(await store.hasLocalBlob(blobId)).toBe(true);
        expect(await store.pullBlob(blobId)).toStrictEqual({
          content,
          source: 'local',
        });
        expect(network.reads).toStrictEqual([blobId]);
      });

      it('answers undefined for a blob nobody holds, for no cascade and for an id that is no id', async () => {
        const network = networkBlobs();
        expect(await store.pullBlob('NoSuchBlobAnywhere0000')).toBeUndefined();
        store.fetchBlobsThrough(() => network.multi);
        expect(await store.pullBlob('NoSuchBlobAnywhere0000')).toBeUndefined();
        expect(await store.pullBlob('not an id')).toBeUndefined();
        store.fetchBlobsThrough(() => undefined);
        expect(await store.pullBlob('NoSuchBlobAnywhere0000')).toBeUndefined();
        expect(network.reads).toStrictEqual([]);
      });

      it('refuses bytes that hash to another id and keeps the id empty', async () => {
        const network = networkBlobs();
        const wrong = Buffer.from('not what was asked for');
        await network.store.setBlob(wrong);
        const asked = blobIdOf(Buffer.from('what was asked for'));
        const lying: Bs = {
          ...network.multi,
          blobExists: async () => true,
          getBlob: async () => network.store.getBlob(blobIdOf(wrong)),
        };
        store.fetchBlobsThrough(() => lying);

        await expect(store.pullBlob(asked)).rejects.toThrow(
          new BlobMismatchError(asked, blobIdOf(wrong)),
        );
        expect(await store.hasLocalBlob(asked)).toBe(false);
      });

      it('reports a network that could not answer as an error', async () => {
        const failing: Bs = {
          ...networkBlobs().multi,
          blobExists: async () => {
            throw new Error('BsPeer: socket closed');
          },
        };
        store.fetchBlobsThrough(() => failing);

        await expect(store.pullBlob(duck.imageBlobId)).rejects.toThrow(
          `the network could not serve blob ${duck.imageBlobId}: BsPeer: socket closed`,
        );
      });

      it('serves an uploaded image of a received version from the network, then locally', async () => {
        const network = networkBlobs();
        const { blobId } = await network.store.setBlob(uploadedJpeg);
        const received = hashed({
          id: 'duck',
          name: duck.name,
          latinName: duck.latinName,
          description: duck.description,
          imageBlobId: blobId,
          imageMimeType: 'image/jpeg',
        } satisfies SpeciesRow);
        await store.writeReceivedRows([
          { table: speciesTableCfg.key, row: received },
        ]);
        store.fetchBlobsThrough(() => network.multi);

        expect(found(await store.speciesImage(received._hash))).toStrictEqual({
          content: uploadedJpeg,
          mimeType: 'image/jpeg',
        });
        expect(await store.hasLocalBlob(blobId)).toBe(true);
        expect(found(await store.speciesImage(received._hash))).toStrictEqual({
          content: uploadedJpeg,
          mimeType: 'image/jpeg',
        });
        expect(network.reads).toStrictEqual([blobId]);
      });

      it('gives up on the network after the configured time and renders a seed image instead', async () => {
        const { logger, records } = recordingLogger();
        const hanging: Bs = {
          ...networkBlobs().multi,
          blobExists: () => new Promise(() => undefined),
        };
        await store.close();
        store = await testStore(
          { storage, dataDirectory: dataDirectories.next() },
          { blobs, logger, blobPullTimeoutMs: 50 },
        );
        await store.seedIfEmpty();
        await blobs.deleteBlob(duck.imageBlobId);
        store.fetchBlobsThrough(() => hanging);
        const received = hashed({
          id: 'griffin',
          name: 'Griffin',
          latinName: 'Gryphus fabulosus',
          description: 'Half eagle, half lion, entirely a customs problem.',
          imageBlobId: blobIdOf(uploadedJpeg),
          imageMimeType: 'image/jpeg',
        } satisfies SpeciesRow);
        await store.writeReceivedRows([
          { table: speciesTableCfg.key, row: received },
        ]);

        const started = performance.now();
        const seeded = found(await store.speciesImage(duck._hash));
        const uploaded = await store.speciesImage(received._hash);

        expect(performance.now() - started).toBeLessThan(2_000);
        expect(seeded?.content).toStrictEqual(
          Buffer.from(speciesImage('duck')),
        );
        expect(uploaded).toStrictEqual({
          outcome: 'unavailable',
          blobId: blobIdOf(uploadedJpeg),
          reason: `pull of blob ${blobIdOf(uploadedJpeg)} exceeded 50 ms`,
        });
        expect(records.map((record) => record.level)).toStrictEqual(['warn']);
      });
    });
  });
});

describe('over the sqlite store', () => {
  it('serves the seeded images after a restart that lost the in-memory blobs', async () => {
    const location = {
      storage: 'sqlite' as const,
      dataDirectory: dataDirectories.next(),
    };
    const first = await testStore(location, { blobs: new BsMem() });
    await first.seedIfEmpty();
    await first.close();

    const restarted = new BsMem();
    const second = await testStore(location, { blobs: restarted });
    try {
      expect(await second.seedIfEmpty()).toMatchObject({ speciesSeeded: 0 });
      expect(restarted.size).toBe(0);

      const lookup = await second.speciesImage(duck._hash);

      expect(found(lookup)?.content).toStrictEqual(
        Buffer.from(speciesImage('duck')),
      );
      expect(await blobIdsOf(second)).toStrictEqual([duck.imageBlobId]);
    } finally {
      await second.close();
    }
  });
});
