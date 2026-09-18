import { BsMem } from '@rljson/bs';
import {
  hashed,
  speciesImage,
  speciesImageBlobId,
  speciesImageMimeType,
  speciesSeed,
  speciesTableCfg,
  type SpeciesRow,
} from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordingLogger } from '../testing/recordingLogger.ts';
import {
  storageKinds,
  testStore,
  useTemporaryDataDirectories,
} from '../testing/testStores.ts';
import { speciesImagePath, type PetShopStore } from './petShopStore.ts';

const dataDirectories = useTemporaryDataDirectories();

const blobIdsOf = async (store: PetShopStore): Promise<string[]> =>
  (await store.blobs.listBlobs()).blobs.map((blob) => blob.blobId).sort();

const seededBlobIds = [...speciesSeed]
  .map((species) => species.imageBlobId)
  .sort();

const [duck] = speciesSeed;

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

      const image = await store.speciesImage(duck._hash);

      expect(image?.mimeType).toBe(speciesImageMimeType);
      expect(image?.content).toStrictEqual(Buffer.from(speciesImage('duck')));
      expect(blobs.size).toBe(3);
    });

    it('answers undefined for an unknown hash and for a hash that is no hash', async () => {
      await store.seedIfEmpty();

      expect(
        await store.speciesImage('NoSuchSpeciesVersion00'),
      ).toBeUndefined();
      expect(await store.speciesImage('not a hash')).toBeUndefined();
      expect(await store.speciesImage('')).toBeUndefined();
    });

    it('renders and stores the image again when the blob store lost it', async () => {
      await store.seedIfEmpty();
      await blobs.deleteBlob(duck.imageBlobId);
      expect(blobs.size).toBe(2);

      const image = await store.speciesImage(duck._hash);

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

    it('serves the rendered image with a warning for a row that names another blob id', async () => {
      const { logger, records } = recordingLogger();
      const stale = hashed({
        id: 'griffin',
        name: 'Griffin',
        latinName: 'Gryphus fabulosus',
        description: 'Half eagle, half lion, entirely a customs problem.',
        imageBlobId: 'AnIdNoRendererProduces',
        imageMimeType: 'image/webp',
      } satisfies SpeciesRow);
      await store.close();
      store = await testStore(
        { storage, dataDirectory: dataDirectories.next() },
        { blobs, logger },
      );
      await store.writeReceivedRows([
        { table: speciesTableCfg.key, row: stale },
      ]);

      const image = await store.speciesImage(stale._hash);

      expect(image?.mimeType).toBe(speciesImageMimeType);
      expect(image?.content).toStrictEqual(
        Buffer.from(speciesImage('griffin')),
      );
      expect(await blobs.blobExists(speciesImageBlobId('griffin'))).toBe(true);
      expect(records).toMatchObject([
        {
          level: 'warn',
          fields: {
            speciesId: 'griffin',
            imageBlobId: 'AnIdNoRendererProduces',
            renderedBlobId: speciesImageBlobId('griffin'),
          },
        },
      ]);
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

      const image = await second.speciesImage(duck._hash);

      expect(image?.content).toStrictEqual(Buffer.from(speciesImage('duck')));
      expect(await blobIdsOf(second)).toStrictEqual([duck.imageBlobId]);
    } finally {
      await second.close();
    }
  });
});
