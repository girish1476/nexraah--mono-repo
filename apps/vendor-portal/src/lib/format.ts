/** Money crosses the wire as bigint paise (NFR-09); ₹ is presentation only. */
export const inr = (paise: number) =>
  '₹' + Math.round(paise / 100).toLocaleString('en-IN');

export const inrRange = (lowPaise: number, highPaise: number) =>
  `${inr(lowPaise)} – ${inr(highPaise)}`;

/** "nashik" → "Nashik" — free-text names typed in any case. */
export const capitalizeWords = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
