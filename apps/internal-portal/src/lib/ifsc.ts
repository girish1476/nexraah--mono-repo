/**
 * Live IFSC → bank/branch lookup against Razorpay's public IFSC API
 * (`https://ifsc.razorpay.com/{code}`) — free, keyless, CORS-open
 * (`Access-Control-Allow-Origin: *`), no account or credential of any kind.
 *
 * Advisory only, same footing as `lib/gstin.ts`'s GSTN check: this confirms
 * *a bank branch exists* for the typed IFSC and shows it back for the
 * operator to eyeball against what the vendor told them — it does not and
 * cannot confirm the account number itself, and a lookup failure (the
 * service being unreachable, say) must never block onboarding.
 */

export interface IfscBranch {
  bank: string;
  branch: string;
  city: string;
  state: string;
  address: string;
}

export type IfscLookupResult =
  | { status: 'found'; branch: IfscBranch }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export async function lookupIfsc(code: string, signal?: AbortSignal): Promise<IfscLookupResult> {
  let response: Response;
  try {
    response = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(code)}`, { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e; // caller cancelled — propagate, don't swallow
    return { status: 'error', message: 'Could not reach the bank lookup service.' };
  }

  if (response.status === 404) return { status: 'not_found' };
  if (!response.ok) return { status: 'error', message: `Bank lookup returned ${response.status}.` };

  const data = await response.json();
  return {
    status: 'found',
    branch: {
      bank: data.BANK,
      branch: data.BRANCH,
      city: data.CITY,
      state: data.STATE,
      address: data.ADDRESS,
    },
  };
}
