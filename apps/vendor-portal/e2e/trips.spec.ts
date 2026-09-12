import { test, expect, Page } from '@playwright/test';

/**
 * Covers src/app/trips/page.tsx, src/app/trips/[id]/page.tsx,
 * src/app/trips/[id]/pod/page.tsx, src/app/trips/[id]/bill/page.tsx and
 * src/app/trips/[id]/lorry-receipt/page.tsx against the FIXTURES seeded in
 * src/app/trips/apis.ts (mock mode, NEXT_PUBLIC_MOCK=1).
 *
 * Fixture reference (do not drift from apis.ts):
 *  TR-20881  Nashik  -> Kolkata      PLACED / POD PENDING
 *            freight ₹58,400 · advance 40% ₹23,360 (held, 3 blockers) · balance ₹35,040
 *            net payable ₹35,040 (no penalty, advance not yet released)
 *  TR-20874  Chakan  -> Coimbatore   DELIVERED / POD REJECTED
 *            reason "Consignee stamp missing on the reverse."
 *            freight ₹31,200 · advance 40% ₹12,480 released, UTR HDFC0004471829
 *            balance ₹18,720 · podDaysElapsed 24 -> 4 days over 20 -> penalty ₹400
 *            net payable ₹18,320
 *  TR-20860  Pune    -> Indore       CLOSED / POD APPROVED
 *            freight ₹22,650 · advance 40% ₹9,060 released, UTR SBIN26070441721
 *            balance ₹13,590 · podDaysElapsed 6 -> no penalty · net payable ₹13,590
 *
 * BR-55/NFR-02: the transporter must never see client name, sell rate, other
 * vendors' quotes, or margin anywhere in this flow.
 */

const FORBIDDEN_TERMS = [
  'client',
  'competitor',
  'sell rate',
  'selling rate',
  'other vendor',
  'other quote',
  'quote count',
  'winning bid',
  'winning price',
  ' margin',
];

async function assertNoRedactedFields(page: Page) {
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    expect(text, `redaction leak: found "${term}" in page text`).not.toContain(term);
  }
}

function cardFor(page: Page, title: RegExp) {
  return page.locator('div.card', { has: page.locator('.card-title', { hasText: title }) });
}

const LANES = {
  placed: /Nashik\s*→\s*Kolkata/,
  rejected: /Chakan\s*→\s*Coimbatore/,
  closed: /Pune\s*→\s*Indore/,
};

test.describe('trips list', () => {
  test('renders all three fixture trips with lane, status pill and POD pill', async ({ page }) => {
    await page.goto('/trips');

    for (const lane of Object.values(LANES)) {
      await expect(page.locator('.card-title').filter({ hasText: lane })).toBeVisible();
    }

    const placed = cardFor(page, LANES.placed);
    await expect(placed).toContainText('TR-20881');
    await expect(placed).toContainText('NXR/LR/26/0884');
    await expect(placed).toContainText('MH 15 GT 4482');
    await expect(placed).toContainText('Placement confirmed'); // TRIP_STATUS_LABEL.PLACED
    await expect(placed).toContainText('POD · Not attached');

    const rejected = cardFor(page, LANES.rejected);
    await expect(rejected).toContainText('TR-20874');
    await expect(rejected).toContainText('Delivered');
    await expect(rejected).toContainText('POD · Rejected');

    const closed = cardFor(page, LANES.closed);
    await expect(closed).toContainText('TR-20860');
    await expect(closed).toContainText('Closed');
    await expect(closed).toContainText('POD · Approved');

    await assertNoRedactedFields(page);
  });

  test('TR-20881 shows the held advance with blocker count; TR-20874/TR-20860 show the released advance with UTR', async ({ page }) => {
    await page.goto('/trips');

    const placed = cardFor(page, LANES.placed);
    await expect(placed).toContainText('₹35,040 due on POD');
    await expect(placed).toContainText('₹23,360 advance held — 3 documents blocking');

    const rejected = cardFor(page, LANES.rejected);
    await expect(rejected).toContainText('₹18,320 due on POD');
    await expect(rejected).toContainText('₹12,480 advance paid');
    await expect(rejected).toContainText('UTR HDFC0004471829');

    const closed = cardFor(page, LANES.closed);
    await expect(closed).toContainText('₹13,590 due on POD');
    await expect(closed).toContainText('₹9,060 advance paid');
    await expect(closed).toContainText('UTR SBIN26070441721');
  });

  test('action rows reflect what is actually available per trip, with a stated reason when blocked', async ({ page }) => {
    await page.goto('/trips');

    // TR-20881: LR issued (enabled), not delivered yet (POD blocked), POD not
    // approved (bill blocked).
    const placed = cardFor(page, LANES.placed);
    await expect(placed.getByRole('link', { name: 'Lorry receipt' })).toBeVisible();
    await expect(placed.getByText('✗ Trip not delivered yet')).toBeVisible();
    await expect(placed.getByText('✗ Proof of delivery not yet approved')).toBeVisible();

    // TR-20874: delivered, so POD (re-attach) is enabled even though it was
    // rejected; bill is still blocked because POD isn't approved.
    const rejected = cardFor(page, LANES.rejected);
    await expect(rejected.getByRole('link', { name: 'Lorry receipt' })).toBeVisible();
    await expect(rejected.getByRole('link', { name: 'Proof of delivery' })).toBeVisible();
    await expect(rejected.getByText('✗ Proof of delivery not yet approved')).toBeVisible();

    // TR-20860: closed with an approved POD, so billing is enabled; POD entry
    // itself is blocked again because the trip is CLOSED, not DELIVERED.
    const closed = cardFor(page, LANES.closed);
    await expect(closed.getByRole('link', { name: 'Lorry receipt' })).toBeVisible();
    await expect(closed.getByText('✗ Trip not delivered yet')).toBeVisible();
    await expect(closed.getByRole('link', { name: 'Raise your bill' })).toBeVisible();
  });

  test('clicking a trip card navigates to its detail page', async ({ page }) => {
    await page.goto('/trips');
    const card = page.locator('a', { hasText: LANES.placed });
    await card.click();

    await expect(page).toHaveURL(/\/trips\/TR-20881$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'TR-20881' })).toBeVisible();
  });

  test('trips carrying no LR yet would show the LR action blocked (contract check via fixture presence)', async ({ page }) => {
    // All three fixtures currently carry an lrNo, so the "LR not issued yet"
    // path has no live fixture to exercise — asserting its absence here
    // documents that, rather than inventing a trip that doesn't exist.
    await page.goto('/trips');
    await expect(page.getByText('✗ LR not issued yet')).toHaveCount(0);
  });
});

test.describe('trip detail', () => {
  test('TR-20881: advance blockers list, PLACED milestones, and the not-yet-paid balance breakdown', async ({ page }) => {
    await page.goto('/trips/TR-20881');

    await expect(page.getByRole('heading', { name: 'TR-20881' })).toBeVisible();
    await expect(page.getByText('Nashik → Kolkata · 1,912 km')).toBeVisible();

    // Advance held callout with every blocker named.
    const advanceCallout = page.locator('.card', { hasText: '₹23,360 advance held' });
    await expect(advanceCallout).toBeVisible();
    await expect(advanceCallout).toContainText('3 documents gate the advance');
    await expect(advanceCallout).toContainText('Driving licence not on file');
    await expect(advanceCallout).toContainText('Nothing uploaded for Sandeep Rathod');
    await expect(advanceCallout).toContainText('Registration certificate unverified');
    await expect(advanceCallout).toContainText('Uploaded 11 Aug — with compliance');
    await expect(advanceCallout).toContainText('E-way bill missing');
    await expect(advanceCallout).toContainText('Required before the truck leaves the plant');
    await expect(advanceCallout.getByRole('link', { name: 'Upload them in Profile →' })).toBeVisible();

    // No delivery yet, so no POD clock callout.
    await expect(page.getByText('days left in the window')).toHaveCount(0);

    // Facts.
    await expect(page.getByText('MH 15 GT 4482')).toBeVisible();
    await expect(page.getByText('Sandeep Rathod · 98220 41xx')).toBeVisible();

    // What you will be paid.
    const payCard = page.locator('.card', { hasText: 'What you will be paid' });
    await expect(payCard).toContainText('₹58,400'); // billable freight
    await expect(payCard).toContainText('Not released yet');
    await expect(payCard).toContainText('−₹23,360'); // advance not yet deducted-from-view
    await expect(payCard).toContainText('None so far'); // no POD penalty
    await expect(payCard).toContainText('−₹0');
    await expect(payCard).toContainText('₹35,040'); // net payable

    // Milestones — 3 done, 3 awaited. Scoped to the milestones card: the
    // PLACED label text also appears in the header status pill and the
    // "Status" fact row, so a bare page-wide getByText is ambiguous for it.
    const milestonesCard = page.locator('.card', { hasText: 'POD awaited' });
    await expect(milestonesCard).toContainText('Placement confirmed');
    await expect(milestonesCard).toContainText('Reported at plant');
    await expect(milestonesCard).toContainText('Loaded, LR issued');
    await expect(milestonesCard).toContainText('In transit');
    await expect(milestonesCard).toContainText('Delivered at Kolkata');
    await expect(milestonesCard).toContainText('POD awaited');

    // Bottom links: LR yes, bill no (POD not approved).
    await expect(page.getByRole('link', { name: /Lorry receipt NXR\/LR\/26\/0884/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Raise your bill' })).toHaveCount(0);

    await assertNoRedactedFields(page);
  });

  test('TR-20874: advance released with UTR, POD-rejected clock with accrued penalty, and the deducted balance breakdown', async ({ page }) => {
    await page.goto('/trips/TR-20874');

    await expect(page.getByRole('heading', { name: 'TR-20874' })).toBeVisible();
    await expect(page.getByText('Chakan → Coimbatore · 1,088 km')).toBeVisible();

    const releasedCallout = page.locator('.card', { hasText: '₹12,480 advance released' });
    await expect(releasedCallout).toBeVisible();
    await expect(releasedCallout).toContainText('UTR HDFC0004471829');

    // POD clock — 24 days elapsed, 4 days past the 20-day window.
    const clockCallout = page.locator('.card', { hasText: '₹400 deducted so far — 4 days over' });
    await expect(clockCallout).toBeVisible();
    await expect(clockCallout).toContainText(
      'After 20 days a deduction of ₹100 a day applies, and past 40 days no balance is paid.',
    );
    await expect(clockCallout.getByRole('link', { name: 'Re-attach the POD →' })).toBeVisible();

    // What you will be paid.
    const payCard = page.locator('.card', { hasText: 'What you will be paid' });
    await expect(payCard).toContainText('₹31,200'); // billable freight
    await expect(payCard).toContainText('UTR HDFC0004471829');
    await expect(payCard).toContainText('−₹12,480');
    await expect(payCard).toContainText('4 days beyond 20 · ₹100/day');
    await expect(payCard).toContainText('−₹400');
    await expect(payCard).toContainText('₹18,320'); // net payable

    // Bottom links: LR yes, bill no (POD rejected, not approved).
    await expect(page.getByRole('link', { name: /Lorry receipt NXR\/LR\/26\/0871/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Raise your bill' })).toHaveCount(0);

    await assertNoRedactedFields(page);
  });

  test('TR-20860: advance released with UTR, no clock (POD already approved), zero penalty, bill link available', async ({ page }) => {
    await page.goto('/trips/TR-20860');

    await expect(page.getByRole('heading', { name: 'TR-20860' })).toBeVisible();
    await expect(page.getByText('Pune → Indore · 585 km')).toBeVisible();

    const releasedCallout = page.locator('.card', { hasText: '₹9,060 advance released' });
    await expect(releasedCallout).toBeVisible();
    await expect(releasedCallout).toContainText('UTR SBIN26070441721');

    // POD already approved — no clock callout at all, even though
    // podDaysElapsed (6) is set on the fixture.
    await expect(page.getByText('days left in the window')).toHaveCount(0);
    await expect(page.getByText('days over')).toHaveCount(0);

    const payCard = page.locator('.card', { hasText: 'What you will be paid' });
    await expect(payCard).toContainText('₹22,650'); // billable freight
    await expect(payCard).toContainText('UTR SBIN26070441721');
    await expect(payCard).toContainText('−₹9,060');
    await expect(payCard).toContainText('None so far');
    await expect(payCard).toContainText('−₹0');
    await expect(payCard).toContainText('₹13,590'); // net payable

    // Bottom links: both LR and bill available.
    await expect(page.getByRole('link', { name: /Lorry receipt NXR\/LR\/26\/0855/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Raise your bill' })).toBeVisible();

    await assertNoRedactedFields(page);
  });

  test('an unknown trip id shows "Trip not found", not a crash', async ({ page }) => {
    await page.goto('/trips/TR-00000');
    await expect(page.getByText('Trip not found')).toBeVisible();
  });
});

test.describe('lorry receipt sub-page', () => {
  test('navigating from the trip detail shows the fixture LR data for TR-20881', async ({ page }) => {
    await page.goto('/trips/TR-20881');
    await page.getByRole('link', { name: /Lorry receipt NXR\/LR\/26\/0884/ }).click();

    await expect(page).toHaveURL(/\/trips\/TR-20881\/lorry-receipt$/, { timeout: 15_000 });
    await expect(page.getByText('NXR/LR/26/0884')).toBeVisible();
    await expect(page.getByText('Nashik → Kolkata')).toBeVisible();
    await expect(page.getByText('Decorative paint, 640 cartons')).toBeVisible();
    await expect(page.getByText('18 MT')).toBeVisible();
    await expect(page.getByText('32 ft SXL')).toBeVisible();
    await expect(page.getByText('MH 15 GT 4482')).toBeVisible();
    await expect(page.getByText('Sandeep Rathod · MH15 20190004471')).toBeVisible();
    await expect(page.getByText('4418 2290 7731')).toBeVisible();
    await expect(page.getByText('Released to you')).toBeVisible();

    await expect(page.getByText('₹58,400')).toBeVisible(); // agreed freight
    await expect(page.getByText('−₹23,360')).toBeVisible(); // advance paid
    await expect(page.getByText('₹35,040')).toBeVisible(); // balance on POD

    await assertNoRedactedFields(page);
  });

  /**
   * The printable copy, and the link that reaches it.
   *
   * This exists because the button here used to be
   * `<a href={lr.pdfUrl} target="_blank">Download PDF to print</a>` while
   * `pdfUrl` was `'#'` in the fixture and `null` from the real API — no PDF
   * was generated anywhere. Clicking it opened a blank tab. Nothing caught
   * that, because no test ever followed the link: the page rendered, the
   * button was present, and the one thing it was for did nothing.
   *
   * So this asserts the destination, not the presence of a control.
   */
  test('the printable copy opens from the lorry receipt and carries the LR', async ({ page }) => {
    await page.goto('/trips/TR-20881/lorry-receipt');

    await page.getByRole('link', { name: 'Open the printable copy' }).click();
    await expect(page).toHaveURL(/\/print\/lr\/TR-20881$/, { timeout: 15_000 });

    // The document itself: number, route, vehicle and the transporter's own
    // freight — everything a checkpost or the receiving party asks for.
    await expect(page.getByText('NXR/LR/26/0884')).toBeVisible();
    await expect(page.getByText('Nashik → Kolkata')).toBeVisible();
    await expect(page.getByText('MH 15 GT 4482')).toBeVisible();
    await expect(page.getByText('₹58,400')).toBeVisible();

    // A ruled space for the signature the whole document exists to collect.
    await expect(page.getByText('Received the goods in good condition')).toBeVisible();

    // The print control is a real button, not a link to nowhere.
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();

    await assertNoRedactedFields(page);
  });

  /**
   * The same page inside the vendor app, where `window.print()` does not
   * exist — Android's WebView has no printing at all. The page hands its
   * HTML to the native side over the bridge instead, and `expo-print` opens
   * the OS print sheet.
   *
   * Stubbing the bridge is the only way to test this without a device, and
   * it is worth doing: the app path is precisely the one that was broken,
   * and a stub still pins the contract that matters — that a real, complete
   * document reaches native, carrying this trip's receipt and nothing from
   * the client's side of it.
   */
  test('inside the vendor app the print button hands the document to native', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.ReactNativeWebView = { postMessage: () => {} };
      w.NexraahNative = {
        print: (opts: { html: string; title: string }) => {
          (window as unknown as Record<string, unknown>).__printRequest = opts;
        },
      };
    });

    await page.goto('/print/lr/TR-20881');
    await page.getByRole('button', { name: 'Print or save as PDF' }).click();

    const sent = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__printRequest as
        { html: string; title: string } | undefined,
    );

    expect(sent, 'the page never reached the native bridge').toBeTruthy();
    expect(sent!.title).toBe('NXR/LR/26/0884');

    // A standalone document, not a fragment: expo-print renders it with no
    // stylesheet of its own, so the styles have to travel with it.
    expect(sent!.html).toContain('<!doctype html>');
    expect(sent!.html).toContain('<style>');
    expect(sent!.html).toContain('NXR/LR/26/0884');
    expect(sent!.html).toContain('MH 15 GT 4482');
    expect(sent!.html).toContain('Received the goods in good condition');

    // The redaction contract applies to what crosses the bridge too — this
    // document is printed and handed to the receiving party.
    //
    // Checked against the document's *rendered text*, not its markup. The
    // raw string carries the inline stylesheet, and a CSS `margin: 0` trips
    // the ` margin` term — a false positive that would have made this
    // assertion look like a leak on its first run. `assertNoRedactedFields`
    // reads `innerText` for the same reason.
    const rendered = await page.evaluate((html: string) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('style, script').forEach((el) => el.remove());
      return (doc.body.textContent ?? '').toLowerCase();
    }, sent!.html);

    for (const term of FORBIDDEN_TERMS) {
      expect(rendered, `redaction leak: found "${term}" in the printed document`).not.toContain(term);
    }
  });
});

test.describe('proof of delivery sub-page', () => {
  test('TR-20874 shows the rejection reason and the running penalty clock', async ({ page }) => {
    await page.goto('/trips/TR-20874/pod');

    await expect(page.getByText('Rejected — Consignee stamp missing on the reverse.')).toBeVisible();
    await expect(page.getByText('₹400 deducted so far — 4 days over')).toBeVisible();
    await expect(page.getByText('₹400 will be deducted from your balance of ₹18,720.')).toBeVisible();

    await assertNoRedactedFields(page);
  });

  test('the attach form is blocked until a file and a docket number are both present, then submits', async ({ page }) => {
    await page.goto('/trips/TR-20874/pod');

    const submit = page.getByRole('button', { name: 'Attach proof of delivery' });
    await expect(submit).toBeDisabled();
    await expect(page.getByText('Attach at least one page')).toBeVisible();

    await page
      .locator('#files')
      .setInputFiles({ name: 'pod.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fixture-pod-bytes') });

    await expect(submit).toBeDisabled();
    await expect(page.getByText('Courier docket number is required')).toBeVisible();

    await page.locator('#docket').fill('DOCKET-4471');
    await expect(submit).toBeEnabled();
    await expect(page.getByText('Attaching starts the branch queue, not the clock')).toBeVisible();

    await submit.click();
    await expect(page).toHaveURL(/\/trips\/TR-20874$/, { timeout: 15_000 });
  });

  test('TR-20881 (not yet delivered) shows no clock — the count has not started', async ({ page }) => {
    // The 20-day window starts at delivery. A trip with no `deliveredAt` must
    // never render a countdown — that used to default the elapsed days to 0
    // and tell the transporter their money was already on the clock before
    // the truck had even arrived.
    await page.goto('/trips/TR-20881/pod');

    await expect(page.getByText('The 20 days have not started yet')).toBeVisible();
    await expect(page.getByText('The count begins the day this load is delivered, not today.')).toBeVisible();
    await expect(page.getByText('20 days left in the window')).not.toBeVisible();
  });
});

test.describe('raise your bill sub-page', () => {
  test('TR-20881 (POD not approved) blocks billing and disables every field', async ({ page }) => {
    await page.goto('/trips/TR-20881/bill');

    await expect(page.getByText('Not yet submittable')).toBeVisible();
    await expect(page.getByText('✗ Trip delivered')).toBeVisible();
    await expect(page.getByText('✗ Proof of delivery approved')).toBeVisible();

    await expect(page.locator('#billNo')).toBeDisabled();
    await expect(page.locator('#billDate')).toBeDisabled();
    await expect(page.locator('#billFile')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Submit bill' })).toBeDisabled();
    await expect(page.getByText('Proof of delivery must be approved first')).toBeVisible();

    await expect(page.getByText('₹58,400')).toBeVisible(); // freight
    await expect(page.getByText('₹35,040')).toBeVisible(); // bill total = net payable

    // Not a redaction check here: this screen's own subhead intentionally
    // says "not our invoice to the client" (src/app/trips/[id]/bill/page.tsx)
    // to explain *whose* bill this is — a generic word, never a client name,
    // sell rate or other-vendor detail, so it is exempt from the sweep below.
  });

  test('TR-20860 (POD approved) is submittable and the submission reconciles against the computed total', async ({ page }) => {
    await page.goto('/trips/TR-20860/bill');

    await expect(page.getByText('Not yet submittable')).toHaveCount(0);
    await expect(page.getByText('₹22,650')).toBeVisible(); // freight
    await expect(page.getByText('₹0').first()).toBeVisible(); // agreed charges
    await expect(page.getByText('₹13,590')).toBeVisible(); // bill total

    const submit = page.getByRole('button', { name: 'Submit bill' });
    await expect(submit).toBeDisabled();

    await page.locator('#billNo').fill('RR/BILL/0091');
    await page
      .locator('#billFile')
      .setInputFiles({ name: 'bill.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture-bill-bytes') });

    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText('Bill RR/BILL/0091 received')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('We compute ₹13,590 against your ₹13,990.')).toBeVisible();
    await expect(page.getByText('Finance will review the ₹400 difference before releasing.')).toBeVisible();
  });
});

test.describe('redaction sweep (BR-55/NFR-02)', () => {
  test('no forbidden field appears on the trips list, any trip detail, or any sub-page', async ({ page }) => {
    // The bill sub-page is intentionally excluded: its own subhead reads
    // "not our invoice to the client" (src/app/trips/[id]/bill/page.tsx) —
    // a deliberate generic reference, not a leaked client name/rate, and
    // covered by its own tests in the "raise your bill sub-page" block above.
    const urls = [
      '/trips',
      '/trips/TR-20881',
      '/trips/TR-20874',
      '/trips/TR-20860',
      '/trips/TR-20881/pod',
      '/trips/TR-20874/pod',
      '/trips/TR-20881/lorry-receipt',
      // The printed copy leaves the building — it is carried in a cab and
      // handed to the receiving party — so it is the last place a client
      // rate or margin may appear.
      '/print/lr/TR-20881',
    ];
    for (const url of urls) {
      await page.goto(url);
      await assertNoRedactedFields(page);
    }
  });
});
