import { describe, expect, it } from 'vitest';

import { invoiceStatuses } from '../tables/invoices.ts';
import { animalsSeed } from './animals.ts';
import { breedersSeed } from './breeders.ts';
import { customersSeed } from './customers.ts';
import { invoicesSeed, seedInvoices } from './invoices.ts';

describe('invoicesSeed', () => {
  it('holds four to six invoices with one to three items each, in issue order', () => {
    expect(invoicesSeed.length).toBeGreaterThanOrEqual(4);
    expect(invoicesSeed.length).toBeLessThanOrEqual(6);

    const issueDates = invoicesSeed.map((entry) => entry.issuedOn);
    expect(issueDates).toStrictEqual([...issueDates].sort());

    for (const entry of invoicesSeed) {
      expect(entry.issuedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(invoiceStatuses).toContain(entry.status);
      expect(entry.items.length).toBeGreaterThanOrEqual(1);
      expect(entry.items.length).toBeLessThanOrEqual(3);
      for (const item of entry.items) {
        expect(Number.isInteger(item.quantity)).toBe(true);
        expect(item.quantity).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('names only seeded customers and seeded animals', () => {
    const customerIds = new Set(customersSeed.map((row) => row.id));
    const animalIds = new Set(animalsSeed.map((row) => row.id));

    for (const entry of invoicesSeed) {
      expect(customerIds.has(entry.customerId)).toBe(true);
      for (const item of entry.items) {
        expect(animalIds.has(item.animalId)).toBe(true);
      }
    }
  });

  it('leaves at least two invoices open', () => {
    const openInvoices = invoicesSeed.filter(
      (entry) => entry.status === 'open',
    );

    expect(openInvoices.length).toBeGreaterThanOrEqual(2);
  });

  it('has a breeder among its customers', () => {
    const breederPersonRefs = new Set(
      breedersSeed.map((breeder) => breeder.personRef),
    );
    const breedingCustomerIds = customersSeed
      .filter((customer) => breederPersonRefs.has(customer.personRef))
      .map((customer) => customer.id);

    expect(
      invoicesSeed.some((entry) =>
        breedingCustomerIds.includes(entry.customerId),
      ),
    ).toBe(true);
  });

  it('does not sell Donald the Third, whom the Gherkin scenario buys', () => {
    const soldAnimalIds = invoicesSeed.flatMap((entry) =>
      entry.items.map((item) => item.animalId),
    );

    expect(soldAnimalIds).not.toContain('donald-the-third');
  });
});

describe('seedInvoices', () => {
  it('numbers the entries in order and derives ids from the numbers', () => {
    expect(
      seedInvoices.map((seed) => seed.invoice.invoiceNumber),
    ).toStrictEqual([
      '2026-0001',
      '2026-0002',
      '2026-0003',
      '2026-0004',
      '2026-0005',
      '2026-0006',
    ]);
    expect(seedInvoices[0]!.invoice.id).toBe('invoice-2026-0001');
    expect(seedInvoices[0]!.items.map((item) => item.id)).toStrictEqual([
      'invoice-2026-0001-item-1',
      'invoice-2026-0001-item-2',
    ]);
  });

  it('issues every invoice to the seeded customer and sells the seeded animals at their price', () => {
    for (const seed of seedInvoices) {
      const customer = customersSeed.find(
        (row) => row.id === seed.entry.customerId,
      )!;
      expect(seed.invoice.customerRef).toBe(customer._hash);
      expect(seed.invoice.issuedOn).toBe(seed.entry.issuedOn);
      expect(seed.invoice.status).toBe(seed.entry.status);
      expect(seed.items).toHaveLength(seed.entry.items.length);
      seed.items.forEach((item, index) => {
        const animal = animalsSeed.find(
          (row) => row.id === seed.entry.items[index]!.animalId,
        )!;
        expect(item.animalRef).toBe(animal._hash);
        expect(item.unitPriceCents).toBe(animal.priceCents);
        expect(item.quantity).toBe(seed.entry.items[index]!.quantity);
        expect(item.invoiceRef).toBe(seed.invoice._hash);
      });
    }
  });

  it('hashes the same on every evaluation', () => {
    expect(seedInvoices.map((seed) => seed.invoice._hash))
      .toMatchInlineSnapshot(`
      [
        "-PK9-A9uzsuJXoIxZejzPL",
        "qmXJhmvl4FUMTduBoFh9gg",
        "jbeLEvb60Ql4jQujot7_2M",
        "30hPri5MYvwdd6VspLx4s8",
        "5pPwwkVb4XvuX7_yRITHId",
        "-Qu3M7ozaBUWhtDPnmDxdQ",
      ]
    `);
  });
});
