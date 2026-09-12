'use client';

import { useEffect, useState } from 'react';
import { lorryReceiptBody, lorryReceiptDocument } from '@/lib/lorry-receipt-html';
import { isInVendorApp, nativePrint, onNativePrintResult } from '@/lib/native-bridge';
import { getLorryReceipt } from '../../../trips/apis';
import { LorryReceipt } from '../../../trips/types';

/**
 * Printable lorry receipt — `/print/lr/[id]`.
 *
 * Replaces a "Download PDF to print" button that could never have worked:
 * it was an `<a href={lr.pdfUrl} target="_blank">`, and `pdfUrl` is `'#'` in
 * the fixture and `null` from the real API (`portal-trips.service.ts`). No
 * PDF was generated anywhere, so the link opened a blank tab — which is what
 * "it goes to another page" was.
 *
 * Printing the page rather than generating a file is deliberate: the print
 * dialog offers "Save as PDF" on both platforms, so the transporter still
 * gets a file, with no PDF library in the bundle and no rendering service
 * behind the API.
 *
 * Two renderers, one document. In a browser this page prints itself. Inside
 * the vendor app it cannot — Android's WebView has no `window.print()` — so
 * the same HTML is handed to `expo-print` natively over the bridge. Both
 * paths render `lorryReceiptBody`/`lorryReceiptDocument`, so the paper is
 * identical either way.
 */
export default function PrintLorryReceiptPage({ params }: { params: { id: string } }) {
  const [lr, setLr] = useState<LorryReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inApp, setInApp] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    getLorryReceipt(params.id)
      .then(setLr)
      .catch((e) => setError(e.message));
  }, [params.id]);

  // Read after mount, never during render: the server has no `window`, and a
  // value that differs between the server pass and the first client pass is
  // a hydration mismatch.
  useEffect(() => setInApp(isInVendorApp()), []);

  // Without this the app path would sit on "Opening the print options…"
  // forever, whether it worked or not.
  useEffect(
    () =>
      onNativePrintResult((result) =>
        setNote(result.ok ? null : (result.message ?? 'The receipt could not be printed.')),
      ),
    [],
  );

  if (error) {
    return (
      <main className="print-sheet">
        <p>{error}</p>
      </main>
    );
  }
  if (!lr) {
    return (
      <main className="print-sheet">
        <p>Preparing the lorry receipt…</p>
      </main>
    );
  }

  const print = () => {
    if (inApp) {
      const sent = nativePrint(lorryReceiptDocument(lr), lr.lrNo);
      setNote(
        sent
          ? 'Opening the print options…'
          : 'This copy of the app cannot print yet. Open this page in your browser instead.',
      );
      return;
    }
    window.print();
  };

  return (
    <main className="print-sheet">
      <div className="no-print print-actions">
        <button type="button" onClick={print}>
          Print or save as PDF
        </button>
        <span>
          {inApp
            ? 'Choose your printer, or “Save as PDF” to keep the file on your phone.'
            : 'Choose “Save as PDF” in the print dialog if you want the file.'}
        </span>
        {note && <p role="status">{note}</p>}
      </div>

      {/*
        * The same string the app hands to `expo-print`, so the two can never
        * drift into printing different paper. It is built by us from a typed
        * payload and escaped at every interpolation — see `esc()` there.
        */}
      <div dangerouslySetInnerHTML={{ __html: lorryReceiptBody(lr) }} />
    </main>
  );
}
