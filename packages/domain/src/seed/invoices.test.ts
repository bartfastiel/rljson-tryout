import { describe, expect, it } from 'vitest';

import { invoiceStatuses } from '../tables/invoices.ts';
import { animalsSeed } from './animals.ts';
import { breedersSeed } from './breeders.ts';
import { customersSeed } from './customers.ts';
import { invoicesSeed } from './invoices.ts';

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
