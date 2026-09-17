import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import {
  Route,
  timeId,
  type BuffetsTable,
  type ComponentsTable,
  type TableCfg,
} from '@rljson/rljson';
import {
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
  personsInsertHistoryTableCfg,
  personsSeed,
  personsTableCfg,
  speciesInsertHistoryTableCfg,
  speciesSeed,
  speciesTableCfg,
  traitsInsertHistoryTableCfg,
  traitsSeed,
  traitsTableCfg,
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
} from '@rljson-tryout/domain';

import {
  JunctionTraitRelation,
  MultiReferenceTraitRelation,
  type TraitRelation,
  type TraitRelationMode,
} from './traitRelation.ts';

const speciesRoute = Route.fromFlat(speciesTableCfg.key);
const animalsRoute = Route.fromFlat(animalsTableCfg.key);
const traitsRoute = Route.fromFlat(traitsTableCfg.key);
const personsRoute = Route.fromFlat(personsTableCfg.key);
const breedersRoute = Route.fromFlat(breedersTableCfg.key);
const animalTraitsRoute = Route.fromFlat(animalTraitsTableCfg.key);
const customersRoute = Route.fromFlat(customersTableCfg.key);
const invoicesRoute = Route.fromFlat(invoicesTableCfg.key);
const invoiceItemsRoute = Route.fromFlat(invoiceItemsTableCfg.key);
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
 * The tables an invoice needs joined, read once per call so that a list and
 * a detail resolve their references against one consistent snapshot.
 */
type InvoiceTables = {
  invoices: HashedInvoiceRow[];
  invoiceItems: HashedInvoiceItemRow[];
  customers: HashedCustomerRow[];
  persons: HashedPersonRow[];
  animals: HashedAnimalRow[];
  species: HashedSpeciesRow[];
  changeSets: HashedChangeSetRow[];
};

const byHash = <Row extends { _hash: string }>(
  rows: readonly Row[],
): Map<string, Row> => new Map(rows.map((row) => [row._hash, row]));

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
  const animalsByHash = byHash(tables.animals);
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
  const customer = byHash(tables.customers).get(invoice.customerRef);
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
  const customer = byHash(tables.customers).get(invoice.customerRef);
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
 * The node's data: an rljson `Db` over an in-memory `IoMem`. Later slices
 * put SQLite and SQL Server behind the same `Db`. `animalTraits` (the
 * junction-table alternative to `animals.traitsRefs`, slice B6) is always
 * created and seeded, regardless of `traitRelationMode`: the table is part
 * of the domain either way, and switching the mode at runtime must not
 * require reseeding (`docs/findings/n-to-m.md`).
 */
export class PetShopStore {
  private readonly io = new IoMem();
  private readonly db = new Db(this.io);
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

  constructor(options: PetShopStoreOptions = {}) {
    this.traitRelationMode = options.traitRelationMode ?? 'multi-reference';
    this.today = options.today ?? todayInUtc;
  }

  /**
   * Opens the store and creates every domain table together with its
   * InsertHistory companion. Must run before any other method.
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
      speciesTableCfg.key,
      speciesRoute,
      speciesSeed,
    );
    const traitsSeeded = await this.seedTableIfEmpty(
      traitsTableCfg.key,
      traitsRoute,
      traitsSeed,
    );
    const personsSeeded = await this.seedTableIfEmpty(
      personsTableCfg.key,
      personsRoute,
      personsSeed,
    );
    const breedersSeeded = await this.seedTableIfEmpty(
      breedersTableCfg.key,
      breedersRoute,
      breedersSeed,
    );
    const customersSeeded = await this.seedTableIfEmpty(
      customersTableCfg.key,
      customersRoute,
      customersSeed,
    );
    const animalsSeeded = await this.seedTableIfEmpty(
      animalsTableCfg.key,
      animalsRoute,
      animalsSeed,
    );
    const animalTraitsSeeded = await this.seedTableIfEmpty(
      animalTraitsTableCfg.key,
      animalTraitsRoute,
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
    tableKey: string,
    route: Route,
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
    if ((await this.io.rowCount(tableKey)) > 0) {
      return 0;
    }

    for (const row of rows) {
      await this.db.insert(route, {
        [tableKey]: { _type: 'components', _data: [row] },
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
   * Reads the tables `listAnimals` and `getAnimal` both need and builds the
   * `TraitRelation` for the configured `traitRelationMode`: in
   * `multi-reference` mode `animals` already carries every animal's trait
   * hashes in `traitsRefs`, so `animalTraits` is not read at all; in
   * `junction` mode `animalTraits` is read as one additional table instead,
   * since the relation lives there rather than on `animals`
   * (`docs/findings/n-to-m.md`, "query shape"). This is the one place
   * `listAnimals` and `getAnimal` depend on which representation is active;
   * both build their answer from the interface `TraitRelation` afterwards,
   * never from `HashedAnimalRow.traitsRefs` or `animalTraits` directly.
   */
  private async readAnimalTables(): Promise<{
    animalsTable: ComponentsTable<HashedAnimalRow>;
    speciesTable: ComponentsTable<HashedSpeciesRow>;
    breedersTable: ComponentsTable<HashedBreederRow>;
    personsTable: ComponentsTable<HashedPersonRow>;
    traitsTable: ComponentsTable<HashedTraitRow>;
    traitRelation: TraitRelation;
  }> {
    if (this.traitRelationMode === 'junction') {
      const [
        { rljson: animalsContainer },
        { rljson: speciesContainer },
        { rljson: breedersContainer },
        { rljson: personsContainer },
        { rljson: traitsContainer },
        { rljson: animalTraitsContainer },
      ] = await Promise.all([
        this.db.get(animalsRoute, {}),
        this.db.get(speciesRoute, {}),
        this.db.get(breedersRoute, {}),
        this.db.get(personsRoute, {}),
        this.db.get(traitsRoute, {}),
        this.db.get(animalTraitsRoute, {}),
      ]);
      const animalsTable = animalsContainer[
        animalsTableCfg.key
      ] as ComponentsTable<HashedAnimalRow>;
      const speciesTable = speciesContainer[
        speciesTableCfg.key
      ] as ComponentsTable<HashedSpeciesRow>;
      const breedersTable = breedersContainer[
        breedersTableCfg.key
      ] as ComponentsTable<HashedBreederRow>;
      const personsTable = personsContainer[
        personsTableCfg.key
      ] as ComponentsTable<HashedPersonRow>;
      const traitsTable = traitsContainer[
        traitsTableCfg.key
      ] as ComponentsTable<HashedTraitRow>;
      const animalTraitsTable = animalTraitsContainer[
        animalTraitsTableCfg.key
      ] as ComponentsTable<HashedAnimalTraitRow>;

      return {
        animalsTable,
        speciesTable,
        breedersTable,
        personsTable,
        traitsTable,
        traitRelation: new JunctionTraitRelation(
          animalTraitsTable._data,
          traitsTable._data,
        ),
      };
    }

    const [
      { rljson: animalsContainer },
      { rljson: speciesContainer },
      { rljson: breedersContainer },
      { rljson: personsContainer },
      { rljson: traitsContainer },
    ] = await Promise.all([
      this.db.get(animalsRoute, {}),
      this.db.get(speciesRoute, {}),
      this.db.get(breedersRoute, {}),
      this.db.get(personsRoute, {}),
      this.db.get(traitsRoute, {}),
    ]);
    const animalsTable = animalsContainer[
      animalsTableCfg.key
    ] as ComponentsTable<HashedAnimalRow>;
    const speciesTable = speciesContainer[
      speciesTableCfg.key
    ] as ComponentsTable<HashedSpeciesRow>;
    const breedersTable = breedersContainer[
      breedersTableCfg.key
    ] as ComponentsTable<HashedBreederRow>;
    const personsTable = personsContainer[
      personsTableCfg.key
    ] as ComponentsTable<HashedPersonRow>;
    const traitsTable = traitsContainer[
      traitsTableCfg.key
    ] as ComponentsTable<HashedTraitRow>;

    return {
      animalsTable,
      speciesTable,
      breedersTable,
      personsTable,
      traitsTable,
      traitRelation: new MultiReferenceTraitRelation(
        animalsTable._data,
        traitsTable._data,
      ),
    };
  }

  /**
   * Every species version in the store, ordered by `id`. The store hands
   * rows back sorted by hash, which is stable but meaningless to a reader.
   */
  async listSpecies(): Promise<HashedSpeciesRow[]> {
    const { rljson } = await this.db.get(speciesRoute, {});
    const table = rljson[
      speciesTableCfg.key
    ] as ComponentsTable<HashedSpeciesRow>;

    return [...table._data].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }

  /**
   * Every trait version in the store, ordered by `id`, in the shape `GET
   * /api/traits` serves (roadmap section 2.5).
   */
  async listTraits(): Promise<Trait[]> {
    const { rljson } = await this.db.get(traitsRoute, {});
    const table = rljson[traitsTableCfg.key] as ComponentsTable<HashedTraitRow>;

    return [...table._data]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((row) => ({
        id: row.id,
        hash: row._hash,
        name: row.name,
        description: row.description,
      }));
  }

  /**
   * Every breeder version in the store with its person joined, ordered by
   * `id`, in the shape `GET /api/breeders` serves (roadmap section 2.5).
   * Fetches `breeders` and `persons` separately and joins them with a local
   * `Map`, the same explicit fallback `listAnimals` uses for `species`
   * (`docs/findings/db-basics.md`, "Joining a reference"). A breeder whose
   * `personRef` does not resolve gets `person: null` instead of failing the
   * whole list.
   */
  async listBreeders(): Promise<Breeder[]> {
    const [{ rljson: breedersContainer }, { rljson: personsContainer }] =
      await Promise.all([
        this.db.get(breedersRoute, {}),
        this.db.get(personsRoute, {}),
      ]);
    const breedersTable = breedersContainer[
      breedersTableCfg.key
    ] as ComponentsTable<HashedBreederRow>;
    const personsTable = personsContainer[
      personsTableCfg.key
    ] as ComponentsTable<HashedPersonRow>;
    const personsByHash = new Map(
      personsTable._data.map((person) => [person._hash, person]),
    );

    return [...breedersTable._data]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((breeder) => ({
        id: breeder.id,
        hash: breeder._hash,
        farmName: breeder.farmName,
        suppliesSince: breeder.suppliesSince,
        person: resolveBreederPerson(breeder, personsByHash),
      }));
  }

  /**
   * Every animal version in the store with its species and breeder joined,
   * optionally narrowed to one species, one breeder, one trait, or any
   * combination, ordered by `id`. Fetches `animals`, `species`, `breeders`,
   * `persons` and `traits` (and, in `junction` mode, `animalTraits`)
   * separately and joins them with local `Map`s, the explicit fallback of
   * roadmap section 3.2: the rljson route join `animals/species` was tried
   * first, but it silently drops an animal row whose `speciesRef` does not
   * resolve instead of including it with a missing species, which defeats
   * listing every animal (`docs/findings/db-basics.md`, "Joining a
   * reference"). Filtering happens here, in plain JavaScript, after this
   * full read, for the same reason `getAnimal` cannot filter `db.get` by
   * `where`: `id` collides with a column of a *referenced* table and is
   * silently mismatched by `ComponentController`'s reference resolution
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
    const {
      animalsTable,
      speciesTable,
      breedersTable,
      traitsTable,
      traitRelation,
    } = await this.readAnimalTables();
    const speciesByHash = new Map(
      speciesTable._data.map((species) => [species._hash, species]),
    );
    const breedersByHash = new Map(
      breedersTable._data.map((breeder) => [breeder._hash, breeder]),
    );
    const traitHashById = new Map(
      traitsTable._data.map((trait) => [trait.id, trait._hash]),
    );

    let matchingAnimalHashes: Set<string> | undefined;
    if (filter.traitId !== undefined) {
      const traitHash = traitHashById.get(filter.traitId);
      const animalHashes =
        traitHash === undefined
          ? []
          : traitRelation.animalHashesWithTrait(traitHash);
      matchingAnimalHashes = new Set(animalHashes);
    }

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

    const entries = animalsTable._data.filter(matchesFilter).map((animal) => {
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

    return entries.sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * The current version of one animal with its species and breeder joined,
   * its traits resolved and its full `backgroundStory`, or `undefined` when
   * no animal has this id.
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
   * JavaScript. An animal whose `speciesRef` does not resolve gets
   * `speciesId` and `speciesName` of `null`, the same tolerance
   * `listAnimals` has; a trait the configured `TraitRelation` cannot resolve
   * to a stored trait is simply left out of `traits`; a `breederRef` that
   * does not resolve gives `breeder: null` (see `resolveAnimalBreeder`).
   */
  async getAnimal(id: string): Promise<AnimalDetail | undefined> {
    const {
      animalsTable,
      speciesTable,
      breedersTable,
      personsTable,
      traitsTable,
      traitRelation,
    } = await this.readAnimalTables();

    const animal = animalsTable._data.find((row) => row.id === id);
    if (animal === undefined) {
      return undefined;
    }

    const speciesByHash = new Map(
      speciesTable._data.map((species) => [species._hash, species]),
    );
    const breedersByHash = new Map(
      breedersTable._data.map((breeder) => [breeder._hash, breeder]),
    );
    const personsByHash = new Map(
      personsTable._data.map((person) => [person._hash, person]),
    );
    const traitsById = new Map(
      traitsTable._data.map((trait) => [trait.id, trait]),
    );
    const species = speciesByHash.get(animal.speciesRef);
    const breeder = breedersByHash.get(animal.breederRef);
    const traits: TraitSummary[] = traitRelation
      .traitIdsOfAnimal(animal._hash)
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
   * Every row of one components table. `Db.get` with an empty `where` is
   * the one read that is reliable for a table with reference columns
   * (`docs/findings/db-basics.md`, "Filtering by id"), so every method
   * below reads whole tables and joins or filters in JavaScript.
   */
  private async readTable<Row extends { _hash: string }>(
    route: Route,
    tableCfg: TableCfg,
  ): Promise<Row[]> {
    const { rljson } = await this.db.get(route, {});
    const table = rljson[tableCfg.key] as ComponentsTable<Row>;
    return table._data;
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
        this.readTable<HashedInvoiceRow>(invoicesRoute, invoicesTableCfg),
        this.readTable<HashedInvoiceItemRow>(
          invoiceItemsRoute,
          invoiceItemsTableCfg,
        ),
        this.readTable<HashedCustomerRow>(customersRoute, customersTableCfg),
        this.readTable<HashedPersonRow>(personsRoute, personsTableCfg),
        this.readTable<HashedAnimalRow>(animalsRoute, animalsTableCfg),
        this.readTable<HashedSpeciesRow>(speciesRoute, speciesTableCfg),
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
   * Every customer version in the store with its person joined, ordered by
   * `customerNumber`, in the shape `GET /api/customers` serves (roadmap
   * section 2.5). Same explicit two-table join `listBreeders` uses.
   */
  async listCustomers(): Promise<Customer[]> {
    const [customers, persons] = await Promise.all([
      this.readTable<HashedCustomerRow>(customersRoute, customersTableCfg),
      this.readTable<HashedPersonRow>(personsRoute, personsTableCfg),
    ]);
    const personsByHash = byHash(persons);

    return [...customers]
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
   * Every invoice in the store with its customer joined and its total
   * summed, newest invoice number first, in the shape `GET /api/invoices`
   * serves (roadmap section 2.5). Newest first because an invoice list is
   * read for what happened last; `invoiceNumber` sorts in issue order
   * (`invoiceNumbering.ts`).
   */
  async listInvoices(): Promise<InvoiceSummary[]> {
    const tables = await this.readInvoiceTables();

    return [...tables.invoices]
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
    const invoice = tables.invoices.find((row) => row.id === id);

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
    const customer = tables.customers.find(
      (row) => row.id === command.customerId,
    );
    if (customer === undefined) {
      throw new InvoiceValidationError(
        `No customer with id "${command.customerId}".`,
      );
    }
    const lines = command.items.map((item) => {
      const animal = tables.animals.find((row) => row.id === item.animalId);
      if (animal === undefined) {
        throw new InvoiceValidationError(
          `No animal with id "${item.animalId}".`,
        );
      }
      return { animal, quantity: item.quantity };
    });

    const number = invoiceNumber(issuedOn, tables.invoices.length + 1);
    const invoice = hashed({
      id: invoiceId(number),
      invoiceNumber: number,
      customerRef: customer._hash,
      issuedOn,
      status,
    });
    const changeSetItems = await this.writeRow(
      invoicesRoute,
      invoicesTableCfg,
      invoice,
    );
    const items: HashedInvoiceItemRow[] = [];
    for (const [index, line] of lines.entries()) {
      const item = hashed({
        id: invoiceItemId(number, index + 1),
        invoiceRef: invoice._hash,
        animalRef: line.animal._hash,
        quantity: line.quantity,
        unitPriceCents: line.animal.priceCents,
      });
      changeSetItems.push(
        ...(await this.writeRow(invoiceItemsRoute, invoiceItemsTableCfg, item)),
      );
      items.push(item);
    }
    const changeSet = await this.writeChangeSet(
      issueInvoiceChangeSetId(number),
      changeSetItems,
    );

    return invoiceDetail(invoice, {
      ...tables,
      invoices: [...tables.invoices, invoice],
      invoiceItems: [...tables.invoiceItems, ...items],
      changeSets: [...tables.changeSets, changeSet],
    });
  }

  /**
   * Writes one row through `Db.insert`, which also writes its InsertHistory
   * row, and returns the two change set items that name them: the row by
   * its own hash and the history row by the hash `IoMem` stored it under,
   * which equals the hash of the row `Db.insert` returns
   * (`docs/findings/change-sets.md`).
   */
  private async writeRow(
    route: Route,
    tableCfg: TableCfg,
    row: HashedInvoiceRow | HashedInvoiceItemRow,
  ): Promise<ChangeSetItem[]> {
    const [historyRow] = await this.db.insert(route, {
      [tableCfg.key]: { _type: 'components', _data: [row] },
    });

    return [
      { table: tableCfg.key, ref: row._hash },
      {
        table: `${tableCfg.key}InsertHistory`,
        ref: hashed({ ...historyRow })._hash,
      },
    ];
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

  async close(): Promise<void> {
    await this.io.close();
  }
}
