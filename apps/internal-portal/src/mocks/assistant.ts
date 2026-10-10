/**
 * A stand-in for the assistant, for use until the real one is switched on.
 *
 * The real assistant (internal-api's `modules/assistant`) hands the question
 * to an outside language model, which looks records up through the server.
 * None of that exists while the console runs on the records kept in the
 * browser — so the corner button answered every question with "not available".
 *
 * This answers the questions people actually ask it, without a model: it looks
 * for what the question is about (a truck number, an order number, payments,
 * approvals, …), reads the answer straight off the records in this browser,
 * and names the screen to check it on. It understands a fixed list of
 * subjects and says so when a question is outside it, rather than guessing.
 *
 * It only reads. Nothing here changes a record.
 */

export interface AssistantReply {
  answer: string;
  sources: { label: string; href: string }[];
}

interface Records {
  db: Record<string, any>;
  /** What still holds an advance or a final payment back — empty when it can be released. */
  advanceUnmet: (trip: any) => { label: string }[];
  balanceUnmet: (trip: any) => { label: string }[];
  /** The step an order has reached, in the console's own codes. */
  orderStatus: (indent: any, trip: any) => string;
}

const STEP: Record<string, string> = {
  INDENT_CREATED: 'Load requested — no truck booked yet',
  TRIP_GENERATED: 'Vehicle booked',
  LR_ISSUED: 'Lorry receipt issued',
  ADVANCE_DOCS_UPLOADED: 'Advance papers in',
  ADVANCE_PAID: 'Advance paid',
  TRACKING: 'On the road',
  UNLOADED: 'Unloaded',
  POD_UPLOADED: 'Delivery proof in, waiting to be checked',
  POD_VERIFIED: 'Delivery proof checked',
  BALANCE_RELEASED: 'Final payment released — complete',
  FAILED: 'Could not be placed',
  CANCELLED: 'Cancelled',
  POD_FORFEITED: 'Balance forfeited',
};

const rupees = (paise: number) => `₹${Math.round((paise ?? 0) / 100).toLocaleString('en-IN')}`;
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const squash = (s: unknown) => String(s ?? '').replace(/[\s-]/g, '').toUpperCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** At most `max` lines, then how many more there are — an answer is a pointer, not a report. */
const listed = (lines: string[], max = 6) =>
  [...lines.slice(0, max).map((l) => `• ${l}`), ...(lines.length > max ? [`…and ${lines.length - max} more.`] : [])].join('\n');
const route = (i: any) => `${i.fromCity ?? '?'} → ${i.toCity ?? '?'}`;

const HOW_TO: { match: RegExp; answer: string; source: { label: string; href: string } }[] = [
  {
    match: /(truck|vehicle).*(number|no\b).*(wrong|correct|change|fix)|(wrong|correct|change|fix).*(truck|vehicle) (number|no\b)/,
    answer:
      'Open the order, and beside the truck number at the top press “Correct”. Type the right number and why. It is put right on the load, the trip and the lorry receipt together. This is offered until the truck is unloaded; after that, raise a ticket.',
    source: { label: 'All orders', href: '/orders' },
  },
  {
    match: /(raise|create|add|new|book).*(load|indent|order)/,
    answer:
      'Go to Orders → All orders and press “New load request”. Choose the client, the route, the truck type and the pickup date. The client must already be cleared by Compliance.',
    source: { label: 'All orders', href: '/orders' },
  },
  {
    match: /(add|allow|create|new).*(user|person|email|staff|login)/,
    answer:
      'Go to Control → Allowed emails and press “Allow an email”. Give the email, mobile number, role and branch. They sign in with a code sent to that email.',
    source: { label: 'Allowed emails', href: '/admin/users' },
  },
  {
    match: /(release|pay).*(advance|balance|final|payment)/,
    answer:
      'Payments are released from Payments → Advance payments and Payments → Final payments. Open the trip there; the Release button switches on once every item listed under it is cleared.',
    source: { label: 'Advance payments', href: '/payments/advance' },
  },
  {
    match: /(raise|create|make|new).*(invoice|bill)/,
    answer:
      'Open the order and use “Raise the client invoice” in its Next step, or go to Payments → Invoices and press New invoice. Choose the client and the delivered loads to bill.',
    source: { label: 'Invoices', href: '/invoices' },
  },
  {
    match: /(add|new|onboard|create).*(client|customer)/,
    answer:
      'Go to Clients → Clients and press “New client”. Fill in the company, billing address and agreement. The client then waits for Compliance under Client verification before loads can be raised.',
    source: { label: 'Clients', href: '/clients' },
  },
  {
    match: /(add|new|onboard|create).*(transporter|vendor)/,
    answer:
      'Go to Supply → Transporters and press “Add a transporter”. Fill in their details and upload their papers; Compliance then verifies them before they can be given loads.',
    source: { label: 'Transporters', href: '/vendors' },
  },
  {
    match: /report.*(problem|issue|wrong)|raise.*ticket/,
    answer:
      'Press “Report a problem” at the foot of any screen. Give it a title and say what is wrong. Reports are listed under Control → Tickets.',
    source: { label: 'Tickets', href: '/tickets' },
  },
];

const CAN_ANSWER =
  'I can answer from the records about:\n' +
  '• a truck — “Where is truck AP39EW3699?”\n' +
  '• an order — “What is the status of order 1004?”\n' +
  '• loads waiting for a truck, or on the road\n' +
  '• advance and final payments ready to release\n' +
  '• approvals waiting, open tickets\n' +
  '• unpaid invoices and what clients owe\n' +
  '• delivery proofs still pending\n' +
  '• transporters and clients waiting for Compliance\n' +
  '• how to do something — “How do I correct a truck number?”';

export function answerLocally(question: string, r: Records): AssistantReply {
  const q = question.toLowerCase().trim();
  const { db } = r;
  const indents: any[] = db.indents ?? [];
  const trips: any[] = db.trips ?? [];
  const tripOf = (indent: any) => trips.find((t) => t.indentId === indent.id || t.indentCode === indent.code) ?? null;
  const orderLine = (i: any) => `${i.code} · ${i.clientName ?? '—'} · ${route(i)}`;

  // ---- how to do something -------------------------------------------------
  if (/^(how|where) (do|can|to|should)|how to\b/.test(q)) {
    const hit = HOW_TO.find((h) => h.match.test(q));
    if (hit) return { answer: hit.answer, sources: [hit.source] };
  }

  // ---- one truck -----------------------------------------------------------
  const truck = question.toUpperCase().match(/\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{3,4}\b/);
  if (truck) {
    const wanted = squash(truck[0]);
    const trip = [...trips].reverse().find((t) => squash(t.vehicleNo) === wanted);
    if (!trip) {
      return {
        answer: `I cannot find truck ${truck[0]} on any trip in this console. Check the number, or look it up on All orders.`,
        sources: [{ label: 'All orders', href: '/orders' }],
      };
    }
    const indent = indents.find((i) => i.id === trip.indentId || i.code === trip.indentCode);
    const last = [...(db.tripTracking ?? [])].reverse().find((u: any) => u.tripId === trip.id && String(u.location ?? '').trim());
    const status = indent ? (STEP[r.orderStatus(indent, trip)] ?? '') : '';
    return {
      answer:
        `Truck ${trip.vehicleNo} is on trip ${trip.code} — ${trip.lane ?? (indent ? route(indent) : '')} for ${trip.clientName ?? '—'}.\n` +
        (status ? `Status: ${status}.\n` : '') +
        (last
          ? `Last reported at ${last.location} on ${when(last.recordedAt)}${last.recordedByName ? ` by ${last.recordedByName}` : ''}.${last.note ? `\nNote: ${last.note}` : ''}`
          : 'Nothing has been entered on its tracking sheet yet.'),
      sources: [{ label: `Order ${trip.indentCode ?? trip.code}`, href: `/orders/${trip.indentId ?? ''}` }],
    };
  }

  // ---- one order, by its number ---------------------------------------------
  const number = q.match(/\b\d{4,6}\b/);
  if (number && /(order|indent|load|trip|status|where|stage)/.test(q)) {
    const indent = indents.find((i) => String(i.code) === number[0]) ?? indents.find((i) => String(tripOf(i)?.code) === number[0]);
    if (indent) {
      const trip = tripOf(indent);
      return {
        answer:
          `Order ${indent.code} — ${indent.clientName ?? '—'}, ${route(indent)}, pickup ${indent.pickupDate ?? '—'}.\n` +
          `Status: ${STEP[r.orderStatus(indent, trip)] ?? 'unknown'}.\n` +
          (trip
            ? `Trip ${trip.code}${trip.vehicleNo ? ` · truck ${trip.vehicleNo}` : ' · no truck allocated yet'}${trip.vendorName ? ` · ${trip.vendorName}` : ''}.`
            : 'No trip has been generated yet.'),
        sources: [{ label: `Order ${indent.code}`, href: `/orders/${indent.id}` }],
      };
    }
    return {
      answer: `I cannot find an order or trip numbered ${number[0]} in this console.`,
      sources: [{ label: 'All orders', href: '/orders' }],
    };
  }

  // ---- loads waiting for a truck ---------------------------------------------
  if (/(wait|need|without|no|not).{0,25}(truck|vehicle|transporter|placed|assign|allocat)|unassigned|pending allocation/.test(q)) {
    const waiting = indents.filter((i) => {
      const s = r.orderStatus(i, tripOf(i));
      return s === 'INDENT_CREATED' || (s === 'TRIP_GENERATED' && !tripOf(i)?.vehicleNo);
    });
    return {
      answer: waiting.length
        ? `${plural(waiting.length, 'load is', 'loads are')} still waiting for a truck:\n${listed(waiting.map((i) => `${orderLine(i)} · pickup ${i.pickupDate ?? '—'}`))}`
        : 'No load is waiting for a truck right now.',
      sources: [{ label: 'All orders', href: '/orders' }],
    };
  }

  // ---- on the road -----------------------------------------------------------
  if (/(on the road|in transit|running|moving|en route)/.test(q)) {
    const moving = trips.filter((t) => t.stage === 'IN_TRANSIT');
    return {
      answer: moving.length
        ? `${plural(moving.length, 'truck is', 'trucks are')} on the road:\n${listed(moving.map((t) => `${t.vehicleNo || 'truck not entered'} · trip ${t.code} · ${t.lane ?? ''} · ${t.clientName ?? ''}`))}`
        : 'No truck is on the road right now.',
      sources: [{ label: 'All orders', href: '/orders' }],
    };
  }

  // ---- payments ----------------------------------------------------------------
  if (/(final|balance).{0,20}(pay|release)|(pay|release).{0,20}(final|balance)|\bbalance\b/.test(q)) {
    const due = trips.filter((t) => t.deliveredAt && !(t.balancePaidPaise > 0) && t.stage !== 'CANCELLED');
    const ready = due.filter((t) => r.balanceUnmet(t).length === 0);
    const held = due.filter((t) => r.balanceUnmet(t).length > 0);
    return {
      answer:
        (ready.length
          ? `${plural(ready.length, 'final payment is', 'final payments are')} ready to release:\n${listed(ready.map((t) => `Trip ${t.code} · ${t.vendorName ?? '—'} · ${t.lane ?? ''}`))}`
          : 'No final payment is ready to release right now.') +
        (held.length
          ? `\n\n${plural(held.length, 'more is', 'more are')} held:\n${listed(held.map((t) => `Trip ${t.code} — ${r.balanceUnmet(t)[0]?.label ?? 'held'}`), 4)}`
          : ''),
      sources: [{ label: 'Final payments', href: '/payments/balance' }],
    };
  }
  if (/advance/.test(q)) {
    const due = trips.filter((t) => (t.buyRatePaise ?? 0) > 0 && !(t.advancePaidPaise > 0) && !t.deliveredAt && t.stage !== 'CANCELLED');
    const ready = due.filter((t) => r.advanceUnmet(t).length === 0);
    const held = due.filter((t) => r.advanceUnmet(t).length > 0);
    return {
      answer:
        (ready.length
          ? `${plural(ready.length, 'advance is', 'advances are')} ready to release:\n${listed(ready.map((t) => `Trip ${t.code} · ${t.vendorName ?? '—'}`))}`
          : 'No advance is ready to release right now.') +
        (held.length
          ? `\n\n${plural(held.length, 'more is', 'more are')} held until papers are in:\n${listed(held.map((t) => `Trip ${t.code} — ${plural(r.advanceUnmet(t).length, 'item')} missing`), 4)}`
          : ''),
      sources: [{ label: 'Advance payments', href: '/payments/advance' }],
    };
  }

  // ---- approvals and tickets -------------------------------------------------
  if (/approv|sign.?off|waiting on (me|a decision)/.test(q)) {
    const pending = (db.approvals ?? []).filter((a: any) => a.status === 'PENDING');
    return {
      answer: pending.length
        ? `${plural(pending.length, 'approval is', 'approvals are')} waiting:\n${listed(pending.map((a: any) => `${a.title ?? a.kind} — raised by ${a.requesterName ?? '—'}`))}`
        : 'Nothing is waiting for approval.',
      sources: [{ label: 'Approvals', href: '/admin/approvals' }],
    };
  }
  if (/ticket|reported problem|open issue/.test(q)) {
    const open = (db.tickets ?? []).filter((t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
    return {
      answer: open.length
        ? `${plural(open.length, 'ticket is', 'tickets are')} open:\n${listed(open.map((t: any) => `${t.code ?? ''} · ${t.subject ?? ''}${t.severity === 'BLOCKING' ? ' · blocking' : ''}`))}`
        : 'No ticket is open.',
      sources: [{ label: 'Tickets', href: '/tickets' }],
    };
  }

  // ---- money owed by clients ---------------------------------------------------
  if (/invoice|owe|receivable|unpaid|outstanding|collect/.test(q)) {
    const unpaid = (db.invoices ?? []).filter(
      (i: any) => i.code && i.status !== 'CANCELLED' && (i.totalPaise ?? 0) - (i.receivedPaise ?? 0) > 0,
    );
    const total = unpaid.reduce((a: number, i: any) => a + (i.totalPaise ?? 0) - (i.receivedPaise ?? 0), 0);
    return {
      answer: unpaid.length
        ? `Clients owe ${rupees(total)} across ${plural(unpaid.length, 'unpaid invoice')}:\n${listed(unpaid.map((i: any) => `${i.code} · ${i.clientName ?? '—'} · ${rupees((i.totalPaise ?? 0) - (i.receivedPaise ?? 0))} due ${i.dueDate ?? ''}`))}`
        : 'No invoice is unpaid.',
      sources: [{ label: 'Receivables', href: '/receivables' }],
    };
  }

  // ---- delivery proofs -----------------------------------------------------------
  if (/\bpod\b|proof of delivery|delivery proof/.test(q)) {
    const pending = trips.filter((t) => t.deliveredAt && !['APPROVED', 'WAIVED'].includes(t.podStatus));
    return {
      answer: pending.length
        ? `${plural(pending.length, 'delivered trip is', 'delivered trips are')} still waiting on a delivery proof:\n${listed(pending.map((t) => `Trip ${t.code} · ${t.vendorName ?? '—'} · proof ${String(t.podStatus ?? 'pending').toLowerCase()}`))}`
        : 'Every delivered trip has its delivery proof approved.',
      sources: [{ label: 'Check POD status', href: '/pod/pending' }],
    };
  }

  // ---- transporters and clients ---------------------------------------------------
  if (/transporter|vendor|supplier/.test(q)) {
    const all: any[] = db.vendors ?? [];
    const waiting = all.filter((v) => v.status === 'PENDING_VERIFICATION');
    return {
      answer:
        `${plural(all.length, 'transporter')} on file — ${all.filter((v) => v.status === 'ACTIVE').length} cleared for loads, ${waiting.length} waiting for Compliance, ${all.filter((v) => v.status === 'SUSPENDED').length} on hold.` +
        (waiting.length ? `\nWaiting for Compliance:\n${listed(waiting.map((v) => `${v.legalName} · ${v.code}`))}` : ''),
      sources: [{ label: 'Transporters', href: '/vendors' }],
    };
  }
  if (/client|customer/.test(q)) {
    const all: any[] = db.clients ?? [];
    const waiting = all.filter((c) => c.status === 'PENDING_VERIFICATION' || c.status === 'DRAFT');
    return {
      answer:
        `${plural(all.length, 'client')} on file — ${all.filter((c) => c.status === 'ACTIVE').length} cleared for work, ${waiting.length} not yet cleared.` +
        (waiting.length ? `\nNot yet cleared:\n${listed(waiting.map((c) => `${c.name} · ${c.code}`))}` : ''),
      sources: [{ label: 'Client verification', href: '/clients/onboarding' }],
    };
  }

  // ---- how things stand ---------------------------------------------------------------
  if (/summary|overview|today|status|how (are|is) (we|things|it)|what.?s (pending|happening)/.test(q)) {
    const open = indents.filter((i) => !['BALANCE_RELEASED', 'CANCELLED', 'FAILED', 'POD_FORFEITED'].includes(r.orderStatus(i, tripOf(i))));
    return {
      answer:
        `Right now: ${plural(open.length, 'load')} in progress, ` +
        `${trips.filter((t) => t.stage === 'IN_TRANSIT').length} on the road, ` +
        `${plural((db.approvals ?? []).filter((a: any) => a.status === 'PENDING').length, 'approval')} waiting, ` +
        `${plural((db.tickets ?? []).filter((t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length, 'ticket')} open.`,
      sources: [
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'All orders', href: '/orders' },
      ],
    };
  }

  // A how-to that did not start with "how", then give up honestly.
  const hit = HOW_TO.find((h) => h.match.test(q));
  if (hit) return { answer: hit.answer, sources: [hit.source] };
  return { answer: `I could not work out what that is about. ${CAN_ANSWER}`, sources: [] };
}
