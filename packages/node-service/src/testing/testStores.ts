import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IoMem } from '@rljson/io';
import { afterAll, beforeAll } from 'vitest';

import type { StorageKind } from '../configuration.ts';
import { createIo } from '../store/createIo.ts';
import {
  PetShopStore,
  type PetShopStoreOptions,
} from '../store/petShopStore.ts';
import { silentLogger } from './testServer.ts';

/**
 * Every `STORAGE` value the store tests and the Gherkin features run
 * against, for `describe.each`: the same scenario must hold over the
 * in-memory store and over a SQLite file (`docs/findings/stores.md`).
 */
export const storageKinds: readonly StorageKind[] = ['memory', 'sqlite'];

/**
 * A store over a fresh `IoMem`, initialized, for tests that exercise the
 * routes or the server rather than the storage: they run once, over the
 * in-memory store.
 */
export const memoryStore = async (
  options: PetShopStoreOptions = {},
): Promise<PetShopStore> => {
  const store = new PetShopStore(new IoMem(), options);
  await store.initialize();
  return store;
};

/**
 * The SQLite files of one test file: a temporary directory created before
 * the file's tests and removed after them, with a fresh subdirectory per
 * store so that no two stores of the file share a database. Returned as a
 * function because the directory only exists between the hooks. The
 * removal retries because Windows keeps a just-closed database file
 * locked for a moment (`docs/findings/stores.md`).
 */
export type TemporaryDataDirectories = {
  next: () => string;
};

export const useTemporaryDataDirectories = (): TemporaryDataDirectories => {
  let root: string | undefined;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'rljson-tryout-store-'));
  });

  afterAll(() => {
    if (root !== undefined) {
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
      root = undefined;
    }
  });

  return {
    next: () => {
      if (root === undefined) {
        throw new Error(
          'useTemporaryDataDirectories must be called inside a test file, before its tests run',
        );
      }
      return join(root, randomUUID());
    },
  };
};

/**
 * What `testStore` needs to build a store of one kind: the kind itself,
 * and, for `sqlite`, where the database file goes. The `Io` comes from the
 * production factory `createIo`, so a test exercises the same construction
 * path as `main.ts`.
 */
export type TestStoreLocation = {
  storage: StorageKind;
  dataDirectory: string;
};

/**
 * A store of the given kind at the given location, initialized. Two calls
 * with the same `sqlite` location open the same file, which is how a test
 * simulates a restart: close the first store, build a second one.
 */
export const testStore = async (
  location: TestStoreLocation,
  options: PetShopStoreOptions = {},
): Promise<PetShopStore> => {
  const store = new PetShopStore(createIo(location, silentLogger()), options);
  await store.initialize();
  return store;
};
