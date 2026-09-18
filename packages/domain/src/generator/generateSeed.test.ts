import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import {
  BaseValidator,
  Validate,
  type Rljson,
  type TableCfg,
} from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { animalTraitsTableCfg } from '../tables/animalTraits.ts';
import { animalsTableCfg } from '../tables/animals.ts';
import { breedersTableCfg } from '../tables/breeders.ts';
import { customersTableCfg } from '../tables/customers.ts';
import { invoiceItemsTableCfg } from '../tables/invoiceItems.ts';
import { invoicesTableCfg } from '../tables/invoices.ts';
import { personsTableCfg } from '../tables/persons.ts';
import { speciesTableCfg } from '../tables/species.ts';
import { traitsTableCfg } from '../tables/traits.ts';
import {
  generateSeed,
  generatedSeedFor,
  handWrittenSeedBase,
  seedChangeSetId,
  type GeneratedSeed,
} from './generateSeed.ts';
import { seedPlans, type GeneratedCounts } from './seedSizes.ts';
import { storyLength } from './stories.ts';

const tableCfgs: Record<keyof GeneratedSeed, TableCfg> = {
  species: speciesTableCfg,
  traits: traitsTableCfg,
  persons: personsTableCfg,
  breeders: breedersTableCfg,
  customers: customersTableCfg,
  animals: animalsTableCfg,
  animalTraits: animalTraitsTableCfg,
  invoices: invoicesTableCfg,
  invoiceItems: invoiceItemsTableCfg,
};

const tableKeys = Object.keys(tableCfgs) as (keyof GeneratedSeed)[];

const medium = seedPlans.medium.generated!;
const large = seedPlans.large.generated!;

const tinyCounts: GeneratedCounts = {
  species: 2,
  traits: 3,
  animals: 12,
  customers: 4,
  breeders: 3,
  breederCustomers: 1,
  invoices: 6,
  invoiceItems: 13,
};

/**
 * The hand-written seed plus the generated rows as one rljson document
 * with every table pointing at its configuration, the shape in which
 * `BaseValidator` resolves every reference column against its target
 * table and checks every column type (`docs/findings/db-basics.md`).
 */
const wholeDocument = (generated: GeneratedSeed): Rljson => {
  const document: Rljson = {
    tableCfgs: hashed({
      _type: 'tableCfgs',
      _data: tableKeys.map((table) => tableCfgs[table]),
    }),
  };
  for (const table of tableKeys) {
    const baseRows =
      table in handWrittenSeedBase
        ? handWrittenSeedBase[table as keyof typeof handWrittenSeedBase]
        : [];
    document[table] = hashed({
      _type: 'components',
      _tableCfg: hashed(tableCfgs[table])._hash,
      _data: [...baseRows, ...generated[table]] as Json[],
    });
  }
  return document;
};

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

const tableHash = (rows: readonly Json[]): string =>
  hashed({ _type: 'components', _data: [...rows] })._hash;

const generatedIdPattern = /^[a-z0-9]+(-[a-z0-9]+)*-\d+$/;

describe('generateSeed', () => {
  const generated = generateSeed(tinyCounts);

  it('produces the asked-for number of rows per table', () => {
    expect(generated.species).toHaveLength(tinyCounts.species);
    expect(generated.traits).toHaveLength(tinyCounts.traits);
    expect(generated.persons).toHaveLength(
      tinyCounts.breeders + tinyCounts.customers - tinyCounts.breederCustomers,
    );
    expect(generated.breeders).toHaveLength(tinyCounts.breeders);
    expect(generated.customers).toHaveLength(tinyCounts.customers);
    expect(generated.animals).toHaveLength(tinyCounts.animals);
    expect(generated.invoices).toHaveLength(tinyCounts.invoices);
    expect(generated.invoiceItems).toHaveLength(tinyCounts.invoiceItems);
  });

  it('is deterministic: the same seed gives the same hashes, another seed does not', () => {
    const again = generateSeed(tinyCounts);
    const other = generateSeed(tinyCounts, { seed: 'mouseton' });

    expect(again).toStrictEqual(generated);
    expect(other.animals.map((row) => row._hash)).not.toStrictEqual(
      generated.animals.map((row) => row._hash),
    );
    expect(other.species.map((row) => row.id)).toStrictEqual(
      generated.species.map((row) => row.id),
    );
  });

  it('gives every row a slug id with a running number, unique per table and distinct from the hand-written ids', () => {
    const handWrittenIds = new Set(
      Object.values(handWrittenSeedBase).flatMap((rows) =>
        rows.map((row) => row.id),
      ),
    );
    for (const table of tableKeys) {
      const ids = generated[table].map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(handWrittenIds.has(id)).toBe(false);
      }
      if (
        table !== 'invoices' &&
        table !== 'invoiceItems' &&
        table !== 'animalTraits'
      ) {
        for (const id of ids) {
          expect(id).toMatch(generatedIdPattern);
        }
      }
    }
    expect(generated.species[0].id).toBe('goose-1');
    expect(generated.traits[0].id).toBe('night-owl-1');
  });

  it('makes exactly the asked-for number of breeders customers too, through a shared person', () => {
    const breederPersons = new Set(
      generated.breeders.map((row) => row.personRef),
    );
    const shared = generated.customers.filter((row) =>
      breederPersons.has(row.personRef),
    );

    expect(shared).toHaveLength(tinyCounts.breederCustomers);
    for (const customer of generated.customers) {
      expect(
        generated.persons.some((person) => person._hash === customer.personRef),
      ).toBe(true);
    }
  });

  it('continues the customer numbers after the hand-written ones without gaps', () => {
    const first = handWrittenSeedBase.customers.length + 1;

    expect(generated.customers.map((row) => row.customerNumber)).toStrictEqual(
      Array.from(
        { length: tinyCounts.customers },
        (_, index) => `C-${String(first + index).padStart(4, '0')}`,
      ),
    );
  });

  it('gives every animal one to four traits in canonical order, a junction row per trait, a price and a birth date', () => {
    const traitsById = new Map(
      [...handWrittenSeedBase.traits, ...generated.traits].map((trait) => [
        trait._hash,
        trait,
      ]),
    );
    for (const animal of generated.animals) {
      expect(animal.traitsRefs.length).toBeGreaterThanOrEqual(1);
      expect(animal.traitsRefs.length).toBeLessThanOrEqual(4);
      const traitIds = animal.traitsRefs.map(
        (traitRef) => traitsById.get(traitRef)!.id,
      );
      expect(traitIds).toStrictEqual([...traitIds].sort());
      expect(animal.priceCents % 100).toBe(0);
      expect(animal.priceCents).toBeGreaterThanOrEqual(1500);
      expect(animal.bornOn).toMatch(/^20(1[5-9]|2[0-5])-\d{2}-\d{2}$/);
      const junctionRows = generated.animalTraits.filter(
        (row) => row.animalRef === animal._hash,
      );
      expect(junctionRows.map((row) => row.traitRef).sort()).toStrictEqual(
        [...animal.traitsRefs].sort(),
      );
      for (const row of junctionRows) {
        expect(row.id).toBe(
          `${animal.id}--${traitsById.get(row.traitRef)!.id}`,
        );
      }
    }
  });

  it('writes a story within the length bounds that names the animal, its species, one of its traits and its breeder', () => {
    const speciesByHash = new Map(
      [...handWrittenSeedBase.species, ...generated.species].map((row) => [
        row._hash,
        row,
      ]),
    );
    const breedersByHash = new Map(
      [...handWrittenSeedBase.breeders, ...generated.breeders].map((row) => [
        row._hash,
        row,
      ]),
    );
    const traitsByHash = new Map(
      [...handWrittenSeedBase.traits, ...generated.traits].map((row) => [
        row._hash,
        row,
      ]),
    );
    for (const animal of generated.animals) {
      const story = animal.backgroundStory;
      expect(story.length).toBeGreaterThanOrEqual(storyLength.minimum);
      expect(story.length).toBeLessThanOrEqual(storyLength.maximum);
      expect(story).toContain(animal.name);
      expect(story).toContain(
        speciesByHash.get(animal.speciesRef)!.name.toLowerCase(),
      );
      expect(story).toContain(breedersByHash.get(animal.breederRef)!.farmName);
      expect(
        animal.traitsRefs.some((traitRef) =>
          story.includes(`"${traitsByHash.get(traitRef)!.name}"`),
        ),
      ).toBe(true);
    }
  });

  it('issues invoices with running numbers per year, a share of them open and some cancelled', () => {
    const numbers = generated.invoices.map((row) => row.invoiceNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    const sequencesByYear = new Map<string, number[]>();
    for (const invoice of generated.invoices) {
      expect(invoice.issuedOn).toMatch(/^202[3-5]-\d{2}-\d{2}$/);
      expect(
        invoice.invoiceNumber.startsWith(invoice.issuedOn.slice(0, 4)),
      ).toBe(true);
      const year = invoice.issuedOn.slice(0, 4);
      sequencesByYear.set(year, [
        ...(sequencesByYear.get(year) ?? []),
        Number(invoice.invoiceNumber.slice(5)),
      ]);
    }
    for (const sequences of sequencesByYear.values()) {
      expect(sequences).toStrictEqual(
        Array.from({ length: sequences.length }, (_, index) => index + 1),
      );
    }
    const statuses = new Set(generated.invoices.map((row) => row.status));
    const mediumStatuses = new Set(
      generatedSeedFor('medium')!.invoices.map((row) => row.status),
    );
    expect([...statuses].every((status) => mediumStatuses.has(status))).toBe(
      true,
    );
    expect(mediumStatuses).toStrictEqual(
      new Set(['open', 'paid', 'cancelled']),
    );
  });

  it("gives every invoice one to four lines, each selling one animal at the animal's own price", () => {
    const animalsByHash = new Map(
      [...handWrittenSeedBase.animals, ...generated.animals].map((row) => [
        row._hash,
        row,
      ]),
    );
    for (const invoice of generated.invoices) {
      const items = generated.invoiceItems.filter(
        (item) => item.invoiceRef === invoice._hash,
      );
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeLessThanOrEqual(4);
      expect(items.map((item) => item.id)).toStrictEqual(
        items.map((_, index) => `${invoice.id}-item-${index + 1}`),
      );
      const soldAnimals = new Set(items.map((item) => item.animalRef));
      expect(soldAnimals.size).toBe(items.length);
      for (const item of items) {
        expect(item.quantity).toBeGreaterThanOrEqual(1);
        expect(item.quantity).toBeLessThanOrEqual(3);
        expect(item.unitPriceCents).toBe(
          animalsByHash.get(item.animalRef)!.priceCents,
        );
      }
    }
  });

  it('lets generated rows reference hand-written rows too', () => {
    const handWrittenSpecies = new Set(
      handWrittenSeedBase.species.map((row) => row._hash),
    );
    const handWrittenAnimals = new Set(
      handWrittenSeedBase.animals.map((row) => row._hash),
    );
    const mediumSeed = generatedSeedFor('medium')!;

    expect(
      mediumSeed.animals.some((row) => handWrittenSpecies.has(row.speciesRef)),
    ).toBe(true);
    expect(
      mediumSeed.invoiceItems.some((row) =>
        handWrittenAnimals.has(row.animalRef),
      ),
    ).toBe(true);
  });

  it('refuses counts the pools or the line bounds cannot serve', () => {
    expect(() => generateSeed({ ...tinyCounts, species: 1000 })).toThrow(
      /species pool/,
    );
    expect(() => generateSeed({ ...tinyCounts, traits: 1000 })).toThrow(
      /trait pool/,
    );
    expect(() =>
      generateSeed({ ...tinyCounts, invoices: 4, invoiceItems: 3 }),
    ).toThrow(/cannot be spread/);
    expect(() =>
      generateSeed({ ...tinyCounts, invoices: 2, invoiceItems: 9 }),
    ).toThrow(/cannot be spread/);
  });
});

describe('seedChangeSetId', () => {
  it('names the table and the row', () => {
    expect(seedChangeSetId('species', 'goose-1')).toBe('seed-species-goose-1');
  });
});

describe('generatedSeedFor', () => {
  it('generates nothing for none and small', () => {
    expect(generatedSeedFor('none')).toBeNull();
    expect(generatedSeedFor('small')).toBeNull();
  });

  it.each([
    ['medium', medium],
    ['large', large],
  ] as const)('generates the counts of the %s plan', (size, counts) => {
    const generated = generatedSeedFor(size)!;

    expect(generated.species).toHaveLength(counts.species);
    expect(generated.traits).toHaveLength(counts.traits);
    expect(generated.animals).toHaveLength(counts.animals);
    expect(generated.customers).toHaveLength(counts.customers);
    expect(generated.breeders).toHaveLength(counts.breeders);
    expect(generated.invoices).toHaveLength(counts.invoices);
    expect(generated.invoiceItems).toHaveLength(counts.invoiceItems);
  });

  it('produces the golden hashes of the medium seed', () => {
    const generated = generatedSeedFor('medium')!;

    expect(
      Object.fromEntries(
        tableKeys.map((table) => [
          table,
          {
            first: generated[table][0]._hash,
            table: tableHash(generated[table]),
          },
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "animalTraits": {
          "first": "RSM7IKasX1s9VCfFvsS-Zb",
          "table": "2mF4lxC2KWoiNb61WSub2z",
        },
        "animals": {
          "first": "XfEB_qN5tOctOASD7WjTEu",
          "table": "9X44XdoR798gOsC0ShXrm7",
        },
        "breeders": {
          "first": "8GT-_byx4jUaaRFWbzyKaj",
          "table": "6X-bWwqFM0pr5VkVJxwX5Y",
        },
        "customers": {
          "first": "AAIjFCAe1HfPFvXwDjAIlD",
          "table": "vSKTojRzrGzTDuDhga8Vn2",
        },
        "invoiceItems": {
          "first": "RoUkOFVZIxq4g2vrs-dycI",
          "table": "UXtV0xz4f-TAKI3SAE0WjM",
        },
        "invoices": {
          "first": "ogYnCYmn_umRvXQjZkuC56",
          "table": "OM-dLyTjzWRGrkIOq9vN09",
        },
        "persons": {
          "first": "N8thw_muh61tY6J91PLEVY",
          "table": "t5VQbXWlc_pvCAwzKW_ORF",
        },
        "species": {
          "first": "9fmPgNK8hYM5NcQ117ZpmD",
          "table": "lwu0X_Uz7njv8Uwz8Hdya6",
        },
        "traits": {
          "first": "co85HYwjuuE6VYQuziFgoF",
          "table": "x7AqBBCjj0WgR_mBnjpvWd",
        },
      }
    `);
  });

  it('produces the golden hashes of the large seed', () => {
    const generated = generatedSeedFor('large')!;

    expect(
      Object.fromEntries(
        tableKeys.map((table) => [
          table,
          {
            first: generated[table][0]._hash,
            table: tableHash(generated[table]),
          },
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "animalTraits": {
          "first": "vCFe7PWriCBRwSsh-YHJUe",
          "table": "p93eVuJJDfOlZX7-3C1CFK",
        },
        "animals": {
          "first": "TYYPAhopR979iHSe7wR1PG",
          "table": "gq5gdqCTCq1Wx4gY9CqyOl",
        },
        "breeders": {
          "first": "Pyv2pgKvTTMYpvX0oWieNc",
          "table": "cO8v9oiZLq-PNve0Mw5OYn",
        },
        "customers": {
          "first": "MeDUiwUOMMcMtUN8Hx5std",
          "table": "-SDY5pX0vtGtW-TseZSjZU",
        },
        "invoiceItems": {
          "first": "ffgfWc_y_NABYG5vNLbDrw",
          "table": "uTA8GexSuMY8A5tsaOeO3C",
        },
        "invoices": {
          "first": "wzwRmDyHoxc_ZgA_0y7AL8",
          "table": "JpC8xtutnHDIyuJXF2ezC5",
        },
        "persons": {
          "first": "bSGILEDaWBFJTeejqsjipo",
          "table": "PqZjThEacXnWN7vQzg0rre",
        },
        "species": {
          "first": "9fmPgNK8hYM5NcQ117ZpmD",
          "table": "c-qKZTokqSyXIe8DbBpq56",
        },
        "traits": {
          "first": "co85HYwjuuE6VYQuziFgoF",
          "table": "cLoi3HrAlEHY79OhoGwnI3",
        },
      }
    `);
  });

  it('resolves every reference of the medium seed against the hand-written seed and itself', async () => {
    const errors = await validationErrors(
      wholeDocument(generatedSeedFor('medium')!),
    );

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when a generated reference is broken', async () => {
    const generated = generatedSeedFor('medium')!;
    const [firstItem, ...otherItems] = generated.invoiceItems;
    const broken: GeneratedSeed = {
      ...generated,
      invoiceItems: [
        hashed({ ...rmhsh(firstItem), animalRef: 'no-such-animal' }),
        ...otherItems,
      ],
    };

    const errors = await validationErrors(wholeDocument(broken));

    expect(errors).toMatchObject({ base: { hasErrors: true } });
  });

  it('resolves every reference of the large seed', async () => {
    const errors = await validationErrors(
      wholeDocument(generatedSeedFor('large')!),
    );

    expect(errors).toStrictEqual({});
  });
});
