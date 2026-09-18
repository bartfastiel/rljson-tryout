import { describe, expect, it } from 'vitest';

import { speciesSeed } from '../seed/species.ts';
import { blobReferenceColumnsOf, blobReferencesOf } from './blobReferences.ts';

describe('blobReferenceColumnsOf', () => {
  it('names the image blob id of the species table and nothing else', () => {
    expect(blobReferenceColumnsOf('species')).toStrictEqual(['imageBlobId']);
    for (const table of [
      'animals',
      'traits',
      'persons',
      'breeders',
      'customers',
      'invoices',
      'invoiceItems',
      'animalTraits',
      'changeSets',
      'speciesInsertHistory',
      'no-such-table',
    ]) {
      expect(blobReferenceColumnsOf(table)).toStrictEqual([]);
    }
  });
});

describe('blobReferencesOf', () => {
  it('reads the image blob id off a species row', () => {
    const [duck] = speciesSeed;
    expect(blobReferencesOf('species', duck)).toStrictEqual([duck.imageBlobId]);
  });

  it('answers nothing for a row of a table without blob columns', () => {
    expect(
      blobReferencesOf('animals', { imageBlobId: 'abc', name: 'Donald' }),
    ).toStrictEqual([]);
  });

  it('skips values that are not a blob id', () => {
    expect(blobReferencesOf('species', {})).toStrictEqual([]);
    expect(blobReferencesOf('species', { imageBlobId: '' })).toStrictEqual([]);
    expect(blobReferencesOf('species', { imageBlobId: 42 })).toStrictEqual([]);
    expect(blobReferencesOf('species', { imageBlobId: null })).toStrictEqual(
      [],
    );
  });
});
