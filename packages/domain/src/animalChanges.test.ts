import { describe, expect, it } from 'vitest';

import {
  animalChangeProblems,
  editableAnimalFields,
  updateAnimalChangeSetId,
} from './animalChanges.ts';

describe('animalChangeProblems', () => {
  it('accepts a change of every editable field', () => {
    expect(
      animalChangeProblems({
        name: 'Donald the Fourth',
        speciesId: 'duck',
        breederId: 'grandma-ducks-farm',
        bornOn: '2024-02-29',
        priceCents: 0,
        backgroundStory: '',
        traitIds: ['fiercely-loyal', 'competitive-streak'],
      }),
    ).toStrictEqual([]);
  });

  it('accepts a single field', () => {
    expect(animalChangeProblems({ priceCents: 12345 })).toStrictEqual([]);
  });

  it('rejects a request that names no field', () => {
    expect(animalChangeProblems({})).toStrictEqual([
      'The request names no editable field.',
    ]);
  });

  it('rejects a field that is not editable and names the editable ones', () => {
    expect(animalChangeProblems({ price: 100 })).toStrictEqual([
      `"price" is not an editable field of an animal; editable fields are ${editableAnimalFields.join(', ')}.`,
    ]);
  });

  it.each([
    ['an empty name', { name: '   ' }, 'The name must not be empty.'],
    ['a name that is not text', { name: 7 }, 'The name must not be empty.'],
    [
      'a negative price',
      { priceCents: -1 },
      'The price must be a whole number of cents, at least 0.',
    ],
    [
      'a fractional price',
      { priceCents: 10.5 },
      'The price must be a whole number of cents, at least 0.',
    ],
    [
      'a price that is not a number',
      { priceCents: '100' },
      'The price must be a whole number of cents, at least 0.',
    ],
    [
      'a birth date in the wrong format',
      { bornOn: '31.05.2024' },
      'The birth date must be a calendar date such as 2024-05-31.',
    ],
    [
      'a birth date that does not exist',
      { bornOn: '2023-02-29' },
      'The birth date must be a calendar date such as 2024-05-31.',
    ],
    [
      'a birth date that is not text',
      { bornOn: 20240531 },
      'The birth date must be a calendar date such as 2024-05-31.',
    ],
    [
      'a story that is not text',
      { backgroundStory: null },
      'The background story must be text.',
    ],
    [
      'an empty species id',
      { speciesId: '' },
      'The species id must not be empty.',
    ],
    [
      'an empty breeder id',
      { breederId: '' },
      'The breeder id must not be empty.',
    ],
    [
      'traits that are not a list',
      { traitIds: 'fiercely-loyal' },
      'The traits must be a list of trait ids.',
    ],
    [
      'a trait list with an empty id',
      { traitIds: ['fiercely-loyal', ''] },
      'The traits must be a list of trait ids.',
    ],
    [
      'a trait list that repeats an id',
      { traitIds: ['fiercely-loyal', 'fiercely-loyal'] },
      'The traits must not repeat a trait id.',
    ],
  ])('rejects %s', (_description, changes, message) => {
    expect(animalChangeProblems(changes)).toStrictEqual([message]);
  });

  it('reports every problem of a request at once', () => {
    expect(
      animalChangeProblems({ name: '', priceCents: -5, colour: 'blue' }),
    ).toHaveLength(3);
  });
});

describe('updateAnimalChangeSetId', () => {
  it('names the operation, the animal and the version', () => {
    expect(
      updateAnimalChangeSetId('donald-the-third', '1789654560431:2zH9'),
    ).toBe('update-animal-donald-the-third-1789654560431:2zH9');
  });
});
