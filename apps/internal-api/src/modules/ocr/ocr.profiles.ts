import type { OcrFieldFormat } from './ocr.formats';

/**
 * What the reader is told about each kind of Indian document before it reads
 * one: where the wanted value sits, and — more to the point — which other
 * value printed beside it is the one people mistake for it. A driving licence
 * carries four dates and only one of them is "valid till"; an Aadhaar card
 * prints a sixteen-digit Virtual ID next to the twelve-digit number.
 *
 * A note says where to look. It never says what the value is.
 */

export const OCR_DOC_TYPES = [
  'PAN',
  'AADHAAR',
  'ADDRESS',
  'DRIVING_LICENCE',
  'RC',
  'INSURANCE',
  'FITNESS',
  'PERMIT',
  'PUC',
  'VEHICLE_PAPERS',
  'EWAY_BILL',
  'CLIENT_INVOICE_OR_PO',
  'LOADING_SLIP',
  'WEIGHMENT_SLIP',
  'LR',
  'POD',
  'BANK_STATEMENT',
  'GST_CERTIFICATE',
  'UDYAM',
  'TRADE_LICENCE',
  'LABOUR_LICENCE',
  'TDS_DECLARATION',
  'TRANSPORTER_AGREEMENT',
] as const;
export type OcrDocType = (typeof OCR_DOC_TYPES)[number];

/** The papers that say who a person is. Read only when `OCR_READ_IDENTITY` allows it — see `OcrService`. */
export const IDENTITY_DOC_TYPES: ReadonlySet<OcrDocType> = new Set(['PAN', 'AADHAAR', 'ADDRESS']);

const RC = `Registration certificate (RC), as a card or a Form 23 sheet.
- The registration number is labelled "Regn. No." or "Registration No." — the number on the plate, such as MH15GT4482. The chassis number and the engine number are longer and are not it.
- "Regn. Validity" or "Valid upto" is how long the registration runs. "Date of Regn." is when it began.
- The owner is under "Owner Name"; "S/W/D of" is the owner's father or husband, not the owner.`;

const INSURANCE = `Motor insurance policy or certificate of insurance.
- The period of insurance is printed as a "From" date and a "To" date, often with a time ("midnight of"). Valid till is the "To" date. Where own-damage and third-party cover end on different dates, take the third-party (liability) date.
- The policy number is labelled "Policy No." — not the receipt, proposal or cover-note number.`;

const FITNESS = `Certificate of fitness (Form 38) for a transport vehicle.
- Valid till is the date after "valid upto", "expires on" or "next inspection due". The date of inspection or issue is not it.`;

const PERMIT = `Goods carriage permit — a state permit or a national permit with its authorisation.
- A national permit prints two validities: the permit itself (five years) and the authorisation (one year, on Form 47 or the "authorisation" lines). Give the permit's own "valid to" date unless the detail asked for names the authorisation.
- The permit number is labelled "Permit No.".`;

const PUC = `Pollution under control (PUC) certificate.
- Valid till is the date after "Valid upto" or "Validity". The date and time of the test are not it.`;

export const DOC_NOTES: Record<OcrDocType, string> = {
  PAN: `PAN card, issued by the Income Tax Department.
- The PAN is the ten-character number under "Permanent Account Number": five letters, four digits, one letter.
- On a person's card the lines run: the holder's name, then the father's name, then the date of birth. The name is the first of them — never the father's. Newer cards label each line; older ones do not.
- On a company's or firm's card there is one name and a date of incorporation.`,

  AADHAAR: `Aadhaar card or e-Aadhaar letter, issued by UIDAI.
- The Aadhaar number is twelve digits printed in three groups of four, usually at the foot of the front. Give all of it exactly as printed. If the card is masked and shows X's or stars for the first eight digits, give it with the X's — do not fill them in.
- The sixteen-digit number labelled "VID" is the Virtual ID, not the Aadhaar number. The enrolment number (EID) at the top of a letter is not it either.
- The name is printed in the regional language and in English; give the English.
- "DOB" is the date of birth; some cards print only "Year of Birth". The "Issue Date" or "Download Date" printed along the edge is neither.
- The address is on the back of a card, or beside the photograph on a letter.`,

  ADDRESS: `A proof of address: an electricity or other utility bill, a rent agreement, a bank passbook page, or a photograph of a yard's name-board.
- The reference is whatever number identifies this paper — a consumer or service number on a bill, an agreement or registration number on a rent agreement. A name-board has none.
- The address is the premises address, not the address of the utility's or the bank's office.`,

  DRIVING_LICENCE: `Driving licence, as a smart card or the older booklet or laminated form.
- The licence number is labelled "DL No.", "Licence No." or "No." and begins with the two-letter state code — MH14 20110012345. Give it without spaces or hyphens.
- A licence prints several dates. "Valid till" or "Validity" is the one wanted; the date of issue ("DOI"), the date of birth ("DOB") and the date of first issue are not.
- Where it gives separate validity for non-transport ("NT") and transport ("TR") vehicles, valid till means the transport (TR) date — this is a goods-vehicle driver's licence. If no transport date is printed, give the non-transport date.
- The driver's name is under "Name"; "S/D/W of" is the father or husband.`,

  RC,
  INSURANCE,
  FITNESS,
  PERMIT,
  PUC,

  VEHICLE_PAPERS: `One file holding a truck's papers together, a page or more each: registration certificate, permit, insurance, fitness certificate and pollution certificate. Find the page each detail belongs to before reading it — every one of these papers has a "valid upto" of its own.

${RC}

${PERMIT}

${INSURANCE}

${FITNESS}

${PUC}`,

  EWAY_BILL: `E-way bill printed from the GST e-way bill portal.
- The e-way bill number is twelve digits, labelled "E-Way Bill No".
- Valid till is the date after "Valid Upto" (it is printed with a time; give the date). "Generated Date" is when it was made, not how long it runs.
- The vehicle number is in Part B. Where Part B lists more than one vehicle because the load changed trucks, give the most recent entry.`,

  CLIENT_INVOICE_OR_PO: `A tax invoice or purchase order from the client whose goods are being carried.
- The invoice number is labelled "Invoice No." — not the order, challan or e-way bill number, and not the IRN or acknowledgement number.
- The invoice value is the final total payable, tax included ("Grand Total", "Total Invoice Value") — not the taxable value and not a line total.
- The consignor is the seller or supplier sending the goods; its GSTIN is printed with its name at the head of the invoice. The consignee is the party the goods are shipped to ("Ship to", "Consignee"), which is not always the party billed.`,

  LOADING_SLIP: `A loading slip or loading advice from the point where the truck was loaded. Often filled in by hand.
- Packages loaded is the count of packages, bags or boxes; weight loaded is the weight of the goods.`,

  WEIGHMENT_SLIP: `A weighbridge slip.
- It prints three weights: gross (the loaded truck), tare (the empty truck) and net (the goods). Net weight is the third — not the gross.
- The slip number is labelled "Slip No.", "Ticket No." or "Sl. No.".`,

  LR: `A lorry receipt (also called a consignment note, bilty or GR).
- The LR number is labelled "LR No.", "CN No." or "GR No.".`,

  POD: `A proof of delivery: the lorry receipt or delivery challan, signed and stamped by whoever received the goods.
- The date of delivery is the date written by the receiver beside their signature or stamp — not the date the LR was made.`,

  BANK_STATEMENT: `A cancelled cheque, or the first page of a bank statement or passbook.
- On a cheque the account number is printed on its face, usually above or beside the amount box. The line of odd-shaped digits along the bottom edge is not it: that holds the six-digit cheque number, the nine-digit MICR code and a transaction code.
- The IFSC is eleven characters — four letters, a zero, six more — printed with the branch address.
- The account holder is the name printed above where the signature goes on a cheque, or at the head of a statement.`,

  GST_CERTIFICATE: `GST registration certificate (Form GST REG-06).
- The GSTIN is the fifteen-character registration number. The legal name and the trade name are printed on separate lines and can differ.`,

  UDYAM: `Udyam (MSME) registration certificate.
- The registration number reads UDYAM-XX-00-0000000: the word, a two-letter state code, two digits, seven digits.
- The name of the enterprise is under "Name of Enterprise".`,

  TRADE_LICENCE: `A trade licence issued by a municipal body.
- The licence number is labelled "Licence No." or "Certificate No."; valid till is the date after "valid upto" or the end of the period it is granted for.`,

  LABOUR_LICENCE: `A labour licence or a shops and establishments registration.
- The registration or licence number is labelled as such; valid till is the date after "valid upto" or the end of the period it is granted for.`,

  TDS_DECLARATION: `A transporter's declaration under section 194C(6) of the Income Tax Act that no tax is to be deducted at source.
- The PAN is the declarant's. The financial year it covers is written as two years, such as 2026-27.`,

  TRANSPORTER_AGREEMENT: `A signed agreement between the company and a transporter.
- The reference is the agreement number where one is printed; the date is the date it was signed.`,
};

/** How each kind of value is asked for, added to the detail's own label. */
export const FORMAT_GUIDE: Record<OcrFieldFormat, string> = {
  pan: 'a PAN — ten characters: five letters, four digits, one letter',
  aadhaarLast4: 'the Aadhaar number exactly as printed, all twelve digits, with any X’s the card masks it with',
  gstin: 'a GSTIN — fifteen characters beginning with a two-digit state code',
  vehicle: 'a vehicle registration number, in capitals without spaces',
  drivingLicence: 'a driving licence number, in capitals without spaces or hyphens',
  ifsc: 'an IFSC — eleven characters: four letters, a zero, six more',
  bankAccount: 'a bank account number, digits only',
  ewayBill: 'an e-way bill number — twelve digits',
  udyam: 'an Udyam registration number — UDYAM-XX-00-0000000',
  phone: 'a ten-digit Indian mobile number',
  pincode: 'a six-digit PIN code',
  name: 'a name, in English, as printed',
};
