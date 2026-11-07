import type { ManualInvoiceInput } from './manual-invoice';

/** One complete manual invoice, for tests on both sides. */
export const sampleManual = (): ManualInvoiceInput => ({
  clientId: 'c1',
  invoiceDate: '2026-11-07',
  dueDate: '2026-12-07',
  billTo: { name: 'Lifecycle Steels', address: 'Plot 4, Industrial Area, Bengaluru 560058', gstin: '29AABCL1234M1Z5', state: 'Karnataka' },
  placeOfSupply: 'Karnataka',
  consignor: { name: 'Lifecycle Steels', gstin: '29AABCL1234M1Z5' },
  consignee: { name: 'Chennai Fabricators', address: 'Ambattur, Chennai' },
  vehicleNo: 'KA 01 AB 4321',
  lrNo: 'LR-88215',
  fromPlace: 'Bengaluru',
  toPlace: 'Chennai',
  goods: 'Steel coils',
  packages: '12 coils',
  grossWeightKg: 21000,
  taxPaidBy: 'BILL_TO',
  rcmRatePct: 5,
  items: [{ description: 'Freight, Bengaluru to Chennai, 32 ft SXL', sac: '996511', qty: 1, unit: 'Trip', ratePaise: 4_000_050 }],
  extraCharges: [{ label: 'Loading', amountPaise: 150_000 }],
});
