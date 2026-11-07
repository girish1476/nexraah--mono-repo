import { describe, expect, it } from 'vitest';
import {
  amountInWords,
  checkManualInvoice,
  gstState,
  manualDetailsOf,
  manualTotals,
  reverseChargeTax,
} from './manual-invoice';
import { sampleManual } from './manual-invoice.sample';

describe('a manual invoice', () => {
  it('reads its amount in words the Indian way', () => {
    expect(amountInWords(4_000_000)).toBe('Rupees Forty Thousand Only');
    expect(amountInWords(12_345_678_90)).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only');
    expect(amountInWords(100)).toBe('Rupees One Only');
  });

  it('works out each line, rounds the total to the rupee, and charges no tax', () => {
    const t = manualTotals(sampleManual().items, sampleManual().extraCharges);
    expect(t).toEqual({ itemsPaise: 4_000_050, chargesPaise: 150_000, subTotalPaise: 4_150_050, roundOffPaise: 50, totalPaise: 4_150_100 });
    expect(manualTotals([{ description: 'x', qty: 21.5, unit: 'MT', ratePaise: 180_000 }]).itemsPaise).toBe(3_870_000);
  });

  it('splits reverse-charge GST into CGST and SGST within the state, IGST across', () => {
    const company = '29AAACN1234C1Z5'; // Karnataka
    expect(reverseChargeTax(4_000_000, 5, company, 'Karnataka')).toEqual({ interState: false, cgstPaise: 100_000, sgstPaise: 100_000, igstPaise: 0, taxPaise: 200_000 });
    expect(reverseChargeTax(4_000_000, 5, company, 'Tamil Nadu')).toMatchObject({ interState: true, igstPaise: 200_000 });
  });

  it('knows states by name or code, whatever the spelling of "and"', () => {
    expect(gstState('andhra pradesh')?.code).toBe('37');
    expect(gstState('Jammu & Kashmir')?.code).toBe('01');
    expect(gstState('7')?.name).toBe('Delhi');
    expect(gstState('Atlantis')).toBeUndefined();
  });

  it('is ready when every field the GST rules ask for is there', () => {
    expect(checkManualInvoice(sampleManual())).toEqual([]);
  });

  it('names every missing field', () => {
    const bad = { ...sampleManual(), vehicleNo: '', grossWeightKg: 0, placeOfSupply: 'Nowhere', billTo: { name: 'X', address: '', state: 'Karnataka' } };
    expect(checkManualInvoice(bad)).toEqual([
      'Bill-to address is missing',
      'Place of supply is missing or not an Indian state',
      'Vehicle number is missing',
      'Gross weight is missing',
      'GSTIN of the recipient (bill to) is needed — they pay the GST under reverse charge',
    ]);
    expect(checkManualInvoice({ ...sampleManual(), items: [] })).toContain('Add at least one line');
    expect(checkManualInvoice({ ...sampleManual(), rcmRatePct: 18 })).toContain('GST rate must be 5% or 12%');
    expect(checkManualInvoice({ ...sampleManual(), dueDate: '2026-11-01' })).toContain('Due date is before the invoice date');
  });

  it('stores tidy details with each line worked out', () => {
    const d = manualDetailsOf({ ...sampleManual(), vehicleNo: ' ka 01 ab 4321 ', placeOfSupply: 'karnataka' });
    expect(d.vehicleNo).toBe('KA 01 AB 4321');
    expect(d.placeOfSupply).toBe('Karnataka');
    expect(d.items[0].amountPaise).toBe(4_000_050);
  });
});
