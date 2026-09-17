import { Db } from '@rljson/db';
import type { Io } from '@rljson/io';
import {
  Route,
  timeId,
  type BuffetsTable,
  type ComponentsTable,
  type InsertHistoryTable,
  type TableCfg,
} from '@rljson/rljson';
import {
  animalChangeProblems,
  animalTraitId,
  animalTraitsInsertHistoryTableCfg,
  animalTraitsSeed,
  animalTraitsTableCfg,
  animalsInsertHistoryTableCfg,
  animalsSeed,
  animalsTableCfg,
  breedersInsertHistoryTableCfg,
  breedersSeed,
  breedersTableCfg,
  changeSetsInsertHistoryTableCfg,
  changeSetsTableCfg,
  currentRows,
  customersInsertHistoryTableCfg,
  customersSeed,
  customersTableCfg,
  hashed,
  invoiceId,
  invoiceItemId,
  invoiceItemsInsertHistoryTableCfg,
  invoiceItemsTableCfg,
  invoiceNumber,
  invoicesInsertHistoryTableCfg,
  invoicesSeed,
  invoicesTableCfg,
  issueInvoiceChangeSetId,
  nextInvoiceSequence,
  personsInsertHistoryTableCfg,
  personsSeed,
  personsTableCfg,
  speciesInsertHistoryTableCfg,
  speciesSeed,
  speciesTableCfg,
  traitsInsertHistoryTableCfg,
  traitsRefsOf,
  traitsSeed,
  traitsTableCfg,
  updateAnimalChangeSetId,
  versionsOf,
  type AnimalChanges,
  type ChangeSetItem,
  type HashedAnimalRow,
  type HashedAnimalTraitRow,
  type HashedBreederRow,
  type HashedChangeSetRow,
  type HashedCustomerRow,
  type HashedInvoiceItemRow,
  type HashedInvoiceRow,
  type HashedPersonRow,
  type HashedSpeciesRow,
  type HashedTraitRow,
  type InvoiceStatus,
  type VersionHistoryRow,
} from '@rljson-tryout/domain';

import {
  JunctionTraitRelation,
  MultiReferenceTraitRelation,
  type TraitRelation,
  type TraitRelationMode,
} from './traitRelation.ts';

const changeSetsRoute = Route.fromFlat(changeSetsTableCfg.key);

/**
 * One trait as an animal carries it, resolved through the configured
 * `TraitRelation` to the trait's stable `id` and current `name`. Used both
 * by `PetShopStore.listTraits` (every trait in the store) and as the shape
 * of `AnimalDetail.traits` (the traits one animal carries).
 */
export type TraitSummary = {
  id: string;
  name: string;
};

/**
 * One trait version as `PetShopStore.listTraits` returns it: the full
 * `traits` row plus its `_hash`, the identity of this exact version.
 */
export type Trait = {
  id: string;
  hash: string;
  name: string;
  description: string;
};

/**
 * The person behind a breeder, as `PetShopStore.listBreeders` joins it in:
 * just the fields roadmap section 2.5's `GET /api/breeders` documents,
 * never the street or email a breeder card has no use for. `null` for the
 * store-integrity case of a breeder whose `personRef` does not resolve to a
 * person in the store, the same tolerance `AnimalWithSpecies.speciesName`
 * already has for a dangling `speciesRef`.
 */
export type BreederPerson = {
  id: string;
  name: string;
  city: string;
};

/**
 * One breeder version as `PetShopStore.listBreeders` returns it, in the
 * shape `GET /api/breeders` serves (roadmap section 2.5): the full
 * `breeders` row plus its `_hash` and the person it belongs to, already
 * joined.
 */
export type Breeder = {
  id: string;
  hash: string;
  farmName: string;
  suppliesSince: string;
  person: BreederPerson | null;
};

/**
 * The breeder behind an animal, as `PetShopStore.getAnimal` joins it in for
 * the detail view's facts block: the breeder's own `id` and `farmName` plus
 * the supplying person's `name` (as `personName`) and `city`. `personName`
 * and `city` are `null` when the breeder's own `personRef` does not resolve,
 * the same tolerance `BreederPerson` already has.
 */
export type AnimalBreeder = {
  id: string;
  farmName: string;
  personName: string | null;
  city: string | null;
};

/**
 * One animal as `PetShopStore.listAnimals` returns it: the fields a caller
 * needs to show a card, with the referenced species and breeder already
 * resolved so the caller never has to look `speciesRef` or `breederRef` up
 * itself. `speciesId`, `speciesName`, `breederId` and `breederFarmName` are
 * `null` for the store-integrity case of an animal whose reference does not
 * resolve to a row in the store, rather than the method failing the whole
 * list for one broken row. Traits are used to filter this list
 * (`AnimalFilter.traitId`) but never appear in it themselves, so the list
 * stays as light as `backgroundStory` already keeps it; only `AnimalDetail`
 * carries them, and only `AnimalDetail` carries the full breeder (person
 * name and city included), per roadmap section 2.5.
 */
export type AnimalWithSpecies = {
  id: string;
  hash: string;
  name: string;
  speciesId: string | null;
  speciesName: string | null;
  breederId: string | null;
  breederFarmName: string | null;
  bornOn: string;
  priceCents: number;
};

/**
 * Narrows a filter for `listAnimals` to the animals of one species, one
 * breeder and, or, one trait. All three narrow the same list and combine
 * with a logical AND.
 */
export type AnimalFilter = {
  speciesId?: string;
  breederId?: string;
  traitId?: string;
};

/**
 * One animal as `PetShopStore.getAnimal` returns it: everything
 * `AnimalWithSpecies` has, plus the full `backgroundStory`, the traits this
 * animal carries (resolved to their `id` and `name` through the configured
 * `TraitRelation`) and its breeder (resolved to `id`, `farmName`, the
 * supplying person's name and city). `GET /api/animals` never includes
 * these fields so that the list stays light; only the detail endpoint does
 * (roadmap section 2.5). A trait reference that does not resolve to a
 * stored trait is left out of `traits` rather than failing the whole
 * request, the same tolerance `speciesId` and `speciesName` already have
 * for a dangling `speciesRef`; `breeder` is `null` for the same reason when
 * `breederRef` does not resolve to a breeder in the store.
 */
export type AnimalDetail = AnimalWithSpecies & {
  backgroundStory: string;
  traits: TraitSummary[];
  breeder: AnimalBreeder | null;
};

/**
 * One version of an animal as `PetShopStore.getAnimalHistory` lists it, in
 * the shape `GET /api/animals/:id/history` serves (roadmap section 2.5):
 * the version's `hash`, the `timeId` of the InsertHistory row that wrote
 * it, the `timeId`s in that row's `previous`, whether the version is
 * `current` (a tip of the animal's DAG, `docs/findings/entity-versions.md`),
 * and the fields a history list compares between versions. References are
 * resolved to stable ids the way the list does (`null` for a reference
 * that does not resolve); the story is reported by its length only, since
 * the full text of every version is what `GET /api/animals/:id?version=`
 * is for.
 */
export type AnimalVersion = {
  hash: string;
  timeId: string;
  previous: string[];
  current: boolean;
  name: string;
  priceCents: number;
  bornOn: string;
  speciesId: string | null;
  breederId: string | null;
  traitIds: string[];
  storyLength: number;
};

/**
 * Thrown by `PetShopStore.updateAnimal` when the changes cannot be applied:
 * a field that is not editable, an invalid value, or a species, breeder or
 * trait id no current row has. The route turns it into a `400 Bad Request`
 * whose message is this error's message, written for the person who
 * filled in the form, the same contract `InvoiceValidationError` has.
 */
export class AnimalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnimalValidationError';
  }
}

/**
 * One customer version as `PetShopStore.listCustomers` returns it, in the
 * shape `GET /api/customers` serves (roadmap section 2.5): the full
 * `customers` row plus its `_hash` and the person it belongs to, already
 * joined, `null` when the customer's `personRef` does not resolve, the
 * same tolerance `Breeder.person` has.
 */
export type Customer = {
  id: string;
  hash: string;
  customerNumber: string;
  person: BreederPerson | null;
};

/**
 * One line of an invoice to issue: which animal, how many. The unit price
 * is never part of the request; the store takes it from the animal's
 * current version when it issues the invoice.
 */
export type IssueInvoiceItem = {
  animalId: string;
  quantity: number;
};

/**
 * The body of `POST /api/invoices` (roadmap section 2.5), and what
 * `PetShopStore.issueInvoice` takes: a customer and the animals to sell,
 * both by `id`.
 */
export type IssueInvoiceCommand = {
  customerId: string;
  items: readonly IssueInvoiceItem[];
};

/**
 * Thrown by `PetShopStore.issueInvoice` when the command names an unknown
 * customer or animal, has no items, or has a quantity below one. The route
 * turns it into a `400 Bad Request` whose message is this error's message,
 * so the message is written for the person who filled in the form.
 */
export class InvoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceValidationError';
  }
}

/**
 * The customer of an invoice as `PetShopStore.listInvoices` joins it in:
 * enough to print "Scrooge McDuck (C-0001)" on an invoice card.
 * `personName` is `null` when the customer's own `personRef` does not
 * resolve, the same tolerance `AnimalBreeder.personName` has.
 */
export type InvoiceCustomerSummary = {
  id: string;
  customerNumber: string;
  personName: string | null;
};

/**
 * One invoice as `PetShopStore.listInvoices` returns it, in the shape
 * `GET /api/invoices` serves: the invoice row's fields plus its customer,
 * the sum of its items and how many items it has, so a list can show the
 * total without loading every item. `customer` is `null` for the
 * store-integrity case of an invoice whose `customerRef` does not resolve.
 */
export type InvoiceSummary = {
  id: string;
  hash: string;
  invoiceNumber: string;
  issuedOn: string;
  status: InvoiceStatus;
  customer: InvoiceCustomerSummary | null;
  totalCents: number;
  itemCount: number;
};

/**
 * The customer of an invoice as `PetShopStore.getInvoice` joins it in, with
 * the person behind it resolved one step further than the list needs.
 */
export type InvoiceCustomer = {
  id: string;
  customerNumber: string;
  person: BreederPerson | null;
};

/**
 * The animal an invoice item sold, as `PetShopStore.getInvoice` joins it
 * in: the animal's stable `id` (so the detail view can link to it), its
 * name and its species name, `null` when the animal's `speciesRef` does
 * not resolve.
 */
export type InvoiceItemAnimal = {
  id: string;
  name: string;
  speciesName: string | null;
};

/**
 * One line of an invoice as `PetShopStore.getInvoice` returns it. `animal`
 * is `null` for the store-integrity case of an item whose `animalRef`
 * does not resolve; `lineTotalCents` is `quantity` times `unitPriceCents`.
 */
export type InvoiceItem = {
  id: string;
  hash: string;
  animal: InvoiceItemAnimal | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

/**
 * One invoice as `PetShopStore.getInvoice` and `issueInvoice` return it,
 * in the shape `GET /api/invoices/:id` and `POST /api/invoices` serve:
 * everything `InvoiceSummary` has except the item count, plus the customer
 * with their person, every item with its animal joined, and
 * `changeSetHash`, the `_hash` of the `changeSets` row that wrote this
 * invoice, which is what a node announces to its peers (roadmap section
 * 3.4). `changeSetHash` is `null` for an invoice no change set names,
 * which nothing writes today; `issueInvoice` always fills it.
 */
export type InvoiceDetail = {
  id: string;
  hash: string;
  invoiceNumber: string;
  issuedOn: string;
  status: InvoiceStatus;
  customer: InvoiceCustomer | null;
  items: InvoiceItem[];
  totalCents: number;
  changeSetHash: string | null;
};

/**
 * One entity table as the store reads it: every row (every version, which
 * is what a join by hash needs, since a reference names one exact
 * version), the rows of its InsertHistory companion, and the current
 * version per entity resolved through the rule of roadmap section 2.6
 * (`currentRows`), which is what a list and a lookup by `id` need.
 */
type VersionedTable<Row extends { _hash: string; id: string }> = {
  rows: Row[];
  history: VersionHistoryRow[];
  current: Row[];
};

/**
 * The tables an invoice needs joined, read once per call so that a list and
 * a detail resolve their references against one consistent snapshot.
 * `invoices`, `customers` and `animals` are versioned: the list serves
 * current invoices, `issueInvoice` resolves a customer or animal id to its
 * current version, and every join by hash reads all versions.
 */
type InvoiceTables = {
  invoices: VersionedTable<HashedInvoiceRow>;
  invoiceItems: HashedInvoiceItemRow[];
  customers: VersionedTable<HashedCustomerRow>;
  persons: HashedPersonRow[];
  animals: VersionedTable<HashedAnimalRow>;
  species: HashedSpeciesRow[];
  changeSets: HashedChangeSetRow[];
};

/**
 * The tables an animal needs joined, read once per call: the animals
 * themselves, the species, breeders and traits they reference (versioned,
 * so that an edit can resolve a species, breeder or trait id to its
 * current version while a join by hash still finds the exact version an
 * animal row names), the persons behind the breeders, and the
 * `TraitRelation` for the configured mode, built from whichever table
 * carries the relation (`docs/findings/n-to-m.md`).
 */
type AnimalTables = {
  animals: VersionedTable<HashedAnimalRow>;
  species: VersionedTable<HashedSpeciesRow>;
  breeders: VersionedTable<HashedBreederRow>;
  traits: VersionedTable<HashedTraitRow>;
  persons: HashedPersonRow[];
  traitRelation: TraitRelation;
};

/**
 * What `PetShopStore.writeRow` reports about a row it wrote: the change
 * set items naming the row and its InsertHistory row, and the `timeId` of
 * that history row, which a follow-up version names in `previous`.
 */
type WrittenRow = {
  changeSetItems: ChangeSetItem[];
  timeId: string;
};

const byHash = <Row extends { _hash: string }>(
  rows: readonly Row[],
): Map<string, Row> => new Map(rows.map((row) => [row._hash, row]));

/**
 * The ids of the traits an animal version carries, ordered by id: the
 * `TraitRelation` reports them in storage order, which differs between
 * the multi-reference and the junction representation, and the API must
 * answer identically in both modes (`docs/findings/n-to-m.md`).
 */
const traitIdsOf = (
  traitRelation: TraitRelation,
  animalHash: string,
): string[] =>
  traitRelation
    .traitIdsOfAnimal(animalHash)
    .sort((left, right) => left.localeCompare(right));

const sumCents = (items: readonly { lineTotalCents: number }[]): number =>
  items.reduce((total, item) => total + item.lineTotalCents, 0);

/**
 * Resolves a customer row's `personRef` to the person it points at, the
 * shape `Customer.person` and `InvoiceCustomer.person` share with
 * `Breeder.person`. `null` when the reference does not resolve.
 */
const resolveCustomerPerson = (
  customer: HashedCustomerRow,
  personsByHash: Map<string, HashedPersonRow>,
): BreederPerson | null => {
  const person = personsByHash.get(customer.personRef);
  return person === undefined
    ? null
    : { id: person.id, name: person.name, city: person.city };
};

/**
 * The items of one invoice, in `id` order (which is issue order, see
 * `invoiceItemId`), each with its animal and species joined and its line
 * total computed.
 */
const resolveInvoiceItems = (
  invoice: HashedInvoiceRow,
  tables: InvoiceTables,
): InvoiceItem[] => {
  const animalsByHash = byHash(tables.animals.rows);
  const speciesByHash = byHash(tables.species);

  return tables.invoiceItems
    .filter((item) => item.invoiceRef === invoice._hash)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => {
      const animal = animalsByHash.get(item.animalRef);
      return {
        id: item.id,
        hash: item._hash,
        animal:
          animal === undefined
            ? null
            : {
                id: animal.id,
                name: animal.name,
                speciesName: speciesByHash.get(animal.speciesRef)?.name ?? null,
              },
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.quantity * item.unitPriceCents,
      };
    });
};

/**
 * The `_hash` of the change set that names this invoice among its items,
 * `null` when none does. A change set lists every row it wrote, so the
 * invoice row's own hash is what to look for.
 */
const changeSetHashOf = (
  invoice: HashedInvoiceRow,
  changeSets: readonly HashedChangeSetRow[],
): string | null =>
  changeSets.find((changeSet) =>
    changeSet.items.some(
      (item) =>
        item.table === invoicesTableCfg.key && item.ref === invoice._hash,
    ),
  )?._hash ?? null;

const invoiceSummary = (
  invoice: HashedInvoiceRow,
  tables: InvoiceTables,
): InvoiceSummary => {
  const customer = byHash(tables.customers.rows).get(invoice.customerRef);
  const items = resolveInvoiceItems(invoice, tables);

  return {
    id: invoice.id,
    hash: invoice._hash,
    invoiceNumber: invoice.invoiceNumber,
    issuedOn: invoice.issuedOn,
    status: invoice.status,
    customer:
      customer === undefined
        ? null
        : {
            id: customer.id,
            customerNumber: customer.customerNumber,
            personName:
              resolveCustomerPerson(customer, byHash(tables.persons))?.name ??
              null,
          },
    totalCents: sumCents(items),
    itemCount: items.length,
  };
};

const invoiceDetail = (
  invoice: HashedInvoiceRow,
  tables: InvoiceTables,
): InvoiceDetail => {
  const customer = byHash(tables.customers.rows).get(invoice.customerRef);
  const items = resolveInvoiceItems(invoice, tables);

  return {
    id: invoice.id,
    hash: invoice._hash,
    invoiceNumber: invoice.invoiceNumber,
    issuedOn: invoice.issuedOn,
    status: invoice.status,
    customer:
      customer === undefined
        ? null
        : {
            id: customer.id,
            customerNumber: customer.customerNumber,
            person: resolveCustomerPerson(customer, byHash(tables.persons)),
          },
    items,
    totalCents: sumCents(items),
    changeSetHash: changeSetHashOf(invoice, tables.changeSets),
  };
};

/**
 * Rejects a command whose shape alone rules it out, before any table is
 * read: no items, or a quantity that is not a whole number of at least
 * one. Unknown customers and animals are checked against the store by
 * `PetShopStore.issueInvoice` itself.
 */
const throwOnInvalidCommandShape = (command: IssueInvoiceCommand): void => {
  if (command.items.length === 0) {
    throw new InvoiceValidationError('An invoice needs at least one item.');
  }
  for (const [index, item] of command.items.entries()) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new InvoiceValidationError(
        `Item ${index + 1}: the quantity must be a whole number of at least 1, got ${item.quantity}.`,
      );
    }
  }
};

/**
 * The calendar date today as an ISO date (`YYYY-MM-DD`) in UTC, the same
 * shape `invoices.issuedOn` and `animals.bornOn` use. UTC because a node
 * runs in a container whose clock is UTC and because two nodes issuing
 * invoices should not disagree on the date by time zone.
 */
const todayInUtc = (): string => new Date().toISOString().slice(0, 10);

/**
 * Resolves a breeder row's `personRef` hash to the person it currently
 * points at, the shape `PetShopStore.listBreeders` joins into
 * `Breeder.person`. `null` when the reference does not resolve, the same
 * tolerance a dangling `speciesRef` already gets.
 */
const resolveBreederPerson = (
  breeder: HashedBreederRow,
  personsByHash: Map<string, HashedPersonRow>,
): BreederPerson | null => {
  const person = personsByHash.get(breeder.personRef);
  return person === undefined
    ? null
    : { id: person.id, name: person.name, city: person.city };
};

/**
 * Resolves an animal row's `breederRef` hash to the breeder it currently
 * points at, with that breeder's own `personRef` resolved one step further
 * for the detail view's facts block (`AnimalDetail.breeder`). `null` when
 * `breederRef` itself does not resolve, the same tolerance a dangling
 * `speciesRef` already gets; `personName` and `city` are `null` when the
 * breeder resolves but its own `personRef` does not.
 */
const resolveAnimalBreeder = (
  breederRef: string,
  breedersByHash: Map<string, HashedBreederRow>,
  personsByHash: Map<string, HashedPersonRow>,
): AnimalBreeder | null => {
  const breeder = breedersByHash.get(breederRef);
  if (breeder === undefined) {
    return null;
  }

  const person = resolveBreederPerson(breeder, personsByHash);
  return {
    id: breeder.id,
    farmName: breeder.farmName,
    personName: person?.name ?? null,
    city: person?.city ?? null,
  };
};

/**
 * What `PetShopStore` can be given at construction: `traitRelationMode`
 * picks the implementation of the animal-trait relation
 * (`docs/findings/n-to-m.md`, default `multi-reference`); `today` returns
 * the ISO date an issued invoice is dated with, replaceable in tests so
 * that an invoice number and date can be asserted exactly.
 */
export type PetShopStoreOptions = Readonly<{
  traitRelationMode?: TraitRelationMode;
  today?: () => string;
}>;

/**
 * The node's data: an rljson `Db` over the `Io` the configured `STORAGE`
 * selects (`createIo`: `IoMem`, or `IoSqliteNode` over a file under
 * `DATA_DIR`; SQL Server follows with slice C4). The store never asks
 * which one it got: every method reads and writes through `Db` and the
 * `Io` interface alone, and `docs/findings/stores.md` records where the
 * implementations behave differently. `animalTraits` (the junction-table
 * alternative to `animals.traitsRefs`, slice B6) is always created and
 * seeded, regardless of `traitRelationMode`: the table is part of the
 * domain either way, and switching the mode at runtime must not require
 * reseeding (`docs/findings/n-to-m.md`).
 */
export class PetShopStore {
  private readonly io: Io;
  private readonly db: Db;
  private readonly traitRelationMode: TraitRelationMode;
  private readonly today: () => string;

  /**
   * Writes that must not interleave (issuing an invoice reads the invoice
   * count to number the next one) are chained on this promise, so two
   * concurrent `issueInvoice` calls get consecutive numbers instead of the
   * same one.
   */
  private pendingWrite: Promise<unknown> = Promise.resolve();

  /**
   * Every table this store creates, each domain table followed by its
   * InsertHistory companion; `tableRowCounts` reports them in this order.
   */
  private readonly tableCfgs = [
    speciesTableCfg,
    speciesInsertHistoryTableCfg,
    traitsTableCfg,
    traitsInsertHistoryTableCfg,
    personsTableCfg,
    personsInsertHistoryTableCfg,
    breedersTableCfg,
    breedersInsertHistoryTableCfg,
    animalsTableCfg,
    animalsInsertHistoryTableCfg,
    animalTraitsTableCfg,
    animalTraitsInsertHistoryTableCfg,
    customersTableCfg,
    customersInsertHistoryTableCfg,
    invoicesTableCfg,
    invoicesInsertHistoryTableCfg,
    invoiceItemsTableCfg,
    invoiceItemsInsertHistoryTableCfg,
    changeSetsTableCfg,
    changeSetsInsertHistoryTableCfg,
  ];

  constructor(io: Io, options: PetShopStoreOptions = {}) {
    this.io = io;
    this.db = new Db(io);
    this.traitRelationMode = options.traitRelationMode ?? 'multi-reference';
    this.today = options.today ?? todayInUtc;
  }

  /**
   * Opens the store and creates every domain table together with its
   * InsertHistory companion. Must run once, before any other method, and
   * only once per instance: `IoSqliteNode.init()` opens a new connection
   * on every call and leaks the previous one. Safe to run against a
   * file that already holds these tables and their rows, which is what
   * every restart of a `sqlite` node does: both `Io` implementations
   * treat `createOrExtendTable` for an unchanged table configuration as a
   * no-op (`docs/findings/stores.md`).
   */
  async initialize(): Promise<void> {
    await this.io.init();
    await this.io.isReady();
    for (const tableCfg of this.tableCfgs) {
      await this.db.core.createTable(tableCfg);
    }
  }

  /**
   * The number of rows in every table of the store, keyed by table, in the
   * shape `GET /status` serves under `tables` (roadmap section 2.5).
   */
  async tableRowCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const tableCfg of this.tableCfgs) {
      counts[tableCfg.key] = await this.io.rowCount(tableCfg.key);
    }
    return counts;
  }

  /**
   * Inserts the seed species, the seed traits, the seed persons, the seed
   * breeders, the seed customers, once all of those are in place the seed
   * animals, then the derived `animalTraits` junction rows and finally the
   * seed invoices, skipping a step when its table already holds rows.
   * Animals reference species, breeders and traits by hash, breeders and
   * customers reference persons by hash, `animalTraits` rows reference
   * animals and traits by hash, and invoices reference customers and
   * animals by hash, so every table a row points at is always seeded
   * first. Every row is inserted on its own because `Db.insert` records
   * only the first row of a multi-row insert in the InsertHistory. Seed
   * invoices go through `issueInvoice`'s own write path (`writeInvoice`),
   * so each one is written together with its items and its change set
   * exactly like an invoice issued through the API; `invoicesSeeded`
   * counts invoices, not rows.
   */
  async seedIfEmpty(): Promise<{
    speciesSeeded: number;
    traitsSeeded: number;
    personsSeeded: number;
    breedersSeeded: number;
    customersSeeded: number;
    animalsSeeded: number;
    animalTraitsSeeded: number;
    invoicesSeeded: number;
  }> {
    const speciesSeeded = await this.seedTableIfEmpty(
      speciesTableCfg,
      speciesSeed,
    );
    const traitsSeeded = await this.seedTableIfEmpty(
      traitsTableCfg,
      traitsSeed,
    );
    const personsSeeded = await this.seedTableIfEmpty(
      personsTableCfg,
      personsSeed,
    );
    const breedersSeeded = await this.seedTableIfEmpty(
      breedersTableCfg,
      breedersSeed,
    );
    const customersSeeded = await this.seedTableIfEmpty(
      customersTableCfg,
      customersSeed,
    );
    const animalsSeeded = await this.seedTableIfEmpty(
      animalsTableCfg,
      animalsSeed,
    );
    const animalTraitsSeeded = await this.seedTableIfEmpty(
      animalTraitsTableCfg,
      animalTraitsSeed,
    );
    const invoicesSeeded = await this.seedInvoicesIfEmpty();

    return {
      speciesSeeded,
      traitsSeeded,
      personsSeeded,
      breedersSeeded,
      customersSeeded,
      animalsSeeded,
      animalTraitsSeeded,
      invoicesSeeded,
    };
  }

  private async seedTableIfEmpty(
    tableCfg: TableCfg,
    rows: readonly (
      | HashedSpeciesRow
      | HashedTraitRow
      | HashedPersonRow
      | HashedBreederRow
      | HashedCustomerRow
      | HashedAnimalRow
      | HashedAnimalTraitRow
    )[],
  ): Promise<number> {
    if ((await this.io.rowCount(tableCfg.key)) > 0) {
      return 0;
    }

    const route = Route.fromFlat(tableCfg.key);
    for (const row of rows) {
      await this.db.insert(route, {
        [tableCfg.key]: { _type: 'components', _data: [row] },
      });
    }

    return rows.length;
  }

  private async seedInvoicesIfEmpty(): Promise<number> {
    if ((await this.io.rowCount(invoicesTableCfg.key)) > 0) {
      return 0;
    }

    for (const entry of invoicesSeed) {
      await this.writeInvoice(entry, entry.issuedOn, entry.status);
    }

    return invoicesSeed.length;
  }

  /**
   * Every row of one components table. `Db.get` with an empty `where` is
   * the one read that is reliable for a table with reference columns
   * (`docs/findings/db-basics.md`, "Filtering by id"), so every method
   * below reads whole tables and joins or filters in JavaScript.
   */
  private async readRows<Row extends { _hash: string }>(
    tableCfg: TableCfg,
  ): Promise<Row[]> {
    const { rljson } = await this.db.get(Route.fromFlat(tableCfg.key), {});
    const table = rljson[tableCfg.key] as ComponentsTable<Row>;
    return table._data;
  }

  /**
   * Every row of one entity table together with its InsertHistory rows and
   * the current version per entity. This is the one place the rule of
   * roadmap section 2.6 enters the store: every list, every lookup by `id`
   * and every edit reads its entity table through here
   * (`docs/findings/entity-versions.md`).
   */
  private async readVersioned<Row extends { _hash: string; id: string }>(
    tableCfg: TableCfg,
  ): Promise<VersionedTable<Row>> {
    const historyTableKey = `${tableCfg.key}InsertHistory`;
    const [rows, historyDump] = await Promise.all([
      this.readRows<Row>(tableCfg),
      this.db.getInsertHistory(tableCfg.key),
    ]);
    const historyTable = historyDump[
      historyTableKey
    ] as InsertHistoryTable<string>;
    const history = historyTable._data as VersionHistoryRow[];

    return { rows, history, current: currentRows(rows, history, tableCfg.key) };
  }

  /**
   * Reads the tables `listAnimals`, `getAnimal`, `getAnimalHistory` and
   * `updateAnimal` need and builds the `TraitRelation` for the configured
   * `traitRelationMode`: in `multi-reference` mode `animals` already carries
   * every animal's trait hashes in `traitsRefs`, so `animalTraits` is not
   * read at all; in `junction` mode `animalTraits` is read as one additional
   * table instead, since the relation lives there rather than on `animals`
   * (`docs/findings/n-to-m.md`, "query shape"). The relation is built from
   * every version of every row, so it answers for an old animal version
   * (whose junction rows name the old hash) exactly as for the current one.
   * This is the one place the animal methods depend on which representation
   * is active; all of them build their answer from the interface
   * `TraitRelation` afterwards, never from `HashedAnimalRow.traitsRefs` or
   * `animalTraits` directly.
   */
  private async readAnimalTables(): Promise<AnimalTables> {
    const [animals, species, breeders, traits, persons] = await Promise.all([
      this.readVersioned<HashedAnimalRow>(animalsTableCfg),
      this.readVersioned<HashedSpeciesRow>(speciesTableCfg),
      this.readVersioned<HashedBreederRow>(breedersTableCfg),
      this.readVersioned<HashedTraitRow>(traitsTableCfg),
      this.readRows<HashedPersonRow>(personsTableCfg),
    ]);
    const traitRelation =
      this.traitRelationMode === 'junction'
        ? new JunctionTraitRelation(
            await this.readRows<HashedAnimalTraitRow>(animalTraitsTableCfg),
            traits.rows,
          )
        : new MultiReferenceTraitRelation(animals.rows, traits.rows);

    return { animals, species, breeders, traits, persons, traitRelation };
  }

  /**
   * Every current species version in the store, ordered by `id`.
   */
  async listSpecies(): Promise<HashedSpeciesRow[]> {
    return (await this.readVersioned<HashedSpeciesRow>(speciesTableCfg))
      .current;
  }

  /**
   * Every current trait version in the store, ordered by `id`, in the
   * shape `GET /api/traits` serves (roadmap section 2.5).
   */
  async listTraits(): Promise<Trait[]> {
    const traits = await this.readVersioned<HashedTraitRow>(traitsTableCfg);

    return traits.current.map((row) => ({
      id: row.id,
      hash: row._hash,
      name: row.name,
      description: row.description,
    }));
  }

  /**
   * Every current breeder version in the store with its person joined,
   * ordered by `id`, in the shape `GET /api/breeders` serves (roadmap
   * section 2.5). Fetches `breeders` and `persons` separately and joins
   * them with a local `Map`, the same explicit fallback `listAnimals` uses
   * for `species` (`docs/findings/db-basics.md`, "Joining a reference"). A
   * breeder whose `personRef` does not resolve gets `person: null` instead
   * of failing the whole list.
   */
  async listBreeders(): Promise<Breeder[]> {
    const [breeders, persons] = await Promise.all([
      this.readVersioned<HashedBreederRow>(breedersTableCfg),
      this.readRows<HashedPersonRow>(personsTableCfg),
    ]);
    const personsByHash = byHash(persons);

    return breeders.current.map((breeder) => ({
      id: breeder.id,
      hash: breeder._hash,
      farmName: breeder.farmName,
      suppliesSince: breeder.suppliesSince,
      person: resolveBreederPerson(breeder, personsByHash),
    }));
  }

  /**
   * The `_hash` of every animal version that carries the trait with this
   * id, in any version of the trait: an animal row names one exact trait
   * version, so a trait id is matched through every hash it ever had.
   */
  private static animalHashesWithTraitId(
    tables: AnimalTables,
    traitId: string,
  ): Set<string> {
    return new Set(
      tables.traits.rows
        .filter((trait) => trait.id === traitId)
        .flatMap((trait) =>
          tables.traitRelation.animalHashesWithTrait(trait._hash),
        ),
    );
  }

  /**
   * Every current animal version in the store with its species and breeder
   * joined, optionally narrowed to one species, one breeder, one trait, or
   * any combination, ordered by `id`. Fetches `animals`, `species`,
   * `breeders`, `persons` and `traits` (and, in `junction` mode,
   * `animalTraits`) separately and joins them with local `Map`s, the
   * explicit fallback of roadmap section 3.2: the rljson route join
   * `animals/species` was tried first, but it silently drops an animal row
   * whose `speciesRef` does not resolve instead of including it with a
   * missing species, which defeats listing every animal
   * (`docs/findings/db-basics.md`, "Joining a reference"). Filtering
   * happens here, in plain JavaScript, after this full read, for the same
   * reason `getAnimal` cannot filter `db.get` by `where`: `id` collides
   * with a column of a *referenced* table and is silently mismatched by
   * `ComponentController`'s reference resolution
   * (`docs/findings/db-basics.md`, "Filtering by id"), and `traitId` would
   * have to be resolved element by element against whichever table carries
   * the relation besides, a shape `where` cannot express at all. An unknown
   * `speciesId`, `breederId` or `traitId` filter yields an empty list rather
   * than an error. An animal whose `speciesRef` or `breederRef` does not
   * resolve (nothing writes one today; `Db.insert` and `IoMem` do not check
   * references, only `Validate` does, see the finding above) gets the
   * matching fields `null` instead of failing the whole list; an animal
   * that does not carry the filtered trait, according to the configured
   * `TraitRelation`, simply does not match.
   */
  async listAnimals(filter: AnimalFilter = {}): Promise<AnimalWithSpecies[]> {
    const tables = await this.readAnimalTables();
    const speciesByHash = byHash(tables.species.rows);
    const breedersByHash = byHash(tables.breeders.rows);
    const matchingAnimalHashes =
      filter.traitId === undefined
        ? undefined
        : PetShopStore.animalHashesWithTraitId(tables, filter.traitId);

    const matchesFilter = (animal: HashedAnimalRow): boolean => {
      if (filter.speciesId !== undefined) {
        const species = speciesByHash.get(animal.speciesRef);
        if (species?.id !== filter.speciesId) {
          return false;
        }
      }
      if (filter.breederId !== undefined) {
        const breeder = breedersByHash.get(animal.breederRef);
        if (breeder?.id !== filter.breederId) {
          return false;
        }
      }
      if (matchingAnimalHashes !== undefined) {
        if (!matchingAnimalHashes.has(animal._hash)) {
          return false;
        }
      }
      return true;
    };

    return tables.animals.current.filter(matchesFilter).map((animal) => {
      const species = speciesByHash.get(animal.speciesRef);
      const breeder = breedersByHash.get(animal.breederRef);

      return {
        id: animal.id,
        hash: animal._hash,
        name: animal.name,
        speciesId: species?.id ?? null,
        speciesName: species?.name ?? null,
        breederId: breeder?.id ?? null,
        breederFarmName: breeder?.farmName ?? null,
        bornOn: animal.bornOn,
        priceCents: animal.priceCents,
      };
    });
  }

  /**
   * One animal version with its species and breeder joined, its traits
   * resolved and its full `backgroundStory`, the shape `getAnimal` and
   * `updateAnimal` return. An animal whose `speciesRef` does not resolve
   * gets `speciesId` and `speciesName` of `null`, the same tolerance
   * `listAnimals` has; a trait the configured `TraitRelation` cannot
   * resolve to a stored trait is simply left out of `traits`; a
   * `breederRef` that does not resolve gives `breeder: null` (see
   * `resolveAnimalBreeder`).
   */
  private static animalDetail(
    animal: HashedAnimalRow,
    tables: AnimalTables,
  ): AnimalDetail {
    const speciesByHash = byHash(tables.species.rows);
    const breedersByHash = byHash(tables.breeders.rows);
    const personsByHash = byHash(tables.persons);
    const traitsById = new Map(
      tables.traits.rows.map((trait) => [trait.id, trait]),
    );
    const species = speciesByHash.get(animal.speciesRef);
    const breeder = breedersByHash.get(animal.breederRef);
    const traits: TraitSummary[] = traitIdsOf(
      tables.traitRelation,
      animal._hash,
    )
      .map((traitId) => traitsById.get(traitId))
      .filter((trait): trait is HashedTraitRow => trait !== undefined)
      .map((trait) => ({ id: trait.id, name: trait.name }));

    return {
      id: animal.id,
      hash: animal._hash,
      name: animal.name,
      speciesId: species?.id ?? null,
      speciesName: species?.name ?? null,
      breederId: breeder?.id ?? null,
      breederFarmName: breeder?.farmName ?? null,
      bornOn: animal.bornOn,
      priceCents: animal.priceCents,
      backgroundStory: animal.backgroundStory,
      traits,
      breeder: resolveAnimalBreeder(
        animal.breederRef,
        breedersByHash,
        personsByHash,
      ),
    };
  }

  /**
   * The current version of one animal with its species and breeder joined,
   * its traits resolved and its full `backgroundStory`, or, with `version`,
   * the version of that animal with exactly that `_hash`; `undefined` when
   * no animal has this id or the animal has no version with that hash.
   *
   * Filtering `db.get(animalsRoute, { id })` directly looks like the obvious
   * approach (`docs/findings/db-basics.md`, "Get") and works for columns
   * such as `bornOn`, but not for `id`: `ComponentController._referenceColumns`
   * resolves to the *referenced* table's columns instead of the referencing
   * table's own ref columns, so a `where` key that happens to also be a
   * column of a referenced table (`id`, `name`, `_hash`) is wrongly treated
   * as a foreign-key lookup and matches nothing (see "Filtering by id" in
   * `docs/findings/db-basics.md`). This method therefore reuses
   * `listAnimals`'s explicit fallback instead: read every table in full and
   * join them with local `Map`s, then find the animal by `id` in
   * JavaScript.
   */
  async getAnimal(
    id: string,
    options: { version?: string } = {},
  ): Promise<AnimalDetail | undefined> {
    const tables = await this.readAnimalTables();
    const animal =
      options.version === undefined
        ? tables.animals.current.find((row) => row.id === id)
        : versionsOf(
            tables.animals.rows,
            tables.animals.history,
            animalsTableCfg.key,
            id,
          ).find((version) => version.row._hash === options.version)?.row;

    return animal === undefined
      ? undefined
      : PetShopStore.animalDetail(animal, tables);
  }

  /**
   * Every version of one animal, newest first, in the shape
   * `GET /api/animals/:id/history` serves, or `undefined` when no animal
   * has this id. A version is an InsertHistory row (`versionsOf`), so an
   * edit that restores earlier content shows up as a version of its own.
   */
  async getAnimalHistory(id: string): Promise<AnimalVersion[] | undefined> {
    const tables = await this.readAnimalTables();
    const versions = versionsOf(
      tables.animals.rows,
      tables.animals.history,
      animalsTableCfg.key,
      id,
    );
    if (versions.length === 0) {
      return undefined;
    }

    const speciesByHash = byHash(tables.species.rows);
    const breedersByHash = byHash(tables.breeders.rows);

    return versions.map((version) => ({
      hash: version.row._hash,
      timeId: version.timeId,
      previous: version.previous,
      current: version.current,
      name: version.row.name,
      priceCents: version.row.priceCents,
      bornOn: version.row.bornOn,
      speciesId: speciesByHash.get(version.row.speciesRef)?.id ?? null,
      breederId: breedersByHash.get(version.row.breederRef)?.id ?? null,
      traitIds: traitIdsOf(tables.traitRelation, version.row._hash),
      storyLength: version.row.backgroundStory.length,
    }));
  }

  /**
   * Writes a new version of one animal: the current version with the
   * given changes applied, as a new `animals` row whose InsertHistory row
   * names the current version's `timeId` in `previous`, so that the new
   * row becomes the animal's only tip (`docs/findings/entity-versions.md`).
   * `speciesId`, `breederId` and `traitIds` are resolved to the current
   * version of the named species, breeder and traits; fields the changes
   * do not name keep the current version's values, references included.
   * `traitsRefs` is written in the canonical order of `traitsRefsOf`, so
   * the same edit produces the same row hash in both trait relation modes.
   * The `animalTraits` junction rows are re-created for the new animal
   * hash, each as a new version of its pairing (`docs/findings/n-to-m.md`,
   * "Versioning consequences"), and one change set names every row this
   * wrote, InsertHistory rows included, the same discipline
   * `issueInvoice` follows. Returns the new version as
   * `GET /api/animals/:id` serves it, or `undefined` when no animal has
   * this id. Throws `AnimalValidationError` for changes that cannot be
   * applied and writes nothing in that case. Concurrent writes are
   * serialised so that two edits of one animal chain instead of branching.
   */
  async updateAnimal(
    id: string,
    changes: AnimalChanges,
  ): Promise<AnimalDetail | undefined> {
    const write = this.pendingWrite.then(
      () => this.updateAnimalNow(id, changes),
      () => this.updateAnimalNow(id, changes),
    );
    this.pendingWrite = write;
    return write;
  }

  private async updateAnimalNow(
    id: string,
    changes: AnimalChanges,
  ): Promise<AnimalDetail | undefined> {
    const problems = animalChangeProblems(changes);
    if (problems.length > 0) {
      throw new AnimalValidationError(problems.join(' '));
    }
    const tables = await this.readAnimalTables();
    const current = versionsOf(
      tables.animals.rows,
      tables.animals.history,
      animalsTableCfg.key,
      id,
    ).find((version) => version.current);
    if (current === undefined) {
      return undefined;
    }

    const traitIds =
      changes.traitIds ?? traitIdsOf(tables.traitRelation, current.row._hash);
    const traitsById = new Map(
      tables.traits.current.map((trait) => [trait.id, trait]),
    );
    const traits = traitIds.map((traitId) => {
      const trait = traitsById.get(traitId);
      if (trait === undefined) {
        throw new AnimalValidationError(`No trait with id "${traitId}".`);
      }
      return trait;
    });
    const animal = hashed({
      id,
      name: changes.name?.trim() ?? current.row.name,
      speciesRef: this.resolveReference(
        'species',
        tables.species.current,
        changes.speciesId,
        current.row.speciesRef,
      ),
      breederRef: this.resolveReference(
        'breeder',
        tables.breeders.current,
        changes.breederId,
        current.row.breederRef,
      ),
      bornOn: changes.bornOn ?? current.row.bornOn,
      priceCents: changes.priceCents ?? current.row.priceCents,
      backgroundStory: changes.backgroundStory ?? current.row.backgroundStory,
      traitsRefs: traitsRefsOf(traits),
    });

    const written = await this.writeRow(
      animalsTableCfg,
      animal,
      current.timeId,
    );
    const changeSetItems = [...written.changeSetItems];
    const animalTraits =
      await this.readVersioned<HashedAnimalTraitRow>(animalTraitsTableCfg);
    for (const trait of traits) {
      const pairingId = animalTraitId(id, trait.id);
      const pairing = hashed({
        id: pairingId,
        animalRef: animal._hash,
        traitRef: trait._hash,
      });
      const currentPairing = versionsOf(
        animalTraits.rows,
        animalTraits.history,
        animalTraitsTableCfg.key,
        pairingId,
      ).find((version) => version.current);
      const writtenPairing = await this.writeRow(
        animalTraitsTableCfg,
        pairing,
        currentPairing?.timeId,
      );
      changeSetItems.push(...writtenPairing.changeSetItems);
    }
    await this.writeChangeSet(
      updateAnimalChangeSetId(id, written.timeId),
      changeSetItems,
    );

    return PetShopStore.animalDetail(animal, await this.readAnimalTables());
  }

  /**
   * The `_hash` a reference column of the new animal version gets: the
   * current version of the entity `changedId` names, or `currentRef`, the
   * hash the current animal version already holds, when the changes do
   * not name one. Throws `AnimalValidationError` when no current row has
   * the named id.
   */
  private resolveReference(
    entityName: string,
    current: readonly { id: string; _hash: string }[],
    changedId: string | undefined,
    currentRef: string,
  ): string {
    if (changedId === undefined) {
      return currentRef;
    }
    const row = current.find((candidate) => candidate.id === changedId);
    if (row === undefined) {
      throw new AnimalValidationError(
        `No ${entityName} with id "${changedId}".`,
      );
    }
    return row._hash;
  }

  /**
   * Every change set in the store. `changeSets` is a `buffets` table, and
   * `@rljson/db` 0.0.42 has no controller for buffets: `Db.get` on its
   * route throws "Controller for type buffets is not implemented yet", so
   * the rows are read straight from the `Io` instead
   * (`docs/findings/change-sets.md`).
   */
  private async readChangeSets(): Promise<HashedChangeSetRow[]> {
    const rljson = await this.io.readRows({
      table: changeSetsTableCfg.key,
      where: {},
    });
    const table = rljson[changeSetsTableCfg.key] as BuffetsTable;
    return table._data as HashedChangeSetRow[];
  }

  private async readInvoiceTables(): Promise<InvoiceTables> {
    const [invoices, invoiceItems, customers, persons, animals, species] =
      await Promise.all([
        this.readVersioned<HashedInvoiceRow>(invoicesTableCfg),
        this.readRows<HashedInvoiceItemRow>(invoiceItemsTableCfg),
        this.readVersioned<HashedCustomerRow>(customersTableCfg),
        this.readRows<HashedPersonRow>(personsTableCfg),
        this.readVersioned<HashedAnimalRow>(animalsTableCfg),
        this.readRows<HashedSpeciesRow>(speciesTableCfg),
      ]);
    const changeSets = await this.readChangeSets();

    return {
      invoices,
      invoiceItems,
      customers,
      persons,
      animals,
      species,
      changeSets,
    };
  }

  /**
   * Every current customer version in the store with its person joined,
   * ordered by `customerNumber`, in the shape `GET /api/customers` serves
   * (roadmap section 2.5). Same explicit two-table join `listBreeders`
   * uses.
   */
  async listCustomers(): Promise<Customer[]> {
    const [customers, persons] = await Promise.all([
      this.readVersioned<HashedCustomerRow>(customersTableCfg),
      this.readRows<HashedPersonRow>(personsTableCfg),
    ]);
    const personsByHash = byHash(persons);

    return [...customers.current]
      .sort((left, right) =>
        left.customerNumber.localeCompare(right.customerNumber),
      )
      .map((customer) => ({
        id: customer.id,
        hash: customer._hash,
        customerNumber: customer.customerNumber,
        person: resolveCustomerPerson(customer, personsByHash),
      }));
  }

  /**
   * Every current invoice version in the store with its customer joined
   * and its total summed, newest invoice number first, in the shape
   * `GET /api/invoices` serves (roadmap section 2.5). Newest first because
   * an invoice list is read for what happened last; `invoiceNumber` sorts
   * in issue order (`invoiceNumbering.ts`).
   */
  async listInvoices(): Promise<InvoiceSummary[]> {
    const tables = await this.readInvoiceTables();

    return [...tables.invoices.current]
      .sort((left, right) =>
        right.invoiceNumber.localeCompare(left.invoiceNumber),
      )
      .map((invoice) => invoiceSummary(invoice, tables));
  }

  /**
   * One invoice with its customer, its items and their animals joined and
   * the hash of the change set that wrote it, or `undefined` when no
   * invoice has this id, in the shape `GET /api/invoices/:id` serves.
   */
  async getInvoice(id: string): Promise<InvoiceDetail | undefined> {
    const tables = await this.readInvoiceTables();
    const invoice = tables.invoices.current.find((row) => row.id === id);

    return invoice === undefined ? undefined : invoiceDetail(invoice, tables);
  }

  /**
   * Issues an invoice dated today with status `open`: one `invoices` row,
   * one `invoiceItems` row per item (unit price taken from the animal's
   * current `priceCents`), and one `changeSets` row naming every row this
   * wrote, InsertHistory rows included (roadmap section 3.4,
   * `docs/findings/change-sets.md`). Returns the invoice as
   * `GET /api/invoices/:id` would serve it. Throws
   * `InvoiceValidationError` for a command with no items, a quantity below
   * one, an unknown customer or an unknown animal, and writes nothing in
   * that case. Concurrent calls are serialised so that invoice numbers
   * never collide on this node.
   */
  async issueInvoice(command: IssueInvoiceCommand): Promise<InvoiceDetail> {
    return this.writeInvoice(command, this.today(), 'open');
  }

  private writeInvoice(
    command: IssueInvoiceCommand,
    issuedOn: string,
    status: InvoiceStatus,
  ): Promise<InvoiceDetail> {
    const write = this.pendingWrite.then(
      () => this.writeInvoiceNow(command, issuedOn, status),
      () => this.writeInvoiceNow(command, issuedOn, status),
    );
    this.pendingWrite = write;
    return write;
  }

  private async writeInvoiceNow(
    command: IssueInvoiceCommand,
    issuedOn: string,
    status: InvoiceStatus,
  ): Promise<InvoiceDetail> {
    throwOnInvalidCommandShape(command);
    const tables = await this.readInvoiceTables();
    const customer = tables.customers.current.find(
      (row) => row.id === command.customerId,
    );
    if (customer === undefined) {
      throw new InvoiceValidationError(
        `No customer with id "${command.customerId}".`,
      );
    }
    const lines = command.items.map((item) => {
      const animal = tables.animals.current.find(
        (row) => row.id === item.animalId,
      );
      if (animal === undefined) {
        throw new InvoiceValidationError(
          `No animal with id "${item.animalId}".`,
        );
      }
      return { animal, quantity: item.quantity };
    });

    const number = invoiceNumber(
      issuedOn,
      nextInvoiceSequence(
        issuedOn,
        tables.invoices.rows.map((row) => row.invoiceNumber),
      ),
    );
    const invoice = hashed({
      id: invoiceId(number),
      invoiceNumber: number,
      customerRef: customer._hash,
      issuedOn,
      status,
    });
    const written = await this.writeRow(invoicesTableCfg, invoice);
    const changeSetItems = [...written.changeSetItems];
    const items: HashedInvoiceItemRow[] = [];
    for (const [index, line] of lines.entries()) {
      const item = hashed({
        id: invoiceItemId(number, index + 1),
        invoiceRef: invoice._hash,
        animalRef: line.animal._hash,
        quantity: line.quantity,
        unitPriceCents: line.animal.priceCents,
      });
      const writtenItem = await this.writeRow(invoiceItemsTableCfg, item);
      changeSetItems.push(...writtenItem.changeSetItems);
      items.push(item);
    }
    const changeSet = await this.writeChangeSet(
      issueInvoiceChangeSetId(number),
      changeSetItems,
    );

    return invoiceDetail(invoice, {
      ...tables,
      invoiceItems: [...tables.invoiceItems, ...items],
      changeSets: [...tables.changeSets, changeSet],
    });
  }

  /**
   * Writes one row through `Db.insert`, which also writes its InsertHistory
   * row, and reports the two change set items that name them (the row by
   * its own hash and the history row by the hash `IoMem` stored it under,
   * which equals the hash of the row `Db.insert` returns,
   * `docs/findings/change-sets.md`) plus the history row's `timeId`. With
   * `previousTimeId`, the row is inserted through the route
   * `<table>@<previousTimeId>`, which is how `Db.insert` is told that the
   * new row supersedes that version: it then writes the history row with
   * `previous: [previousTimeId]` (`docs/findings/entity-versions.md`).
   */
  private async writeRow(
    tableCfg: TableCfg,
    row:
      | HashedAnimalRow
      | HashedAnimalTraitRow
      | HashedInvoiceRow
      | HashedInvoiceItemRow,
    previousTimeId?: string,
  ): Promise<WrittenRow> {
    const route = Route.fromFlat(
      previousTimeId === undefined
        ? tableCfg.key
        : `${tableCfg.key}@${previousTimeId}`,
    );
    const [historyRow] = await this.db.insert(route, {
      [tableCfg.key]: { _type: 'components', _data: [row] },
    });

    return {
      changeSetItems: [
        { table: tableCfg.key, ref: row._hash },
        {
          table: `${tableCfg.key}InsertHistory`,
          ref: hashed({ ...historyRow })._hash,
        },
      ],
      timeId: historyRow.timeId,
    };
  }

  /**
   * Writes one change set and its InsertHistory row. `Db.insert` cannot
   * write a `buffets` table in `@rljson/db` 0.0.42 (no controller for the
   * type), so both rows go through `Core.import`, the same call
   * `Db._writeInsertHistory` uses internally, with the validator switched
   * off: it would demand every referenced table in the payload, and the
   * referenced rows were just written by `writeRow`. `IoMem` still checks
   * the column types on write. The history row mirrors what `Db.insert`
   * writes for a components row, with `origin` naming the call that wrote
   * it (`docs/findings/change-sets.md`).
   */
  private async writeChangeSet(
    id: string,
    items: ChangeSetItem[],
  ): Promise<HashedChangeSetRow> {
    const changeSet = hashed({ id, items });
    await this.db.core.import(
      {
        [changeSetsTableCfg.key]: { _type: 'buffets', _data: [changeSet] },
      },
      { validate: false },
    );
    await this.db.core.import(
      {
        [changeSetsInsertHistoryTableCfg.key]: {
          _type: 'insertHistory',
          _data: [
            {
              timeId: timeId(),
              changeSetsRef: changeSet._hash,
              route: changeSetsRoute.flat,
              origin: 'core.import',
              previous: [],
            },
          ],
        },
      },
      { validate: false },
    );

    return changeSet;
  }

  /**
   * Closes the underlying `Io`: for `sqlite` this closes the database file
   * so that the process can exit or another store can open the same file.
   */
  async close(): Promise<void> {
    await this.io.close();
  }
}
