'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { getInvoice } from '@/app/invoices/apis';
import { InvoiceDetail } from '@/app/invoices/types';
import { TaxInvoiceSheet } from '@/components/tax-invoice-sheet';
import { ErrorState, Loading } from '@/lib/ui';

/**
 * Many manual invoices printed together — `/print/invoices?ids=a,b,c`, where
 * the bulk builder sends you after generating a batch. One A4 sheet each
 * (`.sheet` breaks the page in print CSS), so "Save as PDF" gives one file
 * with every invoice in it.
 *
 * The ids are read off `window.location` rather than `useSearchParams`, which
 * would put the page behind a Suspense boundary for one string.
 */
export default function PrintInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ids = (new URLSearchParams(window.location.search).get('ids') ?? '').split(',').filter(Boolean);
    if (ids.length === 0) return setError('No invoices were named to print.');
    Promise.all(ids.map((id) => getInvoice(id)))
      .then(setInvoices)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!invoices) return <Loading what="Preparing the invoices" />;

  return (
    <div style={{ background: '#fff', color: '#000', padding: 20 }}>
      <div className="no-print" style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn" onClick={() => window.print()}>
          Print all {invoices.length}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          One A4 page each · choose “Save as PDF” as the printer for a single file · switch on “Background graphics”
        </span>
      </div>
      {invoices.map((inv) =>
        inv.manual ? (
          <TaxInvoiceSheet key={inv.id} invoice={{ ...inv, manual: inv.manual }} />
        ) : (
          <div key={inv.id} className="sheet muted" style={{ padding: 20 }}>
            {inv.code ?? 'Draft'} was not built by hand — print it from its own page.
          </div>
        ),
      )}
    </div>
  );
}
