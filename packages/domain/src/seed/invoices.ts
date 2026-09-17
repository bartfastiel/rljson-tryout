import type { InvoiceStatus } from '../tables/invoices.ts';

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
 * and the status the seed backdates it to. The seed is not a list of
 * pre-hashed rows like `customersSeed`, because an invoice is not one row:
 * it is an `invoices` row, one `invoiceItems` row per line and one
 * `changeSets` row naming all of them, and the store's own issuing code
 * is the only place that writes those together (roadmap section 3.4).
 * Feeding the seed through that same path keeps the change set discipline
 * for seed data too and derives the rows deterministically from the
 * customer and animal hashes.
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
