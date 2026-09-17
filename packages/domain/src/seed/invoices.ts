import { invoiceRows, type InvoiceRows } from '../invoiceRows.ts';
import { invoiceNumber, nextInvoiceSequence } from '../invoiceNumbering.ts';
import type { InvoiceStatus } from '../tables/invoices.ts';
import { animalsSeed } from './animals.ts';
import { customersSeed } from './customers.ts';

/**
 * One line of a seed invoice: which animal, how many.
 */
export type InvoiceSeedItem = {
  animalId: string;
  quantity: number;
};

/**
 * One invoice the seed issues, described the way `POST /api/invoices`
 * describes an invoice (customer and animals by `id`) plus the issue date
 * and the status the seed backdates it to. An invoice is not one row: it
 * is an `invoices` row, one `invoiceItems` row per line and one
 * `changeSets` row naming all of them, so the entries are turned into rows
 * by `seedInvoices` below through the same `invoiceRows` builder the
 * store's issuing code uses, which derives the rows deterministically from
 * the customer and animal hashes.
 */
export type InvoiceSeedEntry = {
  customerId: string;
  issuedOn: string;
  status: InvoiceStatus;
  items: readonly InvoiceSeedItem[];
};

/**
 * The six invoices every node starts with, in issue order. Three are still
 * `open`, so the seed has unpaid invoices from the start; one is
 * `cancelled`. Grandma Duck buys chickens from Gyro's hatchery, which makes
 * a breeder a customer. Donald the Third is deliberately not sold here: he
 * is the animal the Gherkin scenario "Scrooge buys Donald the duck" buys.
 */
export const invoicesSeed: readonly InvoiceSeedEntry[] = [
  {
    customerId: 'scrooge-mcduck',
    issuedOn: '2026-01-12',
    status: 'paid',
    items: [
      { animalId: 'bowser-the-guard-dog', quantity: 1 },
      { animalId: 'nosey-the-bloodhound', quantity: 1 },
    ],
  },
  {
    customerId: 'grandma-duck',
    issuedOn: '2026-02-03',
    status: 'paid',
    items: [
      { animalId: 'clara-cluck-junior', quantity: 1 },
      { animalId: 'gadget-the-inventor', quantity: 1 },
    ],
  },
  {
    customerId: 'gladstone-gander',
    issuedOn: '2026-03-15',
    status: 'open',
    items: [{ animalId: 'sir-quackington', quantity: 1 }],
  },
  {
    customerId: 'fethry-duck',
    issuedOn: '2026-04-20',
    status: 'cancelled',
    items: [
      { animalId: 'pepper-the-poodle', quantity: 1 },
      { animalId: 'henrietta-the-egg-champion', quantity: 3 },
    ],
  },
  {
    customerId: 'donald-duck',
    issuedOn: '2026-05-08',
    status: 'open',
    items: [{ animalId: 'daphne-duck', quantity: 1 }],
  },
  {
    customerId: 'scrooge-mcduck',
    issuedOn: '2026-06-30',
    status: 'open',
    items: [
      { animalId: 'quackmore-junior', quantity: 1 },
      { animalId: 'henrietta-the-egg-champion', quantity: 2 },
      { animalId: 'pepper-the-poodle', quantity: 1 },
    ],
  },
];

/**
 * The rows of one seed invoice, numbered and hashed.
 */
export type SeedInvoice = InvoiceRows & { entry: InvoiceSeedEntry };

const customerRefFor = (customerId: string): string => {
  const customer = customersSeed.find((row) => row.id === customerId);
  if (customer === undefined) {
    throw new Error(`No seeded customer with id "${customerId}".`);
  }
  return customer._hash;
};

const animalFor = (animalId: string): { _hash: string; priceCents: number } => {
  const animal = animalsSeed.find((row) => row.id === animalId);
  if (animal === undefined) {
    throw new Error(`No seeded animal with id "${animalId}".`);
  }
  return animal;
};

/**
 * The six seed invoices as rows: numbered in entry order the way
 * `issueInvoice` numbers them one after another (`2026-0001` to
 * `2026-0006`), issued to the seeded customer version and selling the
 * seeded animal versions at their seed price, hashed the same on every
 * node. `PetShopStore.seedIfEmpty` writes exactly these rows.
 */
export const seedInvoices: readonly SeedInvoice[] = invoicesSeed.reduce<
  SeedInvoice[]
>((invoices, entry) => {
  const number = invoiceNumber(
    entry.issuedOn,
    nextInvoiceSequence(
      entry.issuedOn,
      invoices.map((invoice) => invoice.invoice.invoiceNumber),
    ),
  );
  invoices.push({
    entry,
    ...invoiceRows({
      invoiceNumber: number,
      customerRef: customerRefFor(entry.customerId),
      issuedOn: entry.issuedOn,
      status: entry.status,
      lines: entry.items.map((item) => ({
        animal: animalFor(item.animalId),
        quantity: item.quantity,
      })),
    }),
  });
  return invoices;
}, []);
