import { BsMem, type Bs } from '@rljson/bs';
import { Db } from '@rljson/db';
import type { Io } from '@rljson/io';
import type { FastifyBaseLogger } from 'fastify';
import {
  Route,
  timeId,
  type BuffetsTable,
  type ComponentsTable,
  type InsertHistoryRow,
  type InsertHistoryTable,
  type Rljson,
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
  blobIdOf,
  breedersInsertHistoryTableCfg,
  breedersSeed,
  breedersTableCfg,
  changeSetsInsertHistoryTableCfg,
  changeSetsTableCfg,
  createSeedClock,
  currentRows,
  customersInsertHistoryTableCfg,
  customersSeed,
  customersTableCfg,
  generatedSeedFor,
  hashed,
  invoiceItemsInsertHistoryTableCfg,
  invoiceItemsTableCfg,
  invoiceNumber,
  invoiceRows,
  invoicesInsertHistoryTableCfg,
  invoicesTableCfg,
  issueInvoiceChangeSetId,
  nextInvoiceSequence,
  seedChangeSetId,
  seedInvoices,
  seedPlans,
  speciesImage,
  speciesImageBlobId,
  personsInsertHistoryTableCfg,
  personsSeed,
  personsTableCfg,
  referenceColumnOf,
  speciesInsertHistoryTableCfg,
  speciesSeed,
  speciesTableCfg,
  traitsInsertHistoryTableCfg,
  traitsRefsOf,
  traitsSeed,
  traitsTableCfg,
  updateAnimalChangeSetId,
  updateSpeciesImageChangeSetId,
  versionsOf,
  type AnimalChanges,
  type ChangeSetItem,
  type GeneratedSeed,
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
  type SeedClock,
  type SeedSize,
  type UploadedImageMediaType,
  type VersionHistoryRow,
} from '@rljson-tryout/domain';

import { IoSwitch, type ReadCascade } from './ioSwitch.ts';
import {
  JunctionTraitRelation,
  MultiReferenceTraitRelation,
  type TraitRelation,
  type TraitRelationMode,
} from './traitRelation.ts';

const changeSetsRoute = Route.fromFlat(changeSetsTableCfg.key);

/**
 * The `origin` of the InsertHistory rows this store writes itself rather
 * than through `Db.insert` (which writes `db.insert`): the seed's rows and
 * change sets, the change sets of the API paths, and the change sets
 * received from another node.
 */
const seedOrigin = 'seed';
const apiOrigin = 'core.import';
const syncOrigin = 'sync';

const historyTableKeyOf = (tableKey: string): string =>
  `${tableKey}InsertHistory`;

/**
 * Whether a value from the network or a request may enter an
 * `Io.readRows` `where` clause as a `timeId`: digits, a colon and the four
 * characters of the nanoid alphabet, the shape `timeId()` of
 * `@rljson/rljson` issues and `seedTimeId` reproduces. Same reason as
 * `isSafeWhereValue`.
 */
const isSafeTimeId = (value: string): boolean =>
  /^\d+:[A-Za-z0-9_-]{4}$/u.test(value);

/**
 * Every domain table of roadmap section 2.6 with its InsertHistory
 * companion, in creation order. `domainTableCfgs` is the list without the
 * companions, which is what `Server.createTables` and
 * `Client.createTables` of `@rljson/server` take (`withInsertHistory`
 * derives the companion itself, with the same `createInsertHistoryTableCfg`
 * the domain package uses, so creating them again on a role change is a
 * no-op on every store).
 */
const tablePairs: readonly (readonly [TableCfg, TableCfg])[] = [
  [speciesTableCfg, speciesInsertHistoryTableCfg],
  [traitsTableCfg, traitsInsertHistoryTableCfg],
  [personsTableCfg, personsInsertHistoryTableCfg],
  [breedersTableCfg, breedersInsertHistoryTableCfg],
  [animalsTableCfg, animalsInsertHistoryTableCfg],
  [animalTraitsTableCfg, animalTraitsInsertHistoryTableCfg],
  [customersTableCfg, customersInsertHistoryTableCfg],
  [invoicesTableCfg, invoicesInsertHistoryTableCfg],
  [invoiceItemsTableCfg, invoiceItemsInsertHistoryTableCfg],
  [changeSetsTableCfg, changeSetsInsertHistoryTableCfg],
];

export const domainTableCfgs: readonly TableCfg[] = tablePairs.map(
  ([tableCfg]) => tableCfg,
);

/**
 * Whether a value from a request may enter an `Io.readRows` `where`
 * clause: hashes are URL-safe base64 and every entity id in this project
 * is a slug of letters, digits, hyphens and underscores. `IoSqliteNode`
 * builds its `WHERE` by string concatenation without escaping
 * (`docs/findings/stores.md`), and a read that falls through to the hub
 * runs the same clause on every store of the network, so nothing else is
 * ever passed on.
 */
const isSafeWhereValue = (value: string): boolean =>
  /^[A-Za-z0-9_-]+$/u.test(value);

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
 * itself; `speciesImageUrl` is the path the image of that species version
 * is served at (`speciesImagePath`). `speciesId`, `speciesName`,
 * `speciesImageUrl`, `breederId` and `breederFarmName` are `null` for the
 * store-integrity case of an animal whose reference does not resolve to a
 * row in the store, rather than the method failing the whole list for one
 * broken row. Traits are used to filter this list
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
  speciesImageUrl: string | null;
  breederId: string | null;
  breederFarmName: string | null;
  bornOn: string;
  priceCents: number;
};

/**
 * Narrows `listAnimals` to the animals of one species, one breeder and, or,
 * one trait, and, or, to the animals whose name or species name contains
 * `query` (case-insensitive). All four narrow the same list and combine
 * with a logical AND.
 */
export type AnimalFilter = {
  speciesId?: string;
  breederId?: string;
  traitId?: string;
  query?: string;
};

/**
 * Which slice of a filtered list to return: `limit` rows from `offset` on.
 * `GET /api/animals` defaults to the first fifty (roadmap section 2.5).
 */
export type PageRequest = {
  limit: number;
  offset: number;
};

export const defaultPageRequest: PageRequest = { limit: 50, offset: 0 };

/**
 * One page of animals as `PetShopStore.listAnimals` returns it and
 * `GET /api/animals` serves it: the rows of the requested slice, the
 * number of rows the filter matches in total, and the slice itself, so a
 * client can show "50 of 2 000" and ask for the next page.
 */
export type AnimalPage = {
  items: AnimalWithSpecies[];
  total: number;
  limit: number;
  offset: number;
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
 * a detail resolve their references against one consistent snapshot, with
 * the lookups by hash built once per read rather than once per invoice,
 * which is what keeps a list of thousands of invoices linear. `invoices`,
 * `customers` and `animals` are versioned: the list serves current
 * invoices, `issueInvoice` resolves a customer or animal id to its current
 * version, and every join by hash reads all versions.
 */
type InvoiceTables = {
  invoices: VersionedTable<HashedInvoiceRow>;
  invoiceItemsByInvoiceRef: Map<string, HashedInvoiceItemRow[]>;
  customers: VersionedTable<HashedCustomerRow>;
  customersByHash: Map<string, HashedCustomerRow>;
  personsByHash: Map<string, HashedPersonRow>;
  animals: VersionedTable<HashedAnimalRow>;
  animalsByHash: Map<string, HashedAnimalRow>;
  speciesByHash: Map<string, HashedSpeciesRow>;
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
 * A hashed row of any domain table the seed writes.
 */
type SeedRow =
  | HashedSpeciesRow
  | HashedTraitRow
  | HashedPersonRow
  | HashedBreederRow
  | HashedCustomerRow
  | HashedAnimalRow
  | HashedAnimalTraitRow
  | HashedInvoiceRow
  | HashedInvoiceItemRow;

/**
 * The rows one part of the seed consists of, hashed, in the order the
 * tables reference each other: the hand-written Duckburg seed is one such
 * part, the generated rows of `medium` and `large` another
 * (`GeneratedSeed`), and `seedIfEmpty` writes both through the same path.
 */
type SeedPart = GeneratedSeed;

/**
 * The hand-written seed as one part: every pre-hashed row of the domain
 * package plus the six invoices as rows (`seedInvoices`).
 */
const handWrittenSeedPart: SeedPart = {
  species: [...speciesSeed],
  traits: [...traitsSeed],
  persons: [...personsSeed],
  breeders: [...breedersSeed],
  customers: [...customersSeed],
  animals: [...animalsSeed],
  animalTraits: [...animalTraitsSeed],
  invoices: seedInvoices.map((seed) => seed.invoice),
  invoiceItems: seedInvoices.flatMap((seed) => seed.items),
};

/**
 * A row of any table as the synchronisation of slice D3 pulls it from
 * another node and writes it into this one: its content hash plus
 * whatever columns the table has. The store writes it exactly as received
 * (`writeReceivedRows`), never re-hashed and never with a new InsertHistory
 * row, because the history rows of a change set are among its items.
 */
export type SyncRow = { _hash: string } & Record<string, unknown>;

/**
 * One change set a store holds completely, as the catch-up of slice D4
 * lists them: the change set's hash and the `timeId` of the history row
 * the store recorded it with, which orders the change sets the way that
 * store learned about them (its own in write order, received ones in the
 * order they arrived).
 */
export type HeldChangeSet = Readonly<{ hash: string; timeId: string }>;

/**
 * The stores of the nodes this node is connected to, as the hub transport
 * hands them to the store for the pulls of the synchronisation: a function
 * returning the current `IoPeer`s (one per client on the hub, the hub's on
 * a client), or `null` while the node has no role. A peer store answers
 * from that node's store, or, on the hub's `IoServer`, from the hub's own
 * cascade; nothing read this way is written into this node's store, which
 * is the point (`writeReceivedRows` does that, for a whole change set at
 * once).
 */
export type PeerStores = (() => readonly Pick<Io, 'readRows'>[]) | null;

/**
 * One row as `writeReceivedRows` takes it: the table it belongs to and the
 * row as another node served it.
 */
export type ReceivedRow = Readonly<{ table: string; row: SyncRow }>;

/**
 * One item of a change set as `GET /api/change-sets/:hash` serves it
 * (slice D3b): the table and row hash the change set names, the row as
 * this store holds it (`null` for a row the store lacks, which a change
 * set recorded without its rows leaves behind), and, for a data row whose
 * InsertHistory row in the same change set names a `previous` version,
 * that version's row (`null` for a first version, a row whose predecessor
 * this store does not hold, and every InsertHistory row).
 */
export type ChangeSetPayloadItem = Readonly<{
  table: string;
  ref: string;
  row: SyncRow | null;
  previousRow: SyncRow | null;
}>;

/**
 * A change set with the content of its rows, what the web app shows when
 * a transfer is expanded.
 */
export type ChangeSetPayload = Readonly<{
  hash: string;
  id: string;
  items: readonly ChangeSetPayloadItem[];
}>;

const millisecondsOf = (historyTimeId: string): number =>
  Number(historyTimeId.split(':')[0]);

/** Orders held change sets by their history `timeId`, oldest first. */
export const byTimeId = (left: HeldChangeSet, right: HeldChangeSet): number =>
  millisecondsOf(left.timeId) - millisecondsOf(right.timeId) ||
  left.timeId.localeCompare(right.timeId);

type ChangeSetHistoryRow = { changeSetsRef: string; timeId: string };

const heldChangeSetsIn = (rljson: Rljson): HeldChangeSet[] => {
  const table = rljson[
    changeSetsInsertHistoryTableCfg.key
  ] as InsertHistoryTable<string>;
  return (table._data as unknown as ChangeSetHistoryRow[])
    .map((row) => ({ hash: row.changeSetsRef, timeId: row.timeId }))
    .sort(byTimeId);
};

/**
 * The change sets another node holds, read from that node's store through
 * the given `Io` (the `IoPeer` of `@rljson/server` towards it), oldest
 * first. A table dump rather than a row read on purpose: `IoMulti` answers
 * a whole-table `readRows` from the first layer that holds any row and
 * caches the answer in the layers that did not, so a client reading the
 * hub's table that way through the hub's `IoServer` would, on a hub with an
 * empty table, pull another client's history rows into the hub's store and
 * make the hub count change sets as held that it never pulled. A dump is
 * served from a multi's dumpable members alone, the node's own store, and
 * writes nothing back (`docs/findings/change-set-sync.md`).
 */
export const heldChangeSetsOf = async (
  peer: Pick<Io, 'dumpTable'>,
): Promise<HeldChangeSet[]> =>
  heldChangeSetsIn(
    await peer.dumpTable({ table: changeSetsInsertHistoryTableCfg.key }),
  );

/**
 * Called with every change set this store writes on its own account (an
 * invoice issued, an animal edited, the seed), in write order, together
 * with the ids of the entities it wrote: the rows of the domain tables
 * the change set names (an invoice and its items, an animal and its
 * trait pairings), not their history rows. A change set received from
 * another node is written without this call: it was announced by the
 * node that wrote it.
 */
export type ChangeSetListener = (
  changeSet: HashedChangeSetRow,
  entityIds: readonly string[],
) => void;

/**
 * What `PetShopStore.seedIfEmpty` reports: the size it was asked for and
 * how many rows of each kind it wrote, hand-written and generated together,
 * all zero when the store already held rows. `invoicesSeeded` counts
 * invoices, not their items; `changeSetsSeeded` counts the change sets,
 * one per seeded entity (a species, a trait, a person, a breeder, a
 * customer, an animal with its junction rows, an invoice with its items).
 */
export type SeedReport = {
  seedSize: SeedSize;
  speciesSeeded: number;
  traitsSeeded: number;
  personsSeeded: number;
  breedersSeeded: number;
  customersSeeded: number;
  animalsSeeded: number;
  animalTraitsSeeded: number;
  invoicesSeeded: number;
  changeSetsSeeded: number;
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
 * The invoice items grouped by the invoice they belong to, built once per
 * read so that a list of thousands of invoices resolves its items in one
 * pass over the items instead of one pass per invoice.
 */
const groupByInvoiceRef = (
  items: readonly HashedInvoiceItemRow[],
): Map<string, HashedInvoiceItemRow[]> => {
  const grouped = new Map<string, HashedInvoiceItemRow[]>();
  for (const item of items) {
    const group = grouped.get(item.invoiceRef) ?? [];
    group.push(item);
    grouped.set(item.invoiceRef, group);
  }
  return grouped;
};

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
  return [...(tables.invoiceItemsByInvoiceRef.get(invoice._hash) ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => {
      const animal = tables.animalsByHash.get(item.animalRef);
      return {
        id: item.id,
        hash: item._hash,
        animal:
          animal === undefined
            ? null
            : {
                id: animal.id,
                name: animal.name,
                speciesName:
                  tables.speciesByHash.get(animal.speciesRef)?.name ?? null,
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
  const customer = tables.customersByHash.get(invoice.customerRef);
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
              resolveCustomerPerson(customer, tables.personsByHash)?.name ??
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
  const customer = tables.customersByHash.get(invoice.customerRef);
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
            person: resolveCustomerPerson(customer, tables.personsByHash),
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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs a read with a bound on the wait: a read that outlives the given
 * milliseconds is abandoned (it settles later, ignored) and counts as a
 * network that did not answer.
 */
const withinMilliseconds = <Value>(
  milliseconds: number,
  what: string,
  read: () => Promise<Value>,
): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`pull of ${what} exceeded ${milliseconds} ms`));
    }, milliseconds);
    read().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

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
 * The path `GET /api/species/:hash/image` serves the image of one species
 * version at (roadmap section 2.5), as the species list and the animal
 * payloads link to it. Content addressed twice over: the species hash
 * covers the row's `imageBlobId`, and the blob id covers the PNG bytes, so
 * the same path always serves the same bytes and a client may cache them
 * for good. A hash is URL-safe base64, so nothing needs escaping.
 */
export const speciesImagePath = (speciesHash: string): string =>
  `/api/species/${speciesHash}/image`;

/**
 * The image of one species version as `PetShopStore.speciesImage` returns
 * it: the bytes and the media type the species row names.
 */
export type SpeciesImage = Readonly<{
  content: Buffer;
  mimeType: string;
}>;

/**
 * What `PetShopStore.speciesImage` finds for a species version's hash:
 * the image, or why there is none to serve. `unknown-version` when no
 * species row of this store has the hash; `unavailable` when the row is
 * there but its blob is held neither by this node nor by any node the
 * network could ask, or was not served within `blobPullTimeoutMs`, with
 * the blob id the row names and the reason.
 */
export type SpeciesImageLookup =
  | { outcome: 'found'; image: SpeciesImage }
  | { outcome: 'unknown-version' }
  | { outcome: 'unavailable'; blobId: string; reason: string };

/**
 * A blob store the node reads through when its own store lacks a blob
 * (slice D5): the `Bs` multi of the hub transport's `Server` or `Client`
 * (`server.bs`, `client.bs`), asked for on every read because
 * `@rljson/server` rebuilds it on every client join and leave, `undefined`
 * from a client whose peer is not up, or `null` while the node has no
 * role. A multi reads the local store first, then the `BsPeer` to the hub
 * (on the hub: to every client), and writes what a peer served into the
 * local store on the way (`docs/findings/blobs.md`).
 */
export type BlobCascade = (() => Bs | undefined) | null;

/**
 * The bytes `PetShopStore.pullBlob` found for a blob id and where: in
 * this node's own blob store, or on another node, in which case they are
 * in this node's store now too.
 */
export type PulledBlob = Readonly<{
  content: Buffer;
  source: 'local' | 'network';
}>;

/**
 * Thrown by `pullBlob` when another node served bytes for a blob id that
 * hash to a different id: the blob is refused and never lands under the
 * id it was asked for (slice D5; the chaos slices D15 and D16 build on
 * this check).
 */
export class BlobMismatchError extends Error {
  readonly blobId: string;
  readonly servedBlobId: string;

  constructor(blobId: string, servedBlobId: string) {
    super(
      `the network served bytes for blob ${blobId} that hash to ${servedBlobId}, refused`,
    );
    this.name = 'BlobMismatchError';
    this.blobId = blobId;
    this.servedBlobId = servedBlobId;
  }
}

/**
 * What `PetShopStore` can be given at construction: `blobs` is the blob
 * store the species images live in, the one `main.ts` also hands to the
 * hub transport so that a peer reads the same blobs (a fresh in-memory
 * one when absent, for tests); `traitRelationMode` picks the
 * implementation of the animal-trait relation (`docs/findings/n-to-m.md`,
 * default `multi-reference`); `today` returns the ISO date an issued
 * invoice is dated with, replaceable in tests so that an invoice number
 * and date can be asserted exactly; `logger` receives the warning when a
 * read through the network fails (a silent default for tests that build a
 * store without one); `blobPullTimeoutMs` bounds how long `speciesImage`
 * waits for a blob another node serves on demand (ten seconds by default,
 * the `BsPeer` of `@rljson/bs` would wait thirty).
 */
export type PetShopStoreOptions = Readonly<{
  blobs?: Bs;
  traitRelationMode?: TraitRelationMode;
  today?: () => string;
  logger?: Pick<FastifyBaseLogger, 'warn'>;
  blobPullTimeoutMs?: number;
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
 *
 * The `Db` sits on an `IoSwitch` over that `Io`: while the node is hub or
 * client, the hub transport points the switch's row reads through the
 * `IoMulti` of its `Server` or `Client` (`readThrough`), so a row the
 * local store does not hold is looked up on the hub and cached locally;
 * writes and whole-table reads always go to the local `Io`, so lists show
 * what this node holds until slice D3 pulls change sets, while `getAnimal`
 * with a `version` and `getInvoice` fall back to a targeted read that does
 * cascade (`docs/findings/hub-transport.md`).
 */
export class PetShopStore {
  /**
   * The `Io` the configured storage gave this store, for the hub transport
   * to lend to `@rljson/server`: as hub it is what the `Server` serves to
   * the clients, as client it is what the `Client` exposes to the hub.
   */
  readonly localIo: Io;
  /**
   * The blob store the species images are written to at seed time and on
   * upload and read from by `speciesImage`: `BsMem` on every node until
   * slice C2 puts the blobs of a persistent node on disk.
   */
  readonly blobs: Bs;
  private readonly io: IoSwitch;
  private readonly db: Db;
  private readonly traitRelationMode: TraitRelationMode;
  private readonly today: () => string;
  private readonly logger: Pick<FastifyBaseLogger, 'warn'>;
  private readonly blobPullTimeoutMs: number;

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
  private readonly tableCfgs = tablePairs.flat();

  private readonly tableCfgsByKey = new Map(
    this.tableCfgs.map((tableCfg) => [tableCfg.key, tableCfg]),
  );

  private readonly changeSetListeners = new Set<ChangeSetListener>();

  private peers: PeerStores = null;

  private blobCascade: BlobCascade = null;

  constructor(io: Io, options: PetShopStoreOptions = {}) {
    this.localIo = io;
    this.blobs = options.blobs ?? new BsMem();
    this.io = new IoSwitch(io);
    this.db = new Db(this.io);
    this.traitRelationMode = options.traitRelationMode ?? 'multi-reference';
    this.today = options.today ?? todayInUtc;
    this.logger = options.logger ?? { warn: () => undefined };
    this.blobPullTimeoutMs = options.blobPullTimeoutMs ?? 10_000;
  }

  /**
   * Routes every row read of this store through the given cascade (the
   * `IoMulti` of the hub transport's `Server` or `Client`, asked for on
   * every read because `@rljson/server` rebuilds it on every client join
   * and leave), or back to the local `Io` alone with `null`. Writes are
   * unaffected either way.
   */
  readThrough(cascade: ReadCascade): void {
    this.io.readThrough(cascade);
  }

  /** Whether row reads currently fall through to the network. */
  get readsThroughNetwork(): boolean {
    return this.io.cascading;
  }

  /**
   * Names the peer stores `pullRow` and `pullHistoryRow` read from (the
   * `IoPeer`s of the hub transport's `Server` towards its clients, or of
   * its `Client` towards the hub, asked for on every pull because the
   * server's list changes with every join and leave), or `null` when the
   * node has none.
   */
  pullThrough(peers: PeerStores): void {
    this.peers = peers;
  }

  /**
   * Names the blob store `pullBlob` reads through when this node's own
   * lacks a blob (the `Bs` multi of the hub transport's `Server` or
   * `Client`), or `null` when the node has none.
   */
  fetchBlobsThrough(cascade: BlobCascade): void {
    this.blobCascade = cascade;
  }

  /**
   * Registers a listener for every change set this store writes on its
   * own account, which is what the `SyncAgent` announces to the other
   * nodes (roadmap section 3.4). Returns the function that unregisters
   * it.
   */
  onChangeSetWritten(listener: ChangeSetListener): () => void {
    this.changeSetListeners.add(listener);
    return () => {
      this.changeSetListeners.delete(listener);
    };
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
   * Whether no table of the store holds a row yet: the state a node is in
   * at its first start, and the only state `seedIfEmpty` writes into. A
   * persistent store that already holds rows keeps them, whatever
   * `SEED_SIZE` says.
   */
  private async isEmpty(): Promise<boolean> {
    for (const tableCfg of this.tableCfgs) {
      if ((await this.io.rowCount(tableCfg.key)) > 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Seeds an empty store with the given size (roadmap section 2.4) and
   * reports how many rows of each kind it wrote; a store that already
   * holds rows is left alone and reported with zero counts. The
   * hand-written seed (every size but `none`) goes in first, the
   * generated rows of `medium` and `large` after it, both through
   * `writeSeedPart`: species, traits, persons, breeders, customers, then
   * animals with their `animalTraits` junction rows and finally the
   * invoices with their items, each table after the tables its rows
   * reference by hash, one change set per entity. The image of every
   * seeded species goes into the blob store on the way (`storeSpeciesImage`).
   *
   * The seed is deterministic down to its InsertHistory rows and change
   * sets: every history row gets its `timeId` from one `SeedClock`
   * (`seedTimeId`, a fixed epoch plus a counter) instead of the clock of
   * the node, so that two nodes seeding the same size hold identical
   * rows, identical history rows and identical change set hashes, and a
   * seed change set one node announces is a no-op on every other node
   * (`docs/findings/change-set-sync.md`). The hand-written part comes
   * first on every size, so a `small` store is a prefix of a `medium`
   * one. Rows and history rows are written through `Core.import` rather
   * than `Db.insert`, which issues its own `timeId`s and offers no way to
   * pass one in (`docs/findings/seed-generator.md`).
   */
  async seedIfEmpty(size: SeedSize = 'small'): Promise<SeedReport> {
    const report: SeedReport = {
      seedSize: size,
      speciesSeeded: 0,
      traitsSeeded: 0,
      personsSeeded: 0,
      breedersSeeded: 0,
      customersSeeded: 0,
      animalsSeeded: 0,
      animalTraitsSeeded: 0,
      invoicesSeeded: 0,
      changeSetsSeeded: 0,
    };
    const plan = seedPlans[size];
    if (!plan.handWritten || !(await this.isEmpty())) {
      return report;
    }

    const clock = createSeedClock();
    const parts = [handWrittenSeedPart, generatedSeedFor(size)].filter(
      (part): part is SeedPart => part !== null,
    );
    for (const part of parts) {
      report.changeSetsSeeded += await this.writeSeedPart(part, clock);
      report.speciesSeeded += part.species.length;
      report.traitsSeeded += part.traits.length;
      report.personsSeeded += part.persons.length;
      report.breedersSeeded += part.breeders.length;
      report.customersSeeded += part.customers.length;
      report.animalsSeeded += part.animals.length;
      report.animalTraitsSeeded += part.animalTraits.length;
      report.invoicesSeeded += part.invoices.length;
    }

    return report;
  }

  /**
   * Writes one part of the seed: one change set per logical entity naming
   * every row it consists of, InsertHistory rows included (roadmap
   * section 3.4): a species, a trait, a person, a breeder, a customer, an
   * animal with its `animalTraits` junction rows, and an invoice with its
   * items under the same `issue-invoice-<number>` id `issueInvoice` uses.
   * Every row gets its own history row with the next `timeId` of the
   * clock, so the version rule of roadmap section 2.6 applies to seeded
   * data exactly as to written data. Returns the number of change sets
   * written.
   */
  private async writeSeedPart(
    part: SeedPart,
    clock: SeedClock,
  ): Promise<number> {
    let changeSets = 0;
    const single = async (tableCfg: TableCfg, rows: readonly SeedRow[]) => {
      for (const row of rows) {
        await this.writeSeedEntity(
          seedChangeSetId(tableCfg.key, row.id),
          [[tableCfg, row]],
          clock,
        );
        changeSets += 1;
      }
    };

    await single(speciesTableCfg, part.species);
    for (const species of part.species) {
      await this.storeSpeciesImage(species.id);
    }
    await single(traitsTableCfg, part.traits);
    await single(personsTableCfg, part.persons);
    await single(breedersTableCfg, part.breeders);
    await single(customersTableCfg, part.customers);

    const pairingsByAnimalRef = new Map<string, HashedAnimalTraitRow[]>();
    for (const pairing of part.animalTraits) {
      const pairings = pairingsByAnimalRef.get(pairing.animalRef) ?? [];
      pairings.push(pairing);
      pairingsByAnimalRef.set(pairing.animalRef, pairings);
    }
    for (const animal of part.animals) {
      await this.writeSeedEntity(
        seedChangeSetId(animalsTableCfg.key, animal.id),
        [
          [animalsTableCfg, animal],
          ...(pairingsByAnimalRef.get(animal._hash) ?? []).map(
            (pairing): [TableCfg, SeedRow] => [animalTraitsTableCfg, pairing],
          ),
        ],
        clock,
      );
      changeSets += 1;
    }

    const itemsByInvoiceRef = groupByInvoiceRef(part.invoiceItems);
    for (const invoice of part.invoices) {
      await this.writeSeedEntity(
        issueInvoiceChangeSetId(invoice.invoiceNumber),
        [
          [invoicesTableCfg, invoice],
          ...(itemsByInvoiceRef.get(invoice._hash) ?? []).map(
            (item): [TableCfg, SeedRow] => [invoiceItemsTableCfg, item],
          ),
        ],
        clock,
      );
      changeSets += 1;
    }

    return changeSets;
  }

  /**
   * Writes the rows of one seed entity, each with a history row stamped
   * by the clock, and one change set naming all of them, stamped by the
   * clock as well, in the given order.
   */
  private async writeSeedEntity(
    changeSetId: string,
    rows: readonly (readonly [TableCfg, SeedRow])[],
    clock: SeedClock,
  ): Promise<void> {
    const items: ChangeSetItem[] = [];
    for (const [tableCfg, row] of rows) {
      items.push(...(await this.writeSeedRow(tableCfg, row, clock.next())));
    }
    await this.recordChangeSet(hashed({ id: changeSetId, items }), {
      timeId: clock.next(),
      origin: seedOrigin,
      announce: rows.map(([, row]) => row.id),
    });
  }

  /**
   * Writes one seed row and its InsertHistory row with the given `timeId`
   * through `Core.import`, the way `Db._writeInsertHistory` writes a
   * history row, and reports the two change set items naming them. The
   * history row has the shape `Db.insert` would write (`timeId`,
   * `<table>Ref`, `route`, `origin`, `previous: []`), with `origin` set
   * to `seed`.
   */
  private async writeSeedRow(
    tableCfg: TableCfg,
    row: SeedRow,
    rowTimeId: string,
  ): Promise<ChangeSetItem[]> {
    const historyTableKey = historyTableKeyOf(tableCfg.key);
    const historyRow: InsertHistoryRow<string> = {
      timeId: rowTimeId,
      route: Route.fromFlat(tableCfg.key).flat,
      origin: seedOrigin,
      previous: [],
    };
    // The reference column is named after the table (`animalsRef`), a key
    // the type only knows as a pattern.
    (historyRow as Record<string, unknown>)[`${tableCfg.key}Ref`] = row._hash;
    await this.db.core.import(
      { [tableCfg.key]: { _type: 'components', _data: [row] } },
      { validate: false },
    );
    await this.db.core.import(
      { [historyTableKey]: { _type: 'insertHistory', _data: [historyRow] } },
      { validate: false },
    );

    return [
      { table: tableCfg.key, ref: row._hash },
      { table: historyTableKey, ref: hashed(historyRow)._hash },
    ];
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
   * A targeted read of one table, the one kind of read that falls through
   * to the network while this node is hub or client: `IoMulti.readRows`
   * walks its layers by priority and answers from the first that returns
   * rows, so a `where` the local store has no row for is asked of the hub
   * and, through the hub, of every other client, and what comes back is
   * cached in the local store on the way (`docs/findings/hub-transport.md`).
   * Values are checked with `isSafeWhereValue` first; an unsafe value reads
   * as "nothing found". A cascade that cannot answer (the hub gone between
   * two probe cycles, a peer that did not answer within the 30 s of
   * `IoPeer`) reads as "nothing found" too, so the node stays usable on
   * its local data; the failure is logged here and the hub transport
   * reports socket-level failures in `/status` under `transport.lastError`.
   */
  private async readMatching<Row extends { _hash: string }>(
    tableCfg: TableCfg,
    where: Record<string, string>,
  ): Promise<Row[]> {
    if (!Object.values(where).every(isSafeWhereValue)) {
      return [];
    }
    try {
      const rljson = await this.io.readRows({ table: tableCfg.key, where });
      return (rljson[tableCfg.key] as ComponentsTable<Row>)._data;
    } catch (error) {
      this.logger.warn(
        { err: error, table: tableCfg.key, where },
        'read through the network failed, answering from local data',
      );
      return [];
    }
  }

  /**
   * The given rows by hash plus, for every hash the map lacks, the row of
   * that hash read through `readMatching`: how a detail assembled from a
   * row another node wrote resolves that row's references when the local
   * tables do not hold them. The map passed in is left untouched.
   */
  private async withRowsOfHashes<Row extends { _hash: string }>(
    known: ReadonlyMap<string, Row>,
    tableCfg: TableCfg,
    hashes: readonly string[],
  ): Promise<Map<string, Row>> {
    const fetched = await Promise.all(
      [...new Set(hashes)]
        .filter((hash) => !known.has(hash))
        .map((hash) => this.readMatching<Row>(tableCfg, { _hash: hash })),
    );
    return new Map([...known, ...byHash(fetched.flat())]);
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
    const [rows, history] = await Promise.all([
      this.readRows<Row>(tableCfg),
      this.readHistoryRows(tableCfg),
    ]);

    return { rows, history, current: currentRows(rows, history, tableCfg.key) };
  }

  /**
   * Every InsertHistory row of one entity table, read straight from the
   * `Io` rather than through `Db.getInsertHistory`: that call dumps the
   * table, and `IoMem` recomputes the hash of the whole store before any
   * dump that follows a write, which with the large seed costs several
   * hundred milliseconds per read after every write
   * (`docs/findings/seed-generator.md`). `Io.readRows` with an empty
   * `where` returns the same rows without the refresh, the way
   * `readChangeSets` already reads its table.
   */
  private async readHistoryRows(
    tableCfg: TableCfg,
  ): Promise<VersionHistoryRow[]> {
    const historyTableKey = `${tableCfg.key}InsertHistory`;
    const rljson = await this.io.readRows({
      table: historyTableKey,
      where: {},
    });
    const historyTable = rljson[historyTableKey] as InsertHistoryTable<string>;
    return historyTable._data as VersionHistoryRow[];
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
   * Renders the image of a species from its id and stores it in the blob
   * store, which names it by its content: storing the same image twice
   * keeps one blob under one id (`docs/findings/blobs.md`). Returns the
   * bytes and the id the store gave them.
   */
  private async storeSpeciesImage(
    speciesId: string,
  ): Promise<{ content: Buffer; blobId: string }> {
    const content = Buffer.from(speciesImage(speciesId));
    const { blobId } = await this.blobs.setBlob(content);
    return { content, blobId };
  }

  /**
   * The image of one species version, by the version's hash, as
   * `GET /api/species/:hash/image` serves it, or why there is none
   * (`SpeciesImageLookup`). The species row is read from the local store;
   * its bytes come from the blob store under the row's `imageBlobId`,
   * else from the network through `pullBlob`, within `blobPullTimeoutMs`,
   * which also caches them here; else, for a seed species alone (a row
   * whose `imageBlobId` is what the renderer produces for its id: a
   * `sqlite` node restarted with its rows on disk but its blobs in a fresh
   * `BsMem`, until slice C2 keeps them on disk too), rendered again from
   * the species id and stored, which yields the same bytes under the same
   * id because the image is a pure function of the id. An uploaded image
   * (slice D5) cannot be rendered again: a node that holds the species
   * version but got the blob from nowhere answers `unavailable`, with the
   * reason logged.
   */
  async speciesImage(hash: string): Promise<SpeciesImageLookup> {
    if (!isSafeWhereValue(hash)) {
      return { outcome: 'unknown-version' };
    }
    const species = (await this.localRow(speciesTableCfg.key, hash)) as
      HashedSpeciesRow | undefined;
    if (species === undefined) {
      return { outcome: 'unknown-version' };
    }
    const found = (content: Buffer): SpeciesImageLookup => ({
      outcome: 'found',
      image: { content, mimeType: species.imageMimeType },
    });
    let reason: string;
    try {
      const pulled = await withinMilliseconds(
        this.blobPullTimeoutMs,
        `blob ${species.imageBlobId}`,
        () => this.pullBlob(species.imageBlobId),
      );
      if (pulled !== undefined) {
        return found(pulled.content);
      }
      reason = 'no node holds the blob';
    } catch (error) {
      reason = errorMessage(error);
    }
    if (species.imageBlobId === speciesImageBlobId(species.id)) {
      const rendered = await this.storeSpeciesImage(species.id);
      return found(rendered.content);
    }
    this.logger.warn(
      {
        speciesId: species.id,
        speciesHash: hash,
        imageBlobId: species.imageBlobId,
        reason,
      },
      'species image is not available on this node or the network',
    );
    return { outcome: 'unavailable', blobId: species.imageBlobId, reason };
  }

  /** Whether this node's own blob store holds the blob with this id. */
  async hasLocalBlob(blobId: string): Promise<boolean> {
    return isSafeWhereValue(blobId) && this.blobs.blobExists(blobId);
  }

  /**
   * The blob with this id from this node's own blob store or, when that
   * lacks it, from the network: the `Bs` multi of `fetchBlobsThrough`,
   * which asks the hub and, through the hub, every other client, and
   * writes what it found into this node's blob store on the way
   * (`BsMulti.getBlob` stores a hit in every writable layer that missed;
   * `docs/findings/blobs.md`). The bytes are checked against the id,
   * which is their content hash: bytes that hash to something else are
   * refused with `BlobMismatchError`, and since a content-addressed store
   * files them under their own hash they never land under the id asked
   * for. `undefined` when no node holds the blob, when the node has no
   * cascade, or for an id that is no id; throws when the network could
   * not answer (a closed socket, the thirty seconds of `BsPeer`). Nothing
   * here bounds the wait: the callers do, the `SyncAgent` with its pull
   * deadline and `speciesImage` with `blobPullTimeoutMs`.
   */
  async pullBlob(blobId: string): Promise<PulledBlob | undefined> {
    if (!isSafeWhereValue(blobId)) {
      return undefined;
    }
    if (await this.blobs.blobExists(blobId)) {
      const { content } = await this.blobs.getBlob(blobId);
      return { content, source: 'local' };
    }
    const cascade = this.blobCascade?.();
    if (cascade === undefined || cascade === null) {
      return undefined;
    }
    let content: Buffer;
    try {
      // The multi answers a plain `false` for an id no node holds, while
      // its `getBlob` for such an id fails on the way the peers serialise
      // the not-found error (`docs/findings/blobs.md`).
      if (!(await cascade.blobExists(blobId))) {
        return undefined;
      }
      const served = await cascade.getBlob(blobId);
      content = Buffer.isBuffer(served.content)
        ? served.content
        : Buffer.from(served.content);
    } catch (error) {
      throw new Error(
        `the network could not serve blob ${blobId}: ${errorMessage(error)}`,
      );
    }
    const servedBlobId = blobIdOf(content);
    if (servedBlobId !== blobId) {
      throw new BlobMismatchError(blobId, servedBlobId);
    }
    if (!(await this.blobs.blobExists(blobId))) {
      await this.blobs.setBlob(content);
    }
    return { content, source: 'network' };
  }

  /**
   * Writes a new version of one species with an uploaded image (slice
   * D5): the bytes go into the blob store first, under their content id,
   * then the current version is written again with `imageBlobId` and
   * `imageMimeType` naming them, as a new `species` row whose
   * InsertHistory row names the current version's `timeId` in `previous`
   * (the same discipline as `updateAnimal`), together with one change
   * set naming both rows, which the `SyncAgent` announces so that every
   * other node pulls the version and then the blob. Returns the new
   * version, or the current one unchanged when it names these very bytes
   * already (the same image uploaded twice makes no second version), or
   * `undefined` when no species has this id. The caller has checked the
   * bytes against the media type. Concurrent uploads are serialised so
   * that two of one species chain instead of branching.
   */
  async updateSpeciesImage(
    id: string,
    content: Buffer,
    mimeType: UploadedImageMediaType,
  ): Promise<HashedSpeciesRow | undefined> {
    const write = this.pendingWrite.then(
      () => this.updateSpeciesImageNow(id, content, mimeType),
      () => this.updateSpeciesImageNow(id, content, mimeType),
    );
    this.pendingWrite = write;
    return write;
  }

  private async updateSpeciesImageNow(
    id: string,
    content: Buffer,
    mimeType: UploadedImageMediaType,
  ): Promise<HashedSpeciesRow | undefined> {
    const species = await this.readVersioned<HashedSpeciesRow>(speciesTableCfg);
    const current = versionsOf(
      species.rows,
      species.history,
      speciesTableCfg.key,
      id,
    ).find((version) => version.current);
    if (current === undefined) {
      return undefined;
    }
    const { blobId } = await this.blobs.setBlob(content);
    if (
      current.row.imageBlobId === blobId &&
      current.row.imageMimeType === mimeType
    ) {
      return current.row;
    }
    const row = hashed({
      id,
      name: current.row.name,
      latinName: current.row.latinName,
      description: current.row.description,
      imageBlobId: blobId,
      imageMimeType: mimeType,
    });
    const written = await this.writeRow(speciesTableCfg, row, current.timeId);
    await this.writeChangeSet(
      updateSpeciesImageChangeSetId(id, written.timeId),
      [...written.changeSetItems],
      [id],
    );
    return row;
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
   * One page of the current animal versions in the store with their
   * species and breeder joined, optionally narrowed to one species, one
   * breeder, one trait, a search text, or any combination, ordered by
   * `id`; `total` counts every animal the filter matches, `items` holds the
   * slice `page` selects. Fetches `animals`, `species`, `breeders`,
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
   * the relation besides, a shape `where` cannot express at all. The search
   * text matches case-insensitively anywhere in the animal's name or its
   * species name; an unknown `speciesId`, `breederId` or `traitId` filter
   * yields an empty page rather than an error. An animal whose
   * `speciesRef` or `breederRef` does not resolve (nothing writes one
   * today; `Db.insert` and `IoMem` do not check references, only
   * `Validate` does, see the finding above) gets the matching fields
   * `null` instead of failing the whole list, and never matches a search
   * by species name; an animal that does not carry the filtered trait,
   * according to the configured `TraitRelation`, simply does not match.
   */
  async listAnimals(
    filter: AnimalFilter = {},
    page: PageRequest = defaultPageRequest,
  ): Promise<AnimalPage> {
    const tables = await this.readAnimalTables();
    const speciesByHash = byHash(tables.species.rows);
    const breedersByHash = byHash(tables.breeders.rows);
    const matchingAnimalHashes =
      filter.traitId === undefined
        ? undefined
        : PetShopStore.animalHashesWithTraitId(tables, filter.traitId);
    const query = filter.query?.trim().toLowerCase() ?? '';

    const matchesFilter = (animal: HashedAnimalRow): boolean => {
      const species = speciesByHash.get(animal.speciesRef);
      if (filter.speciesId !== undefined && species?.id !== filter.speciesId) {
        return false;
      }
      if (filter.breederId !== undefined) {
        const breeder = breedersByHash.get(animal.breederRef);
        if (breeder?.id !== filter.breederId) {
          return false;
        }
      }
      if (
        matchingAnimalHashes !== undefined &&
        !matchingAnimalHashes.has(animal._hash)
      ) {
        return false;
      }
      return (
        query === '' ||
        animal.name.toLowerCase().includes(query) ||
        (species?.name.toLowerCase().includes(query) ?? false)
      );
    };

    const matching = tables.animals.current.filter(matchesFilter);
    const items = matching
      .slice(page.offset, page.offset + page.limit)
      .map((animal) => {
        const species = speciesByHash.get(animal.speciesRef);
        const breeder = breedersByHash.get(animal.breederRef);

        return {
          id: animal.id,
          hash: animal._hash,
          name: animal.name,
          speciesId: species?.id ?? null,
          speciesName: species?.name ?? null,
          speciesImageUrl:
            species === undefined ? null : speciesImagePath(species._hash),
          breederId: breeder?.id ?? null,
          breederFarmName: breeder?.farmName ?? null,
          bornOn: animal.bornOn,
          priceCents: animal.priceCents,
        };
      });

    return {
      items,
      total: matching.length,
      limit: page.limit,
      offset: page.offset,
    };
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
      speciesImageUrl:
        species === undefined ? null : speciesImagePath(species._hash),
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
   *
   * A `version` no local history row names is read by its hash through
   * the network (`readMatching`): this is how a version written on the hub
   * is readable by hash on a client before slice D3 pulls its change set.
   * The row is served when it carries this `id` and joined against the
   * local tables; its InsertHistory row is not fetched, so the version
   * does not become the animal's current version here.
   */
  async getAnimal(
    id: string,
    options: { version?: string } = {},
  ): Promise<AnimalDetail | undefined> {
    const tables = await this.readAnimalTables();
    let animal: HashedAnimalRow | undefined;
    if (options.version === undefined) {
      animal = tables.animals.current.find((row) => row.id === id);
    } else {
      const version = options.version;
      animal =
        versionsOf(
          tables.animals.rows,
          tables.animals.history,
          animalsTableCfg.key,
          id,
        ).find((candidate) => candidate.row._hash === version)?.row ??
        (
          await this.readMatching<HashedAnimalRow>(animalsTableCfg, {
            _hash: version,
          })
        ).find((row) => row.id === id);
    }

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
    const entityIds = [id];
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
      entityIds.push(pairingId);
    }
    await this.writeChangeSet(
      updateAnimalChangeSetId(id, written.timeId),
      changeSetItems,
      entityIds,
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
      invoiceItemsByInvoiceRef: groupByInvoiceRef(invoiceItems),
      customers,
      customersByHash: byHash(customers.rows),
      personsByHash: byHash(persons),
      animals,
      animalsByHash: byHash(animals.rows),
      speciesByHash: byHash(species),
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
   * invoice has this id, in the shape `GET /api/invoices/:id` serves. An
   * id no local version has is looked up through the network
   * (`getInvoiceThroughNetwork`).
   */
  async getInvoice(id: string): Promise<InvoiceDetail | undefined> {
    const tables = await this.readInvoiceTables();
    const invoice = tables.invoices.current.find((row) => row.id === id);

    return invoice === undefined
      ? this.getInvoiceThroughNetwork(id, tables)
      : invoiceDetail(invoice, tables);
  }

  /**
   * An invoice this node holds no version of, as another node of the
   * network holds it: the invoice row by `id` through `readMatching`
   * (which asks the hub, and through the hub every other client, and only
   * answers once this node has no row of that id itself, so a locally
   * issued invoice always wins over a remote one with the same number,
   * `docs/findings/change-sets.md`), then its items by `invoiceRef` and
   * the customer, animals and species they name by hash where the local
   * tables lack them. This is how an invoice issued on the hub is readable
   * on a client before slice D3 pulls its change set. `changeSetHash`
   * stays `null` until then: a change set names the invoice inside its
   * `items` array, which no `where` clause can match, and the invoice list
   * does not show the invoice either, since its InsertHistory row is not
   * fetched and only a version with a history row is current. The cached
   * invoice row does count for `nextInvoiceSequence`, which reads every
   * `invoices` row: a node that read `invoice-2026-0007` from the hub
   * numbers its next invoice `2026-0008`, a node that never read it issues
   * its own `2026-0007` (`docs/findings/change-sets.md`, "Invoice numbers
   * across nodes"), until D3 gives every node the same rows.
   */
  private async getInvoiceThroughNetwork(
    id: string,
    tables: InvoiceTables,
  ): Promise<InvoiceDetail | undefined> {
    const [invoice] = await this.readMatching<HashedInvoiceRow>(
      invoicesTableCfg,
      { id },
    );
    if (invoice === undefined) {
      return undefined;
    }

    const invoiceItems = await this.readMatching<HashedInvoiceItemRow>(
      invoiceItemsTableCfg,
      { invoiceRef: invoice._hash },
    );
    const [customersByHash, animalsByHash] = await Promise.all([
      this.withRowsOfHashes(tables.customersByHash, customersTableCfg, [
        invoice.customerRef,
      ]),
      this.withRowsOfHashes(
        tables.animalsByHash,
        animalsTableCfg,
        invoiceItems.map((item) => item.animalRef),
      ),
    ]);
    const speciesByHash = await this.withRowsOfHashes(
      tables.speciesByHash,
      speciesTableCfg,
      invoiceItems.flatMap((item) => {
        const animal = animalsByHash.get(item.animalRef);
        return animal === undefined ? [] : [animal.speciesRef];
      }),
    );

    return invoiceDetail(invoice, {
      ...tables,
      invoiceItemsByInvoiceRef: groupByInvoiceRef(invoiceItems),
      customersByHash,
      animalsByHash,
      speciesByHash,
    });
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
    const { invoice, items } = invoiceRows({
      invoiceNumber: number,
      customerRef: customer._hash,
      issuedOn,
      status,
      lines,
    });
    const written = await this.writeRow(invoicesTableCfg, invoice);
    const changeSetItems = [...written.changeSetItems];
    for (const item of items) {
      const writtenItem = await this.writeRow(invoiceItemsTableCfg, item);
      changeSetItems.push(...writtenItem.changeSetItems);
    }
    const changeSet = await this.writeChangeSet(
      issueInvoiceChangeSetId(number),
      changeSetItems,
      [invoice.id, ...items.map((item) => item.id)],
    );

    return invoiceDetail(invoice, {
      ...tables,
      invoiceItemsByInvoiceRef: new Map([
        ...tables.invoiceItemsByInvoiceRef,
        [invoice._hash, items],
      ]),
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
    row: SeedRow,
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
   * Writes one change set an API path produced (an invoice issued, an
   * animal edited) with a history row stamped now, and announces it with
   * the ids of the entities it wrote to the listeners of
   * `onChangeSetWritten`.
   */
  private writeChangeSet(
    id: string,
    items: ChangeSetItem[],
    entityIds: readonly string[],
  ): Promise<HashedChangeSetRow> {
    return this.recordChangeSet(hashed({ id, items }), {
      timeId: timeId(),
      origin: apiOrigin,
      announce: entityIds,
    });
  }

  /**
   * Writes one change set and its InsertHistory row. `Db.insert` cannot
   * write a `buffets` table in `@rljson/db` 0.0.42 (no controller for the
   * type), so both rows go through `Core.import`, the same call
   * `Db._writeInsertHistory` uses internally, with the validator switched
   * off: it would demand every referenced table in the payload, and the
   * referenced rows were written before. `IoMem` still checks the column
   * types on write. The history row mirrors what `Db.insert` writes for a
   * components row, with `origin` naming what wrote it
   * (`docs/findings/change-sets.md`). Writing a change set the store
   * already holds is a no-op for the row (content addressed) and appends
   * a history row. With `announce`, the ids of the entities the change
   * set wrote, the listeners of `onChangeSetWritten` are told about it,
   * in write order; a received change set is recorded without announcing
   * it (`announce: null`).
   */
  private async recordChangeSet(
    changeSet: HashedChangeSetRow,
    options: {
      timeId: string;
      origin: string;
      announce: readonly string[] | null;
    },
  ): Promise<HashedChangeSetRow> {
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
              timeId: options.timeId,
              changeSetsRef: changeSet._hash,
              route: changeSetsRoute.flat,
              origin: options.origin,
              previous: [],
            },
          ],
        },
      },
      { validate: false },
    );
    if (options.announce !== null) {
      for (const listener of this.changeSetListeners) {
        listener(changeSet, options.announce);
      }
    }

    return changeSet;
  }

  /**
   * Whether this store holds the change set with this hash completely:
   * written by itself or received with every item, which is when a
   * change set gets its InsertHistory row here. The history row is the
   * proof, not the change set row: the row of a change set another node
   * wrote arrives together with its items, but the read cascade of the
   * API caches rows it fetched for a detail without any history. Read
   * from the local store only.
   */
  async holdsChangeSet(hash: string): Promise<boolean> {
    if (!isSafeWhereValue(hash)) {
      return false;
    }
    const rljson = await this.localIo.readRows({
      table: changeSetsInsertHistoryTableCfg.key,
      where: { changeSetsRef: hash },
    });
    return rljson[changeSetsInsertHistoryTableCfg.key]._data.length > 0;
  }

  /**
   * Every change set this store holds completely, oldest first by the
   * `timeId` of its history row: what the catch-up of slice D4 compares
   * with the list of a peer. Read from the local store only, as a
   * whole-table row read, which `IoMem` answers without refreshing its
   * table hashes (`docs/findings/seed-generator.md`).
   */
  async heldChangeSets(): Promise<HeldChangeSet[]> {
    return heldChangeSetsIn(
      await this.localIo.readRows({
        table: changeSetsInsertHistoryTableCfg.key,
        where: {},
      }),
    );
  }

  /**
   * The change set row with this hash from the local store, `undefined`
   * when this store does not hold it: what the catch-up announces to a
   * peer that lacks it.
   */
  async localChangeSet(hash: string): Promise<HashedChangeSetRow | undefined> {
    if (!isSafeWhereValue(hash)) {
      return undefined;
    }
    const rljson = await this.localIo.readRows({
      table: changeSetsTableCfg.key,
      where: { _hash: hash },
    });
    const table = rljson[changeSetsTableCfg.key] as BuffetsTable;
    return (table._data as HashedChangeSetRow[]).find(
      (row) => row._hash === hash,
    );
  }

  /**
   * Whether the local store holds the row with this hash in this table,
   * without asking the network.
   */
  async hasLocalRow(table: string, hash: string): Promise<boolean> {
    if (!this.tableCfgsByKey.has(table) || !isSafeWhereValue(hash)) {
      return false;
    }
    const rljson = await this.localIo.readRows({
      table,
      where: { _hash: hash },
    });
    return rljson[table]._data.length > 0;
  }

  /**
   * Whether the local store holds the InsertHistory row with this
   * `timeId` in the history table of `table`, without asking the network.
   */
  async hasLocalHistoryRow(
    table: string,
    historyTimeId: string,
  ): Promise<boolean> {
    const historyTableKey = historyTableKeyOf(table);
    if (
      !this.tableCfgsByKey.has(historyTableKey) ||
      !isSafeTimeId(historyTimeId)
    ) {
      return false;
    }
    const rljson = await this.localIo.readRows({
      table: historyTableKey,
      where: { timeId: historyTimeId },
    });
    return rljson[historyTableKey]._data.length > 0;
  }

  /**
   * The row with this hash in this table, from the local store when it is
   * there, else from the peer stores of `pullThrough`: the hub's, which
   * answers from the hub's own cascade (the hub's store, then every other
   * client), or on the hub every client's. Nothing is written into this
   * store on the way: the `SyncAgent` collects the rows of a change set
   * and writes them together (`writeReceivedRows`), so that a reader never
   * sees a version without the rows it consists of; the read cascade of
   * the API (`readThrough`) would cache each row the moment it arrived.
   * `undefined` when no node holds it or the table is not one of this
   * store's; throws when a peer could not answer (a closed socket, a
   * timeout) and none had the row, which is the difference between
   * "nobody has it" and "nobody could say", the difference the
   * `SyncAgent` needs to decide between giving a change set up and
   * retrying it. Unlike `readMatching`, this read is not silenced.
   */
  async pullRow(table: string, hash: string): Promise<SyncRow | undefined> {
    if (!this.tableCfgsByKey.has(table) || !isSafeWhereValue(hash)) {
      return undefined;
    }
    return (
      (await this.localRow(table, hash)) ??
      this.readFromPeers(
        table,
        { _hash: hash },
        (row) => row._hash === hash,
        true,
      )
    );
  }

  /**
   * The row with this hash in this table from the local store alone,
   * `undefined` when the store lacks it. The caller checks the table and
   * the hash.
   */
  private async localRow(
    table: string,
    hash: string,
  ): Promise<SyncRow | undefined> {
    const rljson = await this.localIo.readRows({
      table,
      where: { _hash: hash },
    });
    return (rljson[table]._data as SyncRow[]).find((row) => row._hash === hash);
  }

  /**
   * The InsertHistory row with this `timeId` in the history table of
   * `table` from the local store alone. The caller checks the table and
   * the `timeId`.
   */
  private async localHistoryRow(
    historyTableKey: string,
    historyTimeId: string,
  ): Promise<SyncRow | undefined> {
    const rljson = await this.localIo.readRows({
      table: historyTableKey,
      where: { timeId: historyTimeId },
    });
    return (rljson[historyTableKey]._data as SyncRow[]).find(
      (row) => row.timeId === historyTimeId,
    );
  }

  /**
   * A change set this store holds with the content of every row it names
   * and, per data row, the row of the version it supersedes: the
   * InsertHistory row the same change set names for that row carries the
   * `previous` `timeId`s (`docs/findings/entity-versions.md`), the history
   * row of the first of them this store holds names the earlier row's
   * hash, and that row is read from the local store. Nothing is asked of
   * the network: a change set this node holds arrived whole
   * (`writeReceivedRows`) and its predecessors were pulled with it, up to
   * the dependency bound of the `SyncAgent`; a predecessor beyond that
   * bound reads as `null`, like a first version. `undefined` for a change
   * set this store does not hold, an unsafe hash included.
   */
  async changeSetPayload(hash: string): Promise<ChangeSetPayload | undefined> {
    if (!(await this.holdsChangeSet(hash))) {
      return undefined;
    }
    const changeSet = await this.localChangeSet(hash);
    if (changeSet === undefined) {
      return undefined;
    }
    const rows = await Promise.all(
      changeSet.items.map((item) => this.localItemRow(item)),
    );
    const items = await Promise.all(
      changeSet.items.map(
        async (item, index): Promise<ChangeSetPayloadItem> => ({
          table: item.table,
          ref: item.ref,
          row: rows[index] ?? null,
          previousRow: await this.previousVersionOf(
            item,
            changeSet.items,
            rows,
          ),
        }),
      ),
    );
    return { hash: changeSet._hash, id: changeSet.id, items };
  }

  /**
   * The row a change set item names from the local store alone,
   * `undefined` when the store lacks it or the item names a table this
   * store does not have.
   */
  private async localItemRow(
    item: ChangeSetItem,
  ): Promise<SyncRow | undefined> {
    if (!this.tableCfgsByKey.has(item.table) || !isSafeWhereValue(item.ref)) {
      return undefined;
    }
    return this.localRow(item.table, item.ref);
  }

  /**
   * The row of the version a change set's data row supersedes, `null` when
   * the item is a history row, when its history row in the change set
   * names no predecessor, or when this store holds neither the
   * predecessor's history row nor its data row.
   */
  private async previousVersionOf(
    item: ChangeSetItem,
    items: readonly ChangeSetItem[],
    rows: readonly (SyncRow | undefined)[],
  ): Promise<SyncRow | null> {
    const historyTableKey = historyTableKeyOf(item.table);
    if (!this.tableCfgsByKey.has(historyTableKey)) {
      return null;
    }
    const referenceColumn = referenceColumnOf(item.table);
    const historyRow = rows.find(
      (row, index) =>
        row !== undefined &&
        items[index]!.table === historyTableKey &&
        row[referenceColumn] === item.ref,
    );
    const previous = historyRow?.previous;
    if (!Array.isArray(previous)) {
      return null;
    }
    for (const previousTimeId of previous) {
      if (typeof previousTimeId !== 'string' || !isSafeTimeId(previousTimeId)) {
        continue;
      }
      const previousHistory = await this.localHistoryRow(
        historyTableKey,
        previousTimeId,
      );
      const previousHash = previousHistory?.[referenceColumn];
      if (typeof previousHash !== 'string' || !isSafeWhereValue(previousHash)) {
        continue;
      }
      const previousRow = await this.localRow(item.table, previousHash);
      if (previousRow !== undefined) {
        return previousRow;
      }
    }
    return null;
  }

  /**
   * The InsertHistory row with this `timeId` in the history table of
   * `table`, from the peer stores like `pullRow`; the way a received
   * version's `previous` is followed to a version this node has not
   * received yet. A read by a column other than `_hash` answers with what
   * the reachable peers had rather than throwing when one could not
   * answer, the way `IoMulti` does (`docs/findings/hub-transport.md`), so
   * a missing predecessor reads as `undefined` here.
   */
  async pullHistoryRow(
    table: string,
    historyTimeId: string,
  ): Promise<SyncRow | undefined> {
    const historyTableKey = historyTableKeyOf(table);
    if (
      !this.tableCfgsByKey.has(historyTableKey) ||
      !isSafeTimeId(historyTimeId)
    ) {
      return undefined;
    }
    return (
      (await this.localHistoryRow(historyTableKey, historyTimeId)) ??
      this.readFromPeers(
        historyTableKey,
        { timeId: historyTimeId },
        (row) => row.timeId === historyTimeId,
        false,
      )
    );
  }

  /**
   * Asks every peer store for the rows matching `where`, all at once, and
   * answers with the first row that matches. Peers that could not answer
   * are ignored while another one could; when every peer failed, or when
   * `strict` (a read by hash) and none had the row while some failed, the
   * first failure is thrown. Without peers (no role in the network) the
   * answer is `undefined`.
   */
  private async readFromPeers(
    table: string,
    where: Record<string, string>,
    matches: (row: SyncRow) => boolean,
    strict: boolean,
  ): Promise<SyncRow | undefined> {
    const peers = this.peers?.() ?? [];
    if (peers.length === 0) {
      return undefined;
    }
    const answers = await Promise.allSettled(
      peers.map((peer) => peer.readRows({ table, where })),
    );
    const failures = answers.filter(
      (answer): answer is PromiseRejectedResult => answer.status === 'rejected',
    );
    for (const answer of answers) {
      if (answer.status === 'fulfilled') {
        const found = (
          answer.value[table]?._data as SyncRow[] | undefined
        )?.find(matches);
        if (found !== undefined) {
          return found;
        }
      }
    }
    if (failures.length === answers.length || (strict && failures.length > 0)) {
      throw failures[0]!.reason;
    }
    return undefined;
  }

  /**
   * Writes rows other nodes wrote into the local store exactly as
   * received, all in one `Io.write`: no new hashes, no new InsertHistory
   * rows, since the history rows of a change set are among its items and
   * a received version must keep the `timeId` and `previous` its writer
   * gave it, or the version rule of roadmap section 2.6 would see two
   * versions where the network has one. One write for a whole change set
   * is what makes the change set appear at once: `IoMem` inserts the rows
   * of every table in one synchronous pass and `IoSqliteNode` in one
   * transaction, so a reader sees either none of the rows or all of them.
   * Rows the store already holds are left as they are (rows are content
   * addressed). The store checks the hash of every row on the way in
   * (`hsh` inside `IoMem.write` and `IoSqliteNode.write`) and refuses a
   * row whose hash does not match its content; the `SyncAgent` checks
   * before it calls. Throws for a table this store does not have.
   */
  async writeReceivedRows(rows: readonly ReceivedRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const data: Record<string, { _type: string; _data: SyncRow[] }> = {};
    for (const { table, row } of rows) {
      const tableCfg = this.tableCfgsByKey.get(table);
      if (tableCfg === undefined) {
        throw new Error(`This store has no table "${table}".`);
      }
      const tableData = data[table] ?? { _type: tableCfg.type, _data: [] };
      tableData._data.push(row);
      data[table] = tableData;
    }
    await this.localIo.write({ data: data as unknown as Rljson });
  }

  /**
   * Records a change set received from another node once every item of
   * it is in the local store: the change set row and a history row
   * stamped now with the origin `sync`, which is what makes
   * `holdsChangeSet` true. Not announced: the node that wrote it did
   * that. A change set the store
   * holds already is left as it is, so that every change set has exactly
   * one history row here whatever the caller does (`recordChangeSet`
   * would append a second one); the `SyncAgent` checks before it pulls,
   * so a second call is logged as the anomaly it is.
   */
  async recordReceivedChangeSet(changeSet: HashedChangeSetRow): Promise<void> {
    if (await this.holdsChangeSet(changeSet._hash)) {
      this.logger.warn(
        { changeSetHash: changeSet._hash, changeSetId: changeSet.id },
        'received change set is held already, kept once',
      );
      return;
    }
    await this.recordChangeSet(changeSet, {
      timeId: timeId(),
      origin: syncOrigin,
      announce: null,
    });
  }

  /**
   * Closes the underlying `Io`: for `sqlite` this closes the database file
   * so that the process can exit or another store can open the same file.
   */
  async close(): Promise<void> {
    await this.io.close();
  }
}
