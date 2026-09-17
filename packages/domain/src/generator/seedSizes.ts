/**
 * The sizes a node can be seeded with (`SEED_SIZE`, roadmap section 2.4).
 * `none` leaves every table empty, `small` is the hand-written Duckburg
 * seed alone, `medium` and `large` add generated rows on top of it: the
 * hand-written seed stays the core of every size because its stories and
 * arcs are the point of the project, and the generated rows exist to make
 * the tables big enough to observe what rljson does at volume.
 */
export const seedSizes = ['none', 'small', 'medium', 'large'] as const;

export type SeedSize = (typeof seedSizes)[number];

export const isSeedSize = (value: string): value is SeedSize =>
  (seedSizes as readonly string[]).includes(value);

/**
 * How many rows the generator adds per table for one size. Persons are not
 * listed: the generator creates one person per breeder and per customer,
 * minus the breeders who are also customers, which is `breederCustomers`
 * of them. `invoiceItems` is exact: the items are spread over the invoices
 * so that the totals meet and no invoice has fewer than one or more than
 * four lines.
 */
export type GeneratedCounts = {
  species: number;
  traits: number;
  animals: number;
  customers: number;
  breeders: number;
  breederCustomers: number;
  invoices: number;
  invoiceItems: number;
};

/**
 * What one size consists of: whether the hand-written seed is loaded, and
 * what the generator adds, `null` when nothing is generated.
 */
export type SeedPlan = {
  handWritten: boolean;
  generated: GeneratedCounts | null;
};

export const seedPlans: Readonly<Record<SeedSize, SeedPlan>> = {
  none: { handWritten: false, generated: null },
  small: { handWritten: true, generated: null },
  medium: {
    handWritten: true,
    generated: {
      species: 10,
      traits: 15,
      animals: 100,
      customers: 30,
      breeders: 10,
      breederCustomers: 5,
      invoices: 200,
      invoiceItems: 400,
    },
  },
  large: {
    handWritten: true,
    generated: {
      species: 50,
      traits: 40,
      animals: 2000,
      customers: 300,
      breeders: 50,
      breederCustomers: 25,
      invoices: 5000,
      invoiceItems: 12000,
    },
  },
};
