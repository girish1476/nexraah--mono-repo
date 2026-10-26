import { describe, it, expect } from 'vitest';
import { findInText, verhoeffValid } from './local-ocr';
import { gstinCheckDigit } from './gstin';

// Made-up numbers throughout, built to pass their own check digit — never a real person's.
function aadhaar(first11: string): string {
  return first11 + [...'0123456789'].find((d) => verhoeffValid(first11 + d));
}
const AADHAAR = aadhaar('23456789012');
const spaced = (n: string) => `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;

describe('findInText — PAN', () => {
  it('finds the PAN among the other lines of a card', () => {
    const text = 'INCOME TAX DEPARTMENT\nPermanent Account Number Card\nABCPE1234F\nName\nRAVI KUMAR\n29102021';
    expect(findInText('pan', text)).toBe('ABCPE1234F');
  });

  it('closes up a number printed with its characters apart', () => {
    expect(findInText('pan', 'A B C P E 1 2 3 4 F')).toBe('ABCPE1234F');
  });

  it('puts a look-alike right where the pattern leaves no doubt', () => {
    expect(findInText('pan', 'ABCPE12O4F')).toBe('ABCPE1204F');
    expect(findInText('pan', 'A8CPE1234F')).toBe('ABCPE1234F');
  });

  it('does not take a word for a PAN', () => {
    expect(findInText('pan', 'GOVT OF INDIA\nPOSSIBILIS SIGNATURE\nDate of Birth 06/10/2003')).toBeNull();
  });

  it('gives nothing when two different PANs are on the page', () => {
    expect(findInText('pan', 'ABCPE1234F\nXYZPK9876L')).toBeNull();
  });
});

describe('findInText — Aadhaar', () => {
  it('gives only the last four digits', () => {
    expect(findInText('aadhaarLast4', `Your Aadhaar No. :\n${spaced(AADHAAR)}`)).toBe(AADHAAR.slice(-4));
  });

  it('takes one number printed three times as one number', () => {
    const text = `${spaced(AADHAAR)}\nVID : 9145 2534 2972 0978\n${spaced(AADHAAR)}\n${spaced(AADHAAR)}`;
    expect(findInText('aadhaarLast4', text)).toBe(AADHAAR.slice(-4));
  });

  it('never takes part of the sixteen-digit Virtual ID for it', () => {
    // Every run of three groups inside a VID is tried here with a passing check digit.
    const vid = `${spaced(AADHAAR)} 0978`;
    expect(findInText('aadhaarLast4', `VID : ${vid}`)).toBeNull();
    expect(findInText('aadhaarLast4', `VID : 9145 ${spaced(AADHAAR)}`)).toBeNull();
  });

  it('leaves a number with a digit misread blank', () => {
    const wrong = AADHAAR.slice(0, 5) + ((Number(AADHAAR[5]) + 1) % 10) + AADHAAR.slice(6);
    expect(findInText('aadhaarLast4', spaced(wrong))).toBeNull();
  });

  it('reads the four digits a masked card shows', () => {
    expect(findInText('aadhaarLast4', 'XXXX XXXX 4471')).toBe('4471');
  });

  it('does not take a phone number or an enrolment number for it', () => {
    expect(findInText('aadhaarLast4', 'Enrolment No.: 0623/11563/44146\nMobile: 9652207289')).toBeNull();
  });
});

describe('findInText — the rest', () => {
  it('holds a GSTIN to its check digit', () => {
    const prefix = '27AAPFU0939F1Z';
    const good = prefix + gstinCheckDigit(prefix);
    const bad = prefix + (gstinCheckDigit(prefix) === '5' ? '6' : '5');
    expect(findInText('gstin', `GSTIN: ${good}`)).toBe(good);
    expect(findInText('gstin', `GSTIN: ${bad}`)).toBeNull();
  });

  it('reads an IFSC, with its zero put right', () => {
    expect(findInText('ifsc', 'IFSC: SBINO001234')).toBe('SBIN0001234');
    expect(findInText('ifsc', 'FOR INFORMATION ONLY')).toBeNull();
  });

  it('reads an Udyam number into its usual form', () => {
    expect(findInText('udyam', 'UDYAM-AP-10-0012345')).toBe('UDYAM-AP-10-0012345');
  });

  it('has nothing to say about a kind it cannot prove', () => {
    expect(findInText('bankAccount', '123456789012')).toBeNull();
    expect(findInText('name', 'RAVI KUMAR')).toBeNull();
  });
});
