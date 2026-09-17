import {
  animalTraitsSeed,
  animalsSeed,
  traitsSeed,
} from '@rljson-tryout/domain';
import type {
  HashedAnimalRow,
  HashedAnimalTraitRow,
  HashedTraitRow,
} from '@rljson-tryout/domain';
import { describe, expect, it } from 'vitest';

import {
  JunctionTraitRelation,
  MultiReferenceTraitRelation,
} from './traitRelation.ts';

describe('MultiReferenceTraitRelation and JunctionTraitRelation', () => {
  it('agree on the traits of every seeded animal', () => {
    const multiReference = new MultiReferenceTraitRelation(
      animalsSeed,
      traitsSeed,
    );
    const junction = new JunctionTraitRelation(animalTraitsSeed, traitsSeed);

    for (const animal of animalsSeed) {
      const fromMultiReference = multiReference
        .traitIdsOfAnimal(animal._hash)
        .sort();
      const fromJunction = junction.traitIdsOfAnimal(animal._hash).sort();

      expect(fromJunction).toStrictEqual(fromMultiReference);
      expect(fromMultiReference).toStrictEqual(
        [...animal.traitsRefs]
          .map(
            (traitRef) =>
              traitsSeed.find((trait) => trait._hash === traitRef)?.id,
          )
          .sort(),
      );
    }
  });

  it('agree on the animals carrying every seeded trait', () => {
    const multiReference = new MultiReferenceTraitRelation(
      animalsSeed,
      traitsSeed,
    );
    const junction = new JunctionTraitRelation(animalTraitsSeed, traitsSeed);

    for (const trait of traitsSeed) {
      const fromMultiReference = multiReference
        .animalHashesWithTrait(trait._hash)
        .sort();
      const fromJunction = junction.animalHashesWithTrait(trait._hash).sort();

      expect(fromJunction).toStrictEqual(fromMultiReference);
      expect(fromMultiReference.length).toBeGreaterThan(0);
    }
  });

  it('report no traits and no animals for an unknown hash', () => {
    const multiReference = new MultiReferenceTraitRelation(
      animalsSeed,
      traitsSeed,
    );
    const junction = new JunctionTraitRelation(animalTraitsSeed, traitsSeed);

    expect(
      multiReference.traitIdsOfAnimal('no-such-animal-hash'),
    ).toStrictEqual([]);
    expect(junction.traitIdsOfAnimal('no-such-animal-hash')).toStrictEqual([]);
    expect(
      multiReference.animalHashesWithTrait('no-such-trait-hash'),
    ).toStrictEqual([]);
    expect(junction.animalHashesWithTrait('no-such-trait-hash')).toStrictEqual(
      [],
    );
  });

  describe('a dangling trait reference', () => {
    const trait: HashedTraitRow = {
      _hash: 'trait-hash',
      id: 'trait-id',
      name: 'Trait',
      description: 'A single trait for this test.',
    };
    const traits: readonly HashedTraitRow[] = [trait];

    it('is left out of MultiReferenceTraitRelation.traitIdsOfAnimal', () => {
      const animal: HashedAnimalRow = {
        _hash: 'animal-hash',
        id: 'animal-id',
        name: 'Animal',
        speciesRef: 'species-hash',
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story.',
        traitsRefs: [trait._hash, 'no-such-trait-hash'],
      };
      const relation = new MultiReferenceTraitRelation([animal], traits);

      expect(relation.traitIdsOfAnimal(animal._hash)).toStrictEqual([trait.id]);
    });

    it('is left out of JunctionTraitRelation.traitIdsOfAnimal', () => {
      const rows: readonly HashedAnimalTraitRow[] = [
        {
          _hash: 'row-1-hash',
          id: 'animal-id--trait-id',
          animalRef: 'animal-hash',
          traitRef: trait._hash,
        },
        {
          _hash: 'row-2-hash',
          id: 'animal-id--dangling',
          animalRef: 'animal-hash',
          traitRef: 'no-such-trait-hash',
        },
      ];
      const relation = new JunctionTraitRelation(rows, traits);

      expect(relation.traitIdsOfAnimal('animal-hash')).toStrictEqual([
        trait.id,
      ]);
    });
  });
});
