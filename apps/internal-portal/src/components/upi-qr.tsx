'use client';

import { useEffect, useState } from 'react';
import { useIntegrationSwitches } from '@/lib/integration-switches';
import { qrImage, upiLink } from '@/lib/upi';

/**
 * "Scan to pay" on a printed invoice — for the amount still due, to the UPI ID
 * saved under Control → Integrations → UPI payment code. Nothing at all when
 * no UPI ID is saved, the code is switched off, nothing is due, or the QR
 * library cannot be fetched: the bank details beside it still say how to pay.
 */
export function UpiQr({ amountPaise, invoiceCode }: { amountPaise: number; invoiceCode: string | null }) {
  const switches = useIntegrationSwitches();
  const upi = switches?.upi ?? null;
  const [src, setSrc] = useState<string | null>(null);
  const link = upi && amountPaise > 0 && invoiceCode ? upiLink(upi, amountPaise, `Invoice ${invoiceCode}`) : null;

  useEffect(() => {
    if (!link) return setSrc(null);
    let live = true;
    qrImage(link)
      .then((s) => live && setSrc(s))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [link]);

  if (!upi || !src) return null;
  return (
    <div data-upi-qr style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`UPI code to pay ₹${(amountPaise / 100).toLocaleString('en-IN')}`} style={{ width: 96, height: 96 }} />
      <div style={{ fontSize: 10.5, lineHeight: 1.45 }}>
        <div style={{ fontWeight: 700 }}>Scan to pay by UPI</div>
        <div>₹{(amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        <div>{upi.vpa}</div>
        {upi.payeeName ? <div>{upi.payeeName}</div> : null}
      </div>
    </div>
  );
}
