'use client';

import { useState } from 'react';
import { errorMessage } from '@/apis';
import { useToast } from '@/lib/ui';

/**
 * Downloads one month's payslip as a PDF file (lib/payslip-pdf.ts) — no print
 * dialog, no screen in between. jsPDF is loaded only when it is pressed.
 */
export function PayslipDownload({
  id,
  label = 'Download PDF',
  className = 'btn btn-sm',
}: {
  id: string;
  label?: string;
  className?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      data-payslip-download={id}
      disabled={busy}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setBusy(true);
        try {
          const { downloadPayslipPdf } = await import('@/lib/payslip-pdf');
          await downloadPayslipPdf(id);
        } catch (err) {
          toast(`The payslip could not be made: ${errorMessage(err)}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Preparing…' : `⬇ ${label}`}
    </button>
  );
}
