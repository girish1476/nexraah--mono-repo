/**
 * The "scan to pay" code on an invoice: a standard UPI payment link (NPCI's
 * upi://pay form — payee, name, amount in rupees, INR, a note) drawn as a QR
 * code. Any UPI app reads it and opens with everything filled in; nothing is
 * sent anywhere to make it. The drawing library (qrcode-generator) loads from
 * jsDelivr the first time a code is needed, as the document reader's do.
 */

export interface UpiPayee {
  vpa: string;
  payeeName: string;
}

/** The UPI link for an amount. The note carries the invoice number, so the payment says what it is for. */
export function upiLink(payee: UpiPayee, amountPaise: number, note: string): string {
  const q = new URLSearchParams({ pa: payee.vpa, pn: payee.payeeName || payee.vpa, am: (amountPaise / 100).toFixed(2), cu: 'INR' });
  if (note) q.set('tn', note.slice(0, 50));
  // UPI apps expect %20 for spaces; URLSearchParams writes "+".
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

const LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

type QrFactory = (type: number, level: 'L' | 'M' | 'Q' | 'H') => {
  addData(text: string): void;
  make(): void;
  createSvgTag(opts: { cellSize: number; margin: number; scalable?: boolean }): string;
};

let loading: Promise<QrFactory> | null = null;

function loadQr(): Promise<QrFactory> {
  const w = window as unknown as { qrcode?: QrFactory };
  if (w.qrcode) return Promise.resolve(w.qrcode);
  if (!loading) {
    loading = new Promise<QrFactory>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.async = true;
      s.onload = () => (w.qrcode ? resolve(w.qrcode) : reject(new Error('The QR library did not load.')));
      s.onerror = () => {
        loading = null;
        reject(new Error('The QR library could not be fetched.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** The QR code for a link, as an SVG image address ready for an <img>. */
export async function qrImage(text: string): Promise<string> {
  const qrcode = await loadQr();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
