import { jsPDF } from 'jspdf';
import { getConfig } from '@/app/admin/apis';
import type { CompanyDetails } from '@/app/admin/types';
import { getPayslip } from '@/lib/hr/apis';
import { dateLabel, monthLabel } from '@/lib/hr/calendar';
import type { PayLine, Payslip } from '@/lib/hr/types';
import { amountInWords } from '@/lib/manual-invoice';

/**
 * A month's payslip as a real PDF file — downloaded straight away, one A4 page,
 * on the company's letterhead. Same content as `/print/payslip/[id]`: who,
 * which month, the days paid, earnings beside deductions, and the take-home in
 * figures and words.
 *
 * jsPDF's built-in Helvetica has no ₹ glyph, so money reads "Rs." here and
 * typographic characters are swapped for plain ones (`clean`), exactly as the
 * invoice PDF does (lib/invoice-pdf.ts).
 */

const clean = (s: string | null | undefined): string =>
  String(s ?? '')
    .replace(/→/g, '->')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₹/g, 'Rs. ')
    .replace(/·/g, '|');

const money = (paise: number) =>
  `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const PAGE_W = 210;
const MARGIN = 15;
const WIDTH = PAGE_W - MARGIN * 2;
const RIGHT = MARGIN + WIDTH;

const NAVY: [number, number, number] = [11, 21, 64];
const BLUE: [number, number, number] = [33, 150, 230];
const INK: [number, number, number] = [17, 24, 39];
const SOFT: [number, number, number] = [96, 108, 128];
const LINE: [number, number, number] = [214, 221, 233];
const TINT: [number, number, number] = [240, 245, 252];

async function loadLogo(): Promise<string | null> {
  try {
    const response = await fetch('/nexraah-logo-print.png');
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** The file name a payslip downloads as: Nexraah-Payslip-<code>-<YYYY-MM>.pdf. */
export function payslipFileName(slip: Pick<Payslip, 'month' | 'employee'>): string {
  const code = clean(slip.employee.code).replace(/[^A-Za-z0-9-]+/g, '') || 'employee';
  return `Nexraah-Payslip-${code}-${slip.month}.pdf`;
}

export function drawPayslip(slip: Payslip, company: CompanyDetails | null, logo: string | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const month = monthLabel(slip.month);
  doc.setProperties({ title: `Payslip ${month} - ${clean(slip.employee.name)}`, author: clean(company?.name) || 'Nexraah' });

  /* ---- letterhead ---- */
  let y = 14;
  const textX = logo ? MARGIN + 22 : MARGIN;
  if (logo) doc.addImage(logo, 'PNG', MARGIN, y - 2, 17, 20, undefined, 'FAST');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(clean(company?.name) || 'Nexraah', textX, y + 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SOFT);
  const addr = company?.address ? doc.splitTextToSize(clean(company.address).replace(/\s*\n\s*/g, ', '), 105) : [];
  doc.text(addr.slice(0, 3), textX, y + 8);
  const ids = [company?.gstin && `GSTIN ${company.gstin}`, company?.cin && `CIN ${company.cin}`].filter(Boolean).join('   ');
  if (ids) doc.text(clean(ids), textX, y + 8 + Math.min(addr.length, 3) * 3.6);

  doc.setTextColor(...BLUE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('PAYSLIP', RIGHT, y + 1, { align: 'right' });
  doc.setTextColor(...NAVY);
  doc.setFontSize(17);
  doc.text(month, RIGHT, y + 9, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SOFT);
  doc.text(`Pay period ${month}`, RIGHT, y + 14, { align: 'right' });

  y = 40;
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, RIGHT, y);

  /* ---- the employee ---- */
  y += 6;
  const who: [string, string][] = [
    ['Employee', slip.employee.name],
    ['Employee code', slip.employee.code],
    ['Designation', slip.employee.designation],
    ['Department', slip.employee.department],
    ['Branch', slip.employee.branchName],
    ['Date of joining', dateLabel(slip.employee.joinedOn)],
    ['PAN', slip.employee.pan ?? '-'],
    ['PF UAN', slip.employee.uan ?? '-'],
    ['ESI number', slip.employee.esicNo ?? '-'],
    ['Bank', slip.employee.bankName ?? 'Not on file'],
    ['Account', slip.employee.accountNo ?? '-'],
    ['IFSC', slip.employee.ifsc ?? '-'],
  ];
  const colW = WIDTH / 3;
  who.forEach(([k, v], i) => {
    const x = MARGIN + (i % 3) * colW;
    const rowY = y + Math.floor(i / 3) * 10.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SOFT);
    doc.text(k.toUpperCase(), x, rowY, { charSpace: 0.3 });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(clean(v) || '-', colW - 4)[0], x, rowY + 4.6);
  });
  y += 4 * 10.5 + 1;

  /* ---- the days ---- */
  const dayBoxes: [string, number][] = [
    ['Days in month', slip.days.inMonth],
    ['Days paid', slip.days.payable],
    ['Unpaid days', slip.days.lop],
    ['Leave taken', slip.days.leave],
    ['Holidays & offs', slip.days.holidays + slip.days.weeklyOffs],
  ];
  const boxW = (WIDTH - 4 * 3) / 5;
  dayBoxes.forEach(([k, v], i) => {
    const x = MARGIN + i * (boxW + 3);
    doc.setFillColor(...TINT);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, boxW, 15, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SOFT);
    doc.text(k, x + boxW / 2, y + 5.5, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text(days(v), x + boxW / 2, y + 11.8, { align: 'center' });
  });
  y += 22;

  /* ---- earnings beside deductions ---- */
  const tableW = (WIDTH - 6) / 2;
  const rows = Math.max(slip.earnings.length, slip.deductions.length, 1);
  const rowH = 7;
  const table = (x: number, title: string, lines: PayLine[], totalLabel: string, total: number) => {
    let ty = y;
    doc.setFillColor(...NAVY);
    doc.rect(x, ty, tableW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(title, x + 3, ty + 5.4);
    doc.text('Amount', x + tableW - 3, ty + 5.4, { align: 'right' });
    ty += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (let i = 0; i < rows; i++) {
      const line = lines[i];
      if (i % 2 === 1) {
        doc.setFillColor(250, 251, 254);
        doc.rect(x, ty, tableW, rowH, 'F');
      }
      if (line) {
        doc.setTextColor(...INK);
        doc.text(doc.splitTextToSize(clean(line.label), tableW - 34)[0], x + 3, ty + 4.8);
        doc.text(money(line.amountPaise), x + tableW - 3, ty + 4.8, { align: 'right' });
      }
      ty += rowH;
    }
    doc.setFillColor(...TINT);
    doc.rect(x, ty, tableW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...NAVY);
    doc.text(totalLabel, x + 3, ty + 5.4);
    doc.text(money(total), x + tableW - 3, ty + 5.4, { align: 'right' });
    ty += 8;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.rect(x, y, tableW, ty - y, 'S');
    return ty;
  };
  const endA = table(MARGIN, 'Earnings', slip.earnings, 'Gross earnings', slip.grossPaise);
  const endB = table(MARGIN + tableW + 6, 'Deductions', slip.deductions, 'Total deductions', slip.deductionsPaise);
  y = Math.max(endA, endB) + 7;

  /* ---- take-home ---- */
  const words = doc.splitTextToSize(clean(amountInWords(slip.netPaise)), WIDTH - 75);
  const netH = Math.max(22, 14 + words.length * 4.2);
  doc.setFillColor(...NAVY);
  doc.roundedRect(MARGIN, y, WIDTH, netH, 3, 3, 'F');
  doc.setFillColor(...BLUE);
  doc.rect(MARGIN, y + 3, 1.6, netH - 6, 'F');
  doc.setTextColor(170, 205, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`NET PAY FOR ${month.toUpperCase()}`, MARGIN + 7, y + 8, { charSpace: 0.6 });
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(words, MARGIN + 7, y + 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(money(slip.netPaise), RIGHT - 6, y + netH / 2 + 2.5, { align: 'right' });
  y += netH + 7;

  /* ---- what the company pays on top ---- */
  if (slip.employer.length > 0) {
    const total = slip.employer.reduce((a, l) => a + l.amountPaise, 0);
    const line = `Paid by the company on top of your salary: ${slip.employer
      .map((l) => `${clean(l.label)} ${money(l.amountPaise)}`)
      .join(', ')} - ${money(total)} in all.`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...SOFT);
    const wrapped = doc.splitTextToSize(line, WIDTH);
    doc.text(wrapped, MARGIN, y);
    y += wrapped.length * 4 + 4;
  }

  /* ---- footer ---- */
  const foot = doc.splitTextToSize(
    clean(
      'This payslip is computer-generated and needs no signature. Unpaid days are absences, unpaid leave and half of ' +
        `each half day. For any question about it, write to HR${company?.email ? ` at ${company.email}` : ''}.`,
    ),
    WIDTH,
  );
  const footY = Math.max(y + 4, 270);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, footY - 5, RIGHT, footY - 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SOFT);
  doc.text(foot, MARGIN, footY);
  doc.text(`Generated ${dateLabel(new Date().toISOString().slice(0, 10))}`, RIGHT, footY + foot.length * 3.6 + 1.5, {
    align: 'right',
  });
  return doc;
}

/** Fetches one payslip and the company's letterhead, and downloads it as a PDF. */
export async function downloadPayslipPdf(id: string): Promise<void> {
  const [slip, config, logo] = await Promise.all([getPayslip(id), getConfig().catch(() => null), loadLogo()]);
  const doc = drawPayslip(slip, config?.company ?? null, logo);
  doc.save(payslipFileName(slip));
}
