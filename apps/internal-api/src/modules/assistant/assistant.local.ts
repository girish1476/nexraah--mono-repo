import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { AssistantAnswer, AssistantSource } from './assistant.dto';
import type { LookupResult } from './assistant.tools';

/**
 * The assistant without a model — what Ask does when ANTHROPIC_API_KEY is not
 * set (the company runs on free services only).
 *
 * It reads the question for what it names — a truck number, an order or bill
 * number, or the subject (approvals, trucks on the road, what clients owe…) —
 * runs the one matching lookup from `AssistantTools` as the person asking,
 * with the same permission checks, and writes back what the records say, with
 * links to the screens. It cannot reason across lookups or answer a question
 * it has no rule for; it says so, and lists what it can answer.
 */

export interface Lookups {
  run(name: string, input: unknown, user: AuthenticatedUser): Promise<LookupResult>;
}

interface Rule {
  test: RegExp;
  lookup: string;
  title: string;
  input?: (question: string) => Record<string, unknown>;
}

const TRUCK = /\b([A-Z]{2})\s?-?(\d{1,2})\s?-?([A-Z]{0,3})\s?-?(\d{4})\b/i;
const BILL = /\b([A-Z]{2,5}-?INV-?\d{3,7}|INV-?\d{3,7})\b/i;
const NUMBER = /\b(\d{4,7})\b/;

/** Words that carry no name: what is left after them is taken as the client's or transporter's name. */
const FILLER =
  /\b(show|me|the|a|an|of|for|about|find|search|who|is|are|what|which|how|many|much|details|detail|info|information|client|clients|customer|customers|transporter|transporters|vendor|vendors|please|tell|list|all|our|do|we|have|with|named|called)\b/gi;
const nameIn = (q: string) => q.replace(/[?.!,]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();

const RULES: Rule[] = [
  { test: /\b(today|my desk|my work|pending work|need(s)? me|to do)\b/i, lookup: 'get_todays_work', title: 'Waiting on your desk' },
  { test: /\b(snapshot|summary|overview|how are we doing|this month)\b/i, lookup: 'get_business_snapshot', title: 'Business snapshot' },
  { test: /\b(on the road|in transit|moving|running|where are the trucks)\b/i, lookup: 'list_trucks_on_the_road', title: 'Trucks on the road' },
  { test: /\bapprovals?\b/i, lookup: 'list_approvals', title: 'Approvals' },
  { test: /\btickets?\b|\bproblems? reported\b/i, lookup: 'list_tickets', title: 'Tickets' },
  { test: /\b(receivables?|outstanding|owe|owes|owed|unpaid|overdue)\b/i, lookup: 'list_receivables', title: 'Money clients owe' },
  { test: /\bpods?\b|delivery proof|proof of delivery/i, lookup: 'list_pod_pending', title: 'Delivery proofs still out' },
  { test: /\badvances?\b/i, lookup: 'list_advance_payments', title: 'Advance payments' },
  { test: /\b(final|balance) payments?\b|\bbalances?\b/i, lookup: 'list_final_payments', title: 'Final payments' },
  { test: /\b(verif\w*|kyc)\b/i, lookup: 'list_verification_queue', title: 'Waiting for verification' },
  { test: /\bsdr\b|\bshortage\b|\bdamage\b/i, lookup: 'list_sdr_records', title: 'Shortage and damage' },
  { test: /\b(profit|margin|p\s*&\s*l|pnl)\b/i, lookup: 'get_profit_and_loss', title: 'Profit and loss' },
  { test: /\btargets?\b/i, lookup: 'get_my_targets', title: 'Targets' },
  { test: /\b(rate requests?|rfqs?|quote requests?)\b/i, lookup: 'search_rate_requests', title: 'Rate requests' },
  {
    test: /\b(no|without( a)?|not yet( a)?) (transporter|vendor|truck)\b|\b(unassigned|not placed|unplaced)\b/i,
    lookup: 'search_load_requests',
    title: 'Load requests with no transporter yet',
    input: () => ({ stage: 'OPEN' }),
  },
  { test: /\b(invoices?|bills?)\b/i, lookup: 'search_client_bills', title: 'Client bills' },
  { test: /\b(load requests?|indents?)\b/i, lookup: 'search_load_requests', title: 'Load requests' },
  { test: /\b(transporters?|vendors?)\b/i, lookup: 'search_transporters', title: 'Transporters', input: (q) => (nameIn(q) ? { query: nameIn(q) } : {}) },
  { test: /\b(clients?|customers?)\b/i, lookup: 'search_clients', title: 'Clients', input: (q) => (nameIn(q) ? { query: nameIn(q) } : {}) },
  { test: /\b(orders?|loads?|trips?)\b/i, lookup: 'search_orders', title: 'Orders', input: () => ({ openOnly: true }) },
];

const CAN_ANSWER = [
  'a truck number — "where is MH12QR8841"',
  'an order, trip or bill number — "order 4440", "NEX-INV-000411"',
  'what is waiting on your desk today',
  'trucks on the road · approvals · tickets',
  'what clients owe · advance and final payments · delivery proofs still out',
  'a client or transporter by name — "client Berger Paints"',
  'profit and loss · targets · the business snapshot',
];

const help = (lead: string): AssistantAnswer => ({
  answer: `${lead}\n\nI can answer about:\n${CAN_ANSWER.map((c) => `• ${c}`).join('\n')}`,
  sources: [],
});

/** Which lookup a question asks for, with its input, or null. */
export function ruleFor(question: string): { lookup: string; title: string; input: Record<string, unknown> } | null {
  const truck = question.match(TRUCK);
  if (truck) {
    const plate = `${truck[1]}${truck[2]}${truck[3]}${truck[4]}`.toUpperCase();
    return { lookup: 'search_orders', title: `Truck ${plate}`, input: { truck: plate } };
  }
  const bill = question.match(BILL);
  if (bill) return { lookup: 'search_client_bills', title: `Bill ${bill[1].toUpperCase()}`, input: { query: bill[1].toUpperCase() } };
  const number = question.match(NUMBER);
  if (number && !/\b(20\d\d)\b/.test(number[1])) {
    return { lookup: 'search_orders', title: `Number ${number[1]}`, input: { query: number[1] } };
  }
  const rule = RULES.find((r) => r.test.test(question));
  return rule ? { lookup: rule.lookup, title: rule.title, input: rule.input?.(question) ?? {} } : null;
}

/* ---- writing the records back in words ------------------------------------------ */

const words = (key: string) =>
  key
    .replace(/Rupees$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();

function value(key: string, v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && key.endsWith('Rupees')) return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return null;
}

const ID_KEYS = ['indentCode', 'invoiceCode', 'tripCode', 'code', 'period'];
const NAME_KEYS = ['legalName', 'name', 'clientName', 'title', 'vehicleNo'];
const DETAIL_KEYS = [
  'clientName', 'vendorName', 'transporterName', 'lane', 'route', 'fromCity', 'toCity', 'vehicleNo', 'status', 'stage',
  'statusLabel', 'stepLabel', 'totalRupees', 'outstandingRupees', 'stillOwedRupees', 'amountRupees', 'netRupees',
  'revenueRupees', 'costRupees', 'marginRupees',
  'dueDate', 'pickupDate', 'lastPingAt', 'city', 'baseCity', 'billingCity',
];

function line(row: Record<string, unknown>): string {
  const idKey = ID_KEYS.find((k) => value(k, row[k]));
  const nameKey = NAME_KEYS.find((k) => value(k, row[k]));
  const head = [idKey, nameKey].filter((k): k is string => !!k).map((k) => value(k, row[k]));
  const details = DETAIL_KEYS.filter((k) => k !== nameKey && k !== idKey)
    .map((k) => {
      const v = value(k, row[k]);
      return v ? (k.endsWith('Rupees') || /Date|At$/.test(k) ? `${words(k)} ${v}` : v) : null;
    })
    .filter((v): v is string => !!v)
    .slice(0, 5);
  const known = [...head, ...details].filter(Boolean);
  if (known.length) return known.join(' · ');
  // A row of a shape the rules above do not know (a P&L period, a target): its first few facts.
  return Object.entries(row)
    .map(([k, v]) => {
      const shown = value(k, v);
      return shown ? `${words(k)} ${shown}` : null;
    })
    .filter(Boolean)
    .slice(0, 5)
    .join(' · ');
}

/** What one lookup returned, in a few lines. */
export function describe(data: unknown): string {
  if (Array.isArray(data)) return describe({ total: data.length, shown: data.length, rows: data });
  if (!data || typeof data !== 'object') return String(data ?? 'Nothing found.');
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.rows)) {
    const rows = o.rows as Record<string, unknown>[];
    const total = typeof o.total === 'number' ? o.total : rows.length;
    if (total === 0) return 'Nothing found.';
    const lines = rows.slice(0, 6).map((r) => `• ${line(r)}`);
    const more = total > lines.length ? `\n…and ${total - lines.length} more — open the screen for all of them.` : '';
    return `${total} found:\n${lines.join('\n')}${more}`;
  }
  const facts = Object.entries(o)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${words(k)}: ${v.length}`;
      const shown = value(k, v);
      return shown ? `${words(k)}: ${shown}` : null;
    })
    .filter((f): f is string => !!f)
    .slice(0, 12);
  return facts.length ? facts.map((f) => `• ${f}`).join('\n') : 'Nothing found.';
}

/** Answers the last question of a conversation from the records, without a model. */
export async function answerWithoutModel(question: string, user: AuthenticatedUser, lookups: Lookups): Promise<AssistantAnswer> {
  const q = question.trim();
  const first = user.name.split(/\s+/).find((w) => w.replace(/\./g, '').length > 1) ?? user.name;
  if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/i.test(q)) {
    return help(`Hello ${first}. Ask me about the loads, trucks, bills and payments in the console.`);
  }
  if (/^(thanks|thank you|ok|okay|great)\b/i.test(q)) return { answer: 'You are welcome.', sources: [] };
  if (/\b(help|what can you)\b/i.test(q)) return help('I read the records in the console and tell you what they say.');

  const rule = ruleFor(q);
  if (!rule) return help('I could not tell which records that is about.');
  let result: LookupResult;
  try {
    result = await lookups.run(rule.lookup, rule.input, user);
  } catch (e) {
    const message = (e as Error).message;
    if (/does not have access/i.test(message)) {
      return { answer: `${rule.title}: that is on a screen your role does not open, so I cannot read it for you.`, sources: [] };
    }
    return { answer: `${rule.title}: the records could not be read just now. Try again in a minute.`, sources: [] };
  }
  const sources: AssistantSource[] = result.sources.slice(0, 5);
  return { answer: `${rule.title}\n${describe(result.data)}`, sources };
}
