/**
 * What each notification says — pure, so it is tested without a database.
 *
 * Part 11 §4 lists the events. Each one is rendered once, when it is raised,
 * into a subject (email), a title and a short body (push, and the email's first
 * line), a link into the right screen, and the values an SMS template needs.
 * The words are the company's to change; the shape is fixed.
 */

export type NotificationEvent =
  | 'quote.awarded'
  | 'payment.released'
  | 'pod.due'
  | 'pod.breached'
  | 'pod.forfeit_warning'
  | 'pod.rejected'
  | 'bill.queried'
  | 'vendor.activated'
  | 'approval.raised'
  | 'approval.decided';

/** Who an event is for: a transporter (on the portal) or staff (on the console). */
export const AUDIENCE: Record<NotificationEvent, 'VENDOR' | 'STAFF'> = {
  'quote.awarded': 'VENDOR',
  'payment.released': 'VENDOR',
  'pod.due': 'VENDOR',
  'pod.breached': 'VENDOR',
  'pod.forfeit_warning': 'VENDOR',
  'pod.rejected': 'VENDOR',
  'bill.queried': 'VENDOR',
  'vendor.activated': 'VENDOR',
  'approval.raised': 'STAFF',
  'approval.decided': 'STAFF',
};

export interface Rendered {
  subject: string;
  title: string;
  body: string;
  /** A path on the portal (VENDOR) or the console (STAFF); the sender puts the site in front. */
  path: string;
  /** Short values for an SMS template, in the order its placeholders take them. */
  sms: string[];
}

const rupees = (paise: unknown) => `₹${Math.round(Number(paise ?? 0) / 100).toLocaleString('en-IN')}`;
const text = (v: unknown, fallback = '—') => {
  const s = String(v ?? '').trim();
  return s || fallback;
};
const day = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? text(v) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

type Data = Record<string, unknown>;

const RENDER: Record<NotificationEvent, (d: Data) => Rendered> = {
  'quote.awarded': (d) => ({
    subject: `Load ${text(d.loadCode)} is yours — ${text(d.route)}`,
    title: `Load ${text(d.loadCode)} awarded to you`,
    body: `${text(d.route)} at ${rupees(d.amountPaise)}. Pickup ${day(d.pickupDate)}. Confirm the truck and driver on the portal.`,
    path: d.tripId ? `/trips/${d.tripId}` : '/trips',
    sms: [text(d.loadCode), text(d.route), rupees(d.amountPaise), day(d.pickupDate)],
  }),
  'payment.released': (d) => ({
    subject: `${d.kind === 'BALANCE' ? 'Balance' : 'Advance'} of ${rupees(d.amountPaise)} paid — trip ${text(d.tripCode)}`,
    title: `${d.kind === 'BALANCE' ? 'Balance' : 'Advance'} paid: ${rupees(d.amountPaise)}`,
    body: `Trip ${text(d.tripCode)}. UTR ${text(d.utr)}, value date ${day(d.valueDate)}.`,
    path: d.tripId ? `/trips/${d.tripId}` : '/trips',
    sms: [d.kind === 'BALANCE' ? 'Balance' : 'Advance', rupees(d.amountPaise), text(d.tripCode), text(d.utr)],
  }),
  'pod.due': (d) => ({
    subject: `Proof of delivery due for trip ${text(d.tripCode)}`,
    title: `POD due by ${day(d.dueOn)}`,
    body: `Trip ${text(d.tripCode)} (${text(d.route)}) was delivered on ${day(d.deliveredOn)}. Upload the proof of delivery by ${day(d.dueOn)} to avoid a penalty.`,
    path: d.tripId ? `/trips/${d.tripId}/pod` : '/trips',
    sms: [text(d.tripCode), day(d.dueOn)],
  }),
  'pod.breached': (d) => ({
    subject: `Proof of delivery overdue for trip ${text(d.tripCode)}`,
    title: `POD overdue — ${text(d.daysLate)} days`,
    body: `Trip ${text(d.tripCode)}: the proof of delivery was due on ${day(d.dueOn)}. A penalty is now coming off the balance each day until it is received.`,
    path: d.tripId ? `/trips/${d.tripId}/pod` : '/trips',
    sms: [text(d.tripCode), text(d.daysLate)],
  }),
  'pod.forfeit_warning': (d) => ({
    subject: `Balance for trip ${text(d.tripCode)} at risk`,
    title: `Balance forfeited on ${day(d.forfeitOn)} without POD`,
    body: `Trip ${text(d.tripCode)}: without the proof of delivery by ${day(d.forfeitOn)}, the balance payment is forfeited.`,
    path: d.tripId ? `/trips/${d.tripId}/pod` : '/trips',
    sms: [text(d.tripCode), day(d.forfeitOn)],
  }),
  'pod.rejected': (d) => ({
    subject: `Proof of delivery not accepted — trip ${text(d.tripCode)}`,
    title: `POD not accepted: trip ${text(d.tripCode)}`,
    body: `Reason: ${text(d.reason)}. Upload it again on the portal.`,
    path: d.tripId ? `/trips/${d.tripId}/pod` : '/trips',
    sms: [text(d.tripCode), text(d.reason).slice(0, 30)],
  }),
  'bill.queried': (d) => ({
    subject: `Question on your bill for trip ${text(d.tripCode)}`,
    title: `Bill queried: trip ${text(d.tripCode)}`,
    body: `Finance asked: ${text(d.note)}`,
    path: d.tripId ? `/trips/${d.tripId}/bill` : '/trips',
    sms: [text(d.tripCode)],
  }),
  'vendor.activated': (d) => ({
    subject: `${text(d.vendorName, 'Your company')} is cleared to carry loads`,
    title: 'You are cleared to carry loads',
    body: `${text(d.vendorName, 'Your company')} can now see loads and quote on the transporter portal.`,
    path: '/loads',
    sms: [text(d.vendorName, 'Transporter')],
  }),
  'approval.raised': (d) => ({
    subject: `Waiting for your approval: ${text(d.title)}`,
    title: 'Approval waiting',
    body: `${text(d.title)} — asked by ${text(d.requesterName)}. ${text(d.detail, '')}`.trim(),
    path: '/admin/approvals',
    sms: [text(d.title).slice(0, 30)],
  }),
  'approval.decided': (d) => ({
    subject: `${d.decision === 'APPROVED' ? 'Approved' : 'Turned down'}: ${text(d.title)}`,
    title: d.decision === 'APPROVED' ? 'Your request was approved' : 'Your request was turned down',
    body: `${text(d.title)} — by ${text(d.deciderName)}.${d.note ? ` Note: ${text(d.note)}` : ''}`,
    path: '/admin/approvals',
    sms: [text(d.title).slice(0, 30), d.decision === 'APPROVED' ? 'approved' : 'turned down'],
  }),
};

export function renderEvent(event: NotificationEvent, data: Data): Rendered {
  return RENDER[event](data);
}

export const EVENTS = Object.keys(RENDER) as NotificationEvent[];
