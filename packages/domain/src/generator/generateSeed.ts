import { hashed } from '../hashing.ts';
import {
  invoiceId,
  invoiceItemId,
  invoiceNumber,
} from '../invoiceNumbering.ts';
import { animalsSeed } from '../seed/animals.ts';
import { breedersSeed } from '../seed/breeders.ts';
import { customersSeed } from '../seed/customers.ts';
import { personsSeed } from '../seed/persons.ts';
import { speciesSeed } from '../seed/species.ts';
import { traitsSeed } from '../seed/traits.ts';
import {
  animalTraitId,
  type HashedAnimalTraitRow,
} from '../tables/animalTraits.ts';
import { traitsRefsOf, type HashedAnimalRow } from '../tables/animals.ts';
import type { HashedBreederRow } from '../tables/breeders.ts';
import type { HashedCustomerRow } from '../tables/customers.ts';
import type { HashedInvoiceItemRow } from '../tables/invoiceItems.ts';
import type { HashedInvoiceRow, InvoiceStatus } from '../tables/invoices.ts';
import type { HashedPersonRow } from '../tables/persons.ts';
import type { HashedSpeciesRow } from '../tables/species.ts';
import type { HashedTraitRow } from '../tables/traits.ts';
import {
  animalEpithets,
  animalNames,
  cities,
  duckburgRegulars,
  farmKinds,
  firstNames,
  streets,
  surnames,
} from './namePools.ts';
import { createRandomSource, type RandomSource } from './randomSource.ts';
import { seedPlans, type GeneratedCounts, type SeedSize } from './seedSizes.ts';
import { generatedId, slugOf } from './slug.ts';
import { speciesPool } from './speciesPool.ts';
import { generateStory } from './stories.ts';
import { traitPool } from './traitPool.ts';

/**
 * The rows that already exist when the generator runs and that generated
 * rows may reference: a generated animal can belong to a hand-written
 * species or breeder, a generated invoice can sell a hand-written animal to
 * a hand-written customer. Customer numbers continue after the last one in
 * `customers`. By default this is the hand-written seed.
 */
export type SeedBase = {
  species: readonly HashedSpeciesRow[];
  traits: readonly HashedTraitRow[];
  persons: readonly HashedPersonRow[];
  breeders: readonly HashedBreederRow[];
  customers: readonly HashedCustomerRow[];
  animals: readonly HashedAnimalRow[];
};

export const handWrittenSeedBase: SeedBase = {
  species: speciesSeed,
  traits: traitsSeed,
  persons: personsSeed,
  breeders: breedersSeed,
  customers: customersSeed,
  animals: animalsSeed,
};

/**
 * What the generator produces: hashed rows per table, in the order the
 * tables reference each other (`animals` after `species`, `breeders` and
 * `traits`; `invoiceItems` after `invoices` and `animals`), so a store can
 * write them top to bottom and every reference resolves. `animalTraits`
 * holds one junction row per generated animal and trait, derived exactly
 * as `animalTraitsSeed` derives the hand-written ones.
 */
export type GeneratedSeed = {
  species: HashedSpeciesRow[];
  traits: HashedTraitRow[];
  persons: HashedPersonRow[];
  breeders: HashedBreederRow[];
  customers: HashedCustomerRow[];
  animals: HashedAnimalRow[];
  animalTraits: HashedAnimalTraitRow[];
  invoices: HashedInvoiceRow[];
  invoiceItems: HashedInvoiceItemRow[];
};

export type GenerateSeedOptions = {
  /** The random seed; the same seed and counts give the same rows. */
  seed?: string;
  base?: SeedBase;
};

export const defaultRandomSeed = 'duckburg';

/**
 * The first and last calendar day the generator draws a date from, per
 * date column. Generated invoices are dated before the hand-written ones
 * (all in 2026), so the hand-written invoices stay the newest of the seed
 * and an invoice issued through the API today gets the next number of the
 * current year without colliding with a generated one.
 */
const dateRanges = {
  suppliesSince: ['1975-01-01', '2024-12-31'],
  bornOn: ['2015-01-01', '2025-12-31'],
  issuedOn: ['2023-01-01', '2025-12-31'],
} as const;

const dayInMilliseconds = 24 * 60 * 60 * 1000;

const isoDateOf = (date: Date): string => date.toISOString().slice(0, 10);

const dateBetween = (
  random: RandomSource,
  [first, last]: readonly [string, string],
): string => {
  const firstDay = Date.parse(`${first}T00:00:00Z`);
  const lastDay = Date.parse(`${last}T00:00:00Z`);
  const days = Math.round((lastDay - firstDay) / dayInMilliseconds);
  return isoDateOf(
    new Date(firstDay + random.integerBelow(days + 1) * dayInMilliseconds),
  );
};

const takeFromPool = <Template>(
  pool: readonly Template[],
  count: number,
  poolName: string,
): Template[] => {
  if (count > pool.length) {
    throw new RangeError(
      `The ${poolName} pool holds ${pool.length} entries, ${count} were asked for.`,
    );
  }
  return pool.slice(0, count);
};

const generateSpecies = (
  count: number,
  random: RandomSource,
): HashedSpeciesRow[] =>
  takeFromPool(speciesPool, count, 'species').map((template, index) =>
    hashed({
      id: generatedId(template.name, index + 1),
      name: template.name,
      latinName: template.latinName,
      description: `${template.knownFor} The ${template.name.toLowerCase()} (${template.latinName}) has been on the shop's list since ${random.integerBetween(1950, 2020)}, when ${random.pick(duckburgRegulars)} first asked for one.`,
    }),
  );

const generateTraits = (count: number): HashedTraitRow[] =>
  takeFromPool(traitPool, count, 'trait').map((template, index) =>
    hashed({
      id: generatedId(template.name, index + 1),
      name: template.name,
      description: template.description,
    }),
  );

type GeneratedPerson = {
  row: HashedPersonRow;
  surname: string;
};

const generatePersons = (
  count: number,
  random: RandomSource,
): GeneratedPerson[] =>
  Array.from({ length: count }, (_, index) => {
    const firstName = random.pick(firstNames);
    const surname = random.pick(surnames);
    const number = index + 1;
    return {
      surname,
      row: hashed({
        id: generatedId(`${firstName} ${surname}`, number),
        name: `${firstName} ${surname}`,
        street: `${random.pick(streets)} ${random.integerBetween(1, 199)}`,
        city: random.pick(cities),
        email: `${slugOf(firstName)}.${slugOf(surname)}.${number}@duckburg.example`,
      }),
    };
  });

const farmNameOf = (surname: string, random: RandomSource): string => {
  const kind = random.pick(farmKinds);
  return random.chance(0.5) ? `${surname}'s ${kind}` : `${surname} ${kind}`;
};

const generateBreeders = (
  persons: readonly GeneratedPerson[],
  random: RandomSource,
): HashedBreederRow[] =>
  persons.map((person, index) => {
    const farmName = farmNameOf(person.surname, random);
    return hashed({
      id: generatedId(farmName, index + 1),
      personRef: person.row._hash,
      farmName,
      suppliesSince: dateBetween(random, dateRanges.suppliesSince),
    });
  });

const customerNumberOf = (position: number): string =>
  `C-${String(position).padStart(4, '0')}`;

const generateCustomers = (
  persons: readonly GeneratedPerson[],
  firstCustomerPosition: number,
): HashedCustomerRow[] =>
  persons.map((person, index) =>
    hashed({
      id: generatedId(person.row.name, index + 1),
      personRef: person.row._hash,
      customerNumber: customerNumberOf(firstCustomerPosition + index),
    }),
  );

const animalNameOf = (random: RandomSource): string => {
  const name = random.pick(animalNames);
  return random.chance(0.35) ? `${name} ${random.pick(animalEpithets)}` : name;
};

type ReferencePools = {
  species: readonly HashedSpeciesRow[];
  traits: readonly HashedTraitRow[];
  breeders: readonly HashedBreederRow[];
  personsByHash: ReadonlyMap<string, HashedPersonRow>;
};

const generateAnimals = (
  count: number,
  pools: ReferencePools,
  random: RandomSource,
): { animals: HashedAnimalRow[]; animalTraits: HashedAnimalTraitRow[] } => {
  const animals: HashedAnimalRow[] = [];
  const animalTraits: HashedAnimalTraitRow[] = [];

  for (let index = 0; index < count; index += 1) {
    const name = animalNameOf(random);
    const species = random.pick(pools.species);
    const breeder = random.pick(pools.breeders);
    const person = pools.personsByHash.get(breeder.personRef);
    if (person === undefined) {
      throw new Error(
        `The breeder "${breeder.id}" references a person no seed holds.`,
      );
    }
    const traits = random.sample(pools.traits, random.integerBetween(1, 4));
    const animal = hashed({
      id: generatedId(name, index + 1),
      name,
      speciesRef: species._hash,
      breederRef: breeder._hash,
      bornOn: dateBetween(random, dateRanges.bornOn),
      priceCents: random.integerBetween(15, 900) * 100,
      backgroundStory: generateStory(
        {
          name,
          speciesName: species.name,
          traits,
          farmName: breeder.farmName,
          breederPersonName: person.name,
        },
        random,
      ),
      traitsRefs: traitsRefsOf(traits),
    });
    animals.push(animal);
    for (const trait of traits) {
      animalTraits.push(
        hashed({
          id: animalTraitId(animal.id, trait.id),
          animalRef: animal._hash,
          traitRef: trait._hash,
        }),
      );
    }
  }

  return { animals, animalTraits };
};

/**
 * How many lines each invoice gets, adding up to exactly `items` over
 * `invoices` invoices with every count between one and four: an even
 * spread first, then half of the neighbouring pairs trade one line so the
 * counts vary, then a shuffle so the variety is not tied to the invoice
 * order.
 */
const itemCountsFor = (
  invoices: number,
  items: number,
  random: RandomSource,
): number[] => {
  if (items < invoices || items > invoices * 4) {
    throw new RangeError(
      `${items} items cannot be spread over ${invoices} invoices with one to four lines each.`,
    );
  }
  const base = Math.floor(items / invoices);
  const extra = items - base * invoices;
  const counts = Array.from({ length: invoices }, (_, index) =>
    index < extra ? base + 1 : base,
  );
  for (let index = 0; index + 1 < counts.length; index += 2) {
    if (counts[index] > 1 && counts[index + 1] < 4 && random.chance(0.5)) {
      counts[index] -= 1;
      counts[index + 1] += 1;
    }
  }
  return random.shuffle(counts);
};

const invoiceStatusOf = (random: RandomSource): InvoiceStatus => {
  const fraction = random.nextFraction();
  if (fraction < 0.2) {
    return 'open';
  }
  return fraction < 0.25 ? 'cancelled' : 'paid';
};

const quantityOf = (random: RandomSource): number => {
  const fraction = random.nextFraction();
  if (fraction < 0.8) {
    return 1;
  }
  return fraction < 0.95 ? 2 : 3;
};

type InvoiceDraft = {
  customer: HashedCustomerRow;
  issuedOn: string;
  status: InvoiceStatus;
  lines: { animal: HashedAnimalRow; quantity: number }[];
};

const generateInvoices = (
  counts: Pick<GeneratedCounts, 'invoices' | 'invoiceItems'>,
  customers: readonly HashedCustomerRow[],
  animals: readonly HashedAnimalRow[],
  random: RandomSource,
): { invoices: HashedInvoiceRow[]; invoiceItems: HashedInvoiceItemRow[] } => {
  const itemCounts = itemCountsFor(
    counts.invoices,
    counts.invoiceItems,
    random,
  );
  const drafts: InvoiceDraft[] = itemCounts.map((itemCount) => ({
    customer: random.pick(customers),
    issuedOn: dateBetween(random, dateRanges.issuedOn),
    status: invoiceStatusOf(random),
    lines: random
      .sample(animals, itemCount)
      .map((animal) => ({ animal, quantity: quantityOf(random) })),
  }));
  // Sorting by date lets the invoice numbers run in issue order per year,
  // exactly as invoices issued one after another through the API would.
  drafts.sort((left, right) => left.issuedOn.localeCompare(right.issuedOn));

  const sequenceByYear = new Map<string, number>();
  const invoices: HashedInvoiceRow[] = [];
  const invoiceItems: HashedInvoiceItemRow[] = [];
  for (const draft of drafts) {
    const year = draft.issuedOn.slice(0, 4);
    const sequence = (sequenceByYear.get(year) ?? 0) + 1;
    sequenceByYear.set(year, sequence);
    const number = invoiceNumber(draft.issuedOn, sequence);
    const invoice = hashed({
      id: invoiceId(number),
      invoiceNumber: number,
      customerRef: draft.customer._hash,
      issuedOn: draft.issuedOn,
      status: draft.status,
    });
    invoices.push(invoice);
    for (const [position, line] of draft.lines.entries()) {
      invoiceItems.push(
        hashed({
          id: invoiceItemId(number, position + 1),
          invoiceRef: invoice._hash,
          animalRef: line.animal._hash,
          quantity: line.quantity,
          unitPriceCents: line.animal.priceCents,
        }),
      );
    }
  }

  return { invoices, invoiceItems };
};

/**
 * Generates the rows one seed size adds on top of the hand-written seed:
 * deterministic for the same counts, seed and base, so every node computes
 * the same hashes. Species and traits come from fixed pools in pool order;
 * persons, farms, addresses, animal names, dates, prices, traits per
 * animal, stories and invoices are drawn from the seeded random source.
 * `breederCustomers` of the persons are both a breeder and a customer.
 * Generated animals belong to any species, breeder and trait of the base
 * or the generated rows; generated invoices sell any animal of either to
 * any customer of either.
 */
export const generateSeed = (
  counts: GeneratedCounts,
  options: GenerateSeedOptions = {},
): GeneratedSeed => {
  const base = options.base ?? handWrittenSeedBase;
  const random = createRandomSource(options.seed ?? defaultRandomSeed);

  const species = generateSpecies(counts.species, random);
  const traits = generateTraits(counts.traits);
  const persons = generatePersons(
    counts.breeders + counts.customers - counts.breederCustomers,
    random,
  );
  const breeders = generateBreeders(persons.slice(0, counts.breeders), random);
  const customers = generateCustomers(
    persons.slice(counts.breeders - counts.breederCustomers),
    base.customers.length + 1,
  );
  const personRows = persons.map((person) => person.row);
  const { animals, animalTraits } = generateAnimals(
    counts.animals,
    {
      species: [...base.species, ...species],
      traits: [...base.traits, ...traits],
      breeders: [...base.breeders, ...breeders],
      personsByHash: new Map(
        [...base.persons, ...personRows].map((person) => [
          person._hash,
          person,
        ]),
      ),
    },
    random,
  );
  const { invoices, invoiceItems } = generateInvoices(
    counts,
    [...base.customers, ...customers],
    [...base.animals, ...animals],
    random,
  );

  return {
    species,
    traits,
    persons: personRows,
    breeders,
    customers,
    animals,
    animalTraits,
    invoices,
    invoiceItems,
  };
};

/**
 * The generated part of one seed size on top of the hand-written seed, or
 * `null` for a size that generates nothing (`none`, `small`).
 */
export const generatedSeedFor = (
  size: SeedSize,
  options: GenerateSeedOptions = {},
): GeneratedSeed | null => {
  const counts = seedPlans[size].generated;
  return counts === null ? null : generateSeed(counts, options);
};
