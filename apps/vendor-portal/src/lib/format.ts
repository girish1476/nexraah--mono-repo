/** Money crosses the wire as bigint paise (NFR-09); ₹ is presentation only. */
export const inr = (paise: number) =>
  '₹' + Math.round(paise / 100).toLocaleString('en-IN');

export const inrRange = (lowPaise: number, highPaise: number) =>
  `${inr(lowPaise)} – ${inr(highPaise)}`;

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
