import { HrPolicy, PayLine, Paise, PtTable, SalaryStructure } from './types';

/**
 * One person's pay for one month — the whole calculation, in one pure
 * function, so the payslip, the review table and the bank file all read
 * the same numbers.
 *
 *   earnings   = each salary head × payable days ÷ days in the month
 *   PF         = 12% of earned basic, on the ₹15,000 ceiling unless set to full basic
 *   ESI        = 0.75% of earned gross, while the full monthly gross is ≤ ₹21,000
 *   PT         = the branch state's slab on earned gross (February's figure in February)
 *   TDS        = what HR set from the employee's declaration
 *   net        = earnings − deductions
 *
 * Every amount is rounded to the rupee, as payslips are. ESI rounds up, as
 * ESIC asks; everything else rounds to the nearest rupee.
 */

const rupee = (paise: number): Paise => Math.round(paise / 100) * 100;
const rupeeUp = (paise: number): Paise => Math.ceil(paise / 100) * 100;

export function monthlyGross(s: Pick<SalaryStructure, 'basicPaise' | 'hraPaise' | 'conveyancePaise' | 'specialPaise'>): Paise {
  return s.basicPaise + s.hraPaise + s.conveyancePaise + s.specialPaise;
}

/** Professional tax on a month's gross, from the state's slabs. */
export function professionalTax(table: PtTable | undefined, grossPaise: Paise, month: string, gender: 'F' | 'M' | 'O' | null): Paise {
  if (!table) return 0;
  if (gender === 'F' && table.womenExemptUpToPaise && grossPaise <= table.womenExemptUpToPaise) return 0;
  const slab = table.slabs.find((s) => s.upToPaise === null || grossPaise <= s.upToPaise);
  if (!slab) return 0;
  return month.endsWith('-02') && slab.februaryTaxPaise !== undefined ? slab.februaryTaxPaise : slab.taxPaise;
}

export interface PayInput {
  month: string;
  salary: SalaryStructure;
  policy: HrPolicy;
  /** The state the person's branch is in, for professional tax. */
  state: string;
  gender: 'F' | 'M' | 'O' | null;
  daysInMonth: number;
  lopDays: number;
  /** Extra one-off lines HR added for the month (arrears, bonus, an advance recovered). */
  adjustments?: { label: string; amountPaise: Paise }[];
}

export interface PayResult {
  payableDays: number;
  earnings: PayLine[];
  deductions: PayLine[];
  employer: PayLine[];
  grossPaise: Paise;
  deductionsPaise: Paise;
  netPaise: Paise;
  esiApplies: boolean;
}

export function computePay(input: PayInput): PayResult {
  const { salary: s, policy } = input;
  const lop = Math.min(Math.max(input.lopDays, 0), input.daysInMonth);
  const payableDays = input.daysInMonth - lop;
  const factor = input.daysInMonth ? payableDays / input.daysInMonth : 0;
  const earn = (code: string, label: string, full: Paise): PayLine => ({ code, label, fullPaise: full, amountPaise: rupee(full * factor) });

  const earnings: PayLine[] = [
    earn('BASIC', 'Basic', s.basicPaise),
    earn('HRA', 'House rent allowance', s.hraPaise),
    earn('CONV', 'Conveyance allowance', s.conveyancePaise),
    earn('SPECIAL', 'Special allowance', s.specialPaise),
  ].filter((l) => (l.fullPaise ?? 0) > 0);
  for (const a of input.adjustments ?? []) {
    if (a.amountPaise > 0) earnings.push({ code: 'ADJ', label: a.label, amountPaise: rupee(a.amountPaise) });
  }
  const grossPaise = earnings.reduce((t, l) => t + l.amountPaise, 0);
  const earnedBasic = earnings.find((l) => l.code === 'BASIC')?.amountPaise ?? 0;

  const deductions: PayLine[] = [];
  const employer: PayLine[] = [];

  if (s.pfApplicable && earnedBasic > 0) {
    const pfWage = s.pfOnFullBasic ? earnedBasic : Math.min(earnedBasic, policy.pfWageCeilingPaise);
    const pf = rupee((pfWage * policy.pfRatePct) / 100);
    deductions.push({ code: 'PF', label: 'Provident fund', amountPaise: pf });
    const eps = rupee((Math.min(pfWage, policy.pfWageCeilingPaise) * policy.epsRatePct) / 100);
    employer.push({ code: 'EPF_ER', label: 'Employer PF', amountPaise: pf - eps });
    employer.push({ code: 'EPS_ER', label: 'Employer pension (EPS)', amountPaise: eps });
  }

  const esiApplies = monthlyGross(s) <= policy.esiGrossLimitPaise && grossPaise > 0;
  if (esiApplies) {
    deductions.push({ code: 'ESI', label: 'ESI', amountPaise: rupeeUp((grossPaise * policy.esiEmployeePct) / 100) });
    employer.push({ code: 'ESI_ER', label: 'Employer ESI', amountPaise: rupeeUp((grossPaise * policy.esiEmployerPct) / 100) });
  }

  const pt = professionalTax(policy.ptTables.find((t) => t.state === input.state), grossPaise, input.month, input.gender);
  if (pt > 0) deductions.push({ code: 'PT', label: 'Professional tax', amountPaise: pt });

  if (s.tdsMonthlyPaise > 0) deductions.push({ code: 'TDS', label: 'Income tax (TDS)', amountPaise: rupee(s.tdsMonthlyPaise) });

  for (const a of input.adjustments ?? []) {
    if (a.amountPaise < 0) deductions.push({ code: 'ADJ', label: a.label, amountPaise: rupee(-a.amountPaise) });
  }

  // Never a negative payslip: what cannot be recovered this month is not taken.
  let deductionsPaise = deductions.reduce((t, l) => t + l.amountPaise, 0);
  if (deductionsPaise > grossPaise) {
    const over = deductionsPaise - grossPaise;
    const last = deductions[deductions.length - 1];
    last.amountPaise = Math.max(0, last.amountPaise - over);
    deductionsPaise = deductions.reduce((t, l) => t + l.amountPaise, 0);
  }

  return {
    payableDays,
    earnings,
    deductions,
    employer,
    grossPaise,
    deductionsPaise,
    netPaise: grossPaise - deductionsPaise,
    esiApplies,
  };
}

/**
 * A suggested split of a monthly gross: basic half the gross (the new labour
 * codes count allowances above half of pay as wages), HRA 40% of basic, ₹1,600
 * conveyance, the rest special allowance. A starting point HR edits.
 */
export function suggestStructure(grossPaise: Paise): Pick<SalaryStructure, 'basicPaise' | 'hraPaise' | 'conveyancePaise' | 'specialPaise'> {
  const basicPaise = rupee(grossPaise * 0.5);
  const hraPaise = rupee(basicPaise * 0.4);
  const conveyancePaise = Math.min(1_600_00, Math.max(0, grossPaise - basicPaise - hraPaise));
  return { basicPaise, hraPaise, conveyancePaise, specialPaise: Math.max(0, grossPaise - basicPaise - hraPaise - conveyancePaise) };
}

/** The bank's bulk-transfer sheet: one row per person paid. */
export function bankFileCsv(rows: { name: string; accountNo: string | null; ifsc: string | null; netPaise: Paise; code: string }[], month: string): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['Beneficiary name,Account number,IFSC,Amount (₹),Narration,Employee code'];
  for (const r of rows) {
    if (!r.accountNo || r.netPaise <= 0) continue;
    lines.push([r.name, r.accountNo, r.ifsc ?? '', (r.netPaise / 100).toFixed(2), `Salary ${month}`, r.code].map((v) => esc(String(v))).join(','));
  }
  return lines.join('\r\n');
}
