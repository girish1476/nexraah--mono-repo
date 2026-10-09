import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApprovalsService } from '../approvals/approvals.service';
import { ClientsService } from '../clients/clients.service';
import { ComplianceService } from '../compliance/compliance.service';
import { IndentsService } from '../indents/indents.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { PnlService } from '../pnl/pnl.service';
import { PodService } from '../pod/pod.service';
import { ReportsService } from '../reports/reports.service';
import { RfqService } from '../rfq/rfq.service';
import { SdrService } from '../sdr/sdr.service';
import { TargetsService } from '../targets/targets.service';
import { TelematicsService } from '../telematics/telematics.service';
import { TicketsService } from '../tickets/tickets.service';
import { TripsService } from '../trips/trips.service';
import { VendorsService } from '../vendors/vendors.service';
import type { AssistantSource } from './assistant.dto';

/** What a lookup hands back: the records for the model to read, and the screens they came from. */
export interface LookupResult {
  data: unknown;
  sources: AssistantSource[];
}

interface Lookup {
  definition: Anthropic.Tool;
  /** The permission the matching screen asks for. Absent where the screen is open to every desk. */
  permission?: string;
  run(input: Record<string, unknown>, user: AuthenticatedUser): Promise<LookupResult>;
}

/** The most rows of any list handed to the model. The screen has the rest. */
const MAX_ROWS = 25;

/**
 * Never handed to the model, whichever lookup they turn up in: identity and
 * bank details, and internal file ids. An answer has no use for them, and they
 * are the details this system otherwise takes care to show to few people.
 */
const WITHHELD = new Set([
  'kyc',
  'pan',
  'valueMasked',
  'bankAccount',
  'ifsc',
  'accountHolder',
  'attachmentId',
  'attachmentIds',
  'courierSlipAttachmentId',
]);

/**
 * A record as the model reads it.
 *
 * Money is stored in paise; every `…Paise` field is handed over as `…Rupees`,
 * already divided, so the model never does that arithmetic — a slipped decimal
 * there is a hundredfold error in an amount somebody may pay on. Long lists are
 * cut to `MAX_ROWS`, and withheld fields are dropped.
 */
export function forModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, MAX_ROWS).map(forModel);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (WITHHELD.has(key)) continue;
    if (key.endsWith('Paise') && typeof v === 'number') out[`${key.slice(0, -5)}Rupees`] = v / 100;
    else out[key] = forModel(v);
  }
  return out;
}

/** A list for the model, with how many there were before it was cut. */
function listed(rows: unknown[], total: number = rows.length) {
  return { total, shown: Math.min(rows.length, MAX_ROWS), rows: forModel(rows) };
}

/** The same, for a lookup that may answer with a bare list or with an object that holds one. */
function anyList(value: unknown) {
  return Array.isArray(value) ? listed(value) : forModel(value);
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined;

/**
 * A lookup as the model sees it: only the fields named here, every one of them,
 * null where it has nothing.
 *
 * Not declared `strict`: the API caps how many strict tools one request may
 * carry, and there are more lookups here than that. Nothing rests on the
 * guarantee anyway — every `run` below reads its input through `text()` or
 * `String()`, so a missing or mistyped field is treated as not given.
 */
function tool(name: string, description: string, properties: Record<string, unknown>): Anthropic.Tool {
  return {
    name,
    description,
    input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

const optionalText = (description: string) => ({ type: ['string', 'null'], description });

/**
 * The assistant's lookups — every one of them a read, each calling the same
 * service method the matching screen calls, so an answer and the screen it
 * links to cannot disagree. There is deliberately nothing here that writes.
 */
@Injectable()
export class AssistantTools {
  private readonly lookups: Lookup[];

  constructor(
    orders: OrdersService,
    trips: TripsService,
    payments: PaymentsService,
    vendors: VendorsService,
    sdr: SdrService,
    pod: PodService,
    clients: ClientsService,
    indents: IndentsService,
    invoicing: InvoicingService,
    approvals: ApprovalsService,
    tickets: TicketsService,
    targets: TargetsService,
    reports: ReportsService,
    pnl: PnlService,
    rfqs: RfqService,
    compliance: ComplianceService,
    telematics: TelematicsService,
  ) {
    this.lookups = [
      // ---- clients and what they are charged ---------------------------------
      {
        definition: tool(
          'search_clients',
          'Find clients (the companies whose goods we move) by name, code, GST number or contact. Returns each with its status, city and id. Follow with get_client or get_client_rate_card.',
          { query: optionalText('Name, code, GSTIN or contact. Null lists them all.') },
        ),
        run: async (input) => ({
          data: anyList(await clients.list(text(input.query))),
          sources: [{ label: 'Clients', href: '/clients' }],
        }),
      },
      {
        definition: tool(
          'get_client',
          "One client's record: status, billing city, contact, engagement (spot or contract), agreement dates, credit days and what they need with each load. Needs the client id from search_clients.",
          { id: { type: 'string', description: 'The client id.' } },
        ),
        run: async (input) => {
          const id = String(input.id ?? '').trim();
          return { data: forModel(await clients.getById(id)), sources: [{ label: 'Client', href: `/clients/${id}` }] };
        },
      },
      {
        definition: tool(
          'get_client_rate_card',
          "A client's agreed rates: each route and truck type with its rate, whether it is per truck or per tonne, transit days, the dates it is in force, and the late-delivery penalty. A route that was revised appears twice — the closed old rate and the one in force now; the one whose dates cover today is the current rate. Needs the client id.",
          { id: { type: 'string', description: 'The client id.' } },
        ),
        run: async (input) => {
          const id = String(input.id ?? '').trim();
          return { data: anyList(await clients.rateCard(id)), sources: [{ label: 'Rate card', href: `/clients/${id}` }] };
        },
      },
      // ---- load requests ------------------------------------------------------
      {
        permission: 'indent.view',
        definition: tool(
          'search_load_requests',
          'Load requests (indents) by stage: what clients have asked us to move, with route, material, weight, truck type, pickup date, rate and how many quotes are in. Use for "which loads have no transporter / no truck yet". For where an awarded load has got to, use search_orders instead.',
          {
            stage: optionalText('OPEN (no transporter yet), VENDOR_ASSIGNED, VEHICLE_PLACED, TRIP_CREATED or CANCELLED. Null for all.'),
          },
        ),
        run: async (input) => ({
          data: anyList(await indents.list({ stage: text(input.stage), branchId: undefined, clientId: undefined })),
          sources: [{ label: 'Load requests', href: '/indents' }],
        }),
      },
      {
        permission: 'indent.view',
        definition: tool(
          'get_load_request',
          'One load request in full, including every quote transporters have sent for it and the price limits. Needs the load request id from search_load_requests or the indentId from an order.',
          { id: { type: 'string', description: 'The load request (indent) id.' } },
        ),
        run: async (input) => {
          const id = String(input.id ?? '').trim();
          return { data: forModel(await indents.getById(id)), sources: [{ label: 'Load request', href: `/indents/${id}` }] };
        },
      },
      // ---- billing the client -------------------------------------------------
      {
        definition: tool(
          'search_client_bills',
          'Client bills (invoices): number, client, date, due date, total, how much has been received, and status. Search by number or client, filter by status or date range.',
          {
            query: optionalText('Invoice number or client name.'),
            status: optionalText('DRAFT, ISSUED, PART_PAID, PAID or CANCELLED. Null for all.'),
            from: optionalText('Invoice date from, YYYY-MM-DD.'),
            to: optionalText('Invoice date to, YYYY-MM-DD.'),
          },
        ),
        run: async (input) => ({
          data: anyList(
            await invoicing.list({ q: text(input.query), status: text(input.status), from: text(input.from), to: text(input.to) }),
          ),
          sources: [{ label: 'Client bills', href: '/invoices' }],
        }),
      },
      {
        definition: tool(
          'get_client_bill',
          'One client bill in full: its trips, the charges on it, tax, and every receipt recorded against it. Needs the invoice id from search_client_bills or from an order.',
          { id: { type: 'string', description: 'The invoice id.' } },
        ),
        run: async (input) => {
          const id = String(input.id ?? '').trim();
          return { data: forModel(await invoicing.getById(id)), sources: [{ label: 'Client bill', href: `/invoices/${id}` }] };
        },
      },
      {
        definition: tool(
          'list_receivables',
          'What clients owe us: issued bills not yet fully paid, with how overdue each is, and totals by age. Use for "who has not paid", "how much is outstanding".',
          {},
        ),
        run: async () => ({
          data: forModel(await invoicing.receivables({ ageing: undefined, client: undefined })),
          sources: [{ label: 'Receivables', href: '/receivables' }],
        }),
      },
      // ---- decisions, problems, targets ----------------------------------------
      {
        definition: tool(
          'list_approvals',
          'Requests waiting for (or already given) sign-off: above-limit prices, advance changes, rate changes, new rate-card lanes, document overrides. Each says what was asked, by whom, why, and which permission decides it.',
          { status: optionalText('PENDING, APPROVED or REJECTED. Null means PENDING.') },
        ),
        run: async (input) => ({
          data: anyList(await approvals.list(text(input.status) ?? 'PENDING', undefined)),
          sources: [{ label: 'Approvals', href: '/admin/approvals' }],
        }),
      },
      {
        definition: tool(
          'list_tickets',
          'Problems reported from the console\'s screens (wrong or missing data): subject, detail, which screen, how urgent, status and what was done. People who cannot act on tickets see only their own.',
          { status: optionalText('OPEN, IN_PROGRESS, RESOLVED or WONT_FIX. Null for all.') },
        ),
        run: async (input, user) => ({
          data: forModel(
            await tickets.list({ status: text(input.status), kind: undefined, severity: undefined, q: undefined, mine: false }, user),
          ),
          sources: [{ label: 'Tickets', href: '/tickets' }],
        }),
      },
      {
        definition: tool(
          'get_my_targets',
          "The asking person's own targets: this month and this quarter, target against achieved, in the measures their desk is held to. A target of null means none has been set.",
          {},
        ),
        run: async (_input, user) => ({
          data: forModel(await targets.desk(user)),
          sources: [{ label: 'My desk', href: '/today' }],
        }),
      },
      // ---- how the business is doing --------------------------------------------
      {
        permission: 'indent.view',
        definition: tool(
          'get_todays_work',
          'The working queues of the day: loads still waiting for a transporter, loads we failed to place and why, open transporter problems, and deliveries whose proof is overdue.',
          {},
        ),
        run: async (_input, user) => ({
          data: forModel(await reports.today(user.branch?.id ?? null)),
          sources: [{ label: 'My desk', href: '/today' }],
        }),
      },
      {
        definition: tool(
          'get_business_snapshot',
          'One month\'s figures: loads delivered, billed to clients, paid to transporters, margin, on-time delivery, placement failures, figures by branch, top clients, proof-of-delivery collection, and what is outstanding now (advances, final payments, receivables, unbilled trips).',
          { month: optionalText('The month as YYYY-MM. Null means the current month.') },
        ),
        run: async (input, user) => ({
          data: forModel(await reports.home(user.branch?.id ?? null, text(input.month))),
          sources: [{ label: 'Business snapshot', href: '/home' }],
        }),
      },
      {
        definition: tool(
          'get_profit_and_loss',
          'Profit and loss over a period: revenue, what was paid for placement, loading, unloading, detention and other charges, and margin. Somebody who sees every branch gets one row per branch; somebody tied to one branch gets that branch broken down over time. People see only what their role allows.',
          {
            from: optionalText('Start date, YYYY-MM-DD.'),
            to: optionalText('End date, YYYY-MM-DD.'),
            granularity: optionalText('For a single branch, the time step: DAILY, MONTHLY or QUARTERLY. Null means monthly.'),
          },
        ),
        run: async (input, user) => ({
          data: forModel(
            await pnl.pnl(user, { granularity: text(input.granularity), from: text(input.from), to: text(input.to), branch: undefined }),
          ),
          sources: [{ label: 'Profit & loss', href: '/pnl' }],
        }),
      },
      // ---- pricing new business --------------------------------------------------
      {
        definition: tool(
          'search_rate_requests',
          'Rate requests (RFQs) from clients: who asked, for which period, when it is due, how many lanes, and status (DRAFT, SOURCING, QUOTED, SUBMITTED, AWARDED, LOST, CLOSED).',
          { status: optionalText('One status. Null for all.') },
        ),
        run: async (input) => ({
          data: forModel(await rfqs.list({ status: text(input.status), clientId: undefined })),
          sources: [{ label: 'Rate requests', href: '/rfq' }],
        }),
      },
      {
        definition: tool(
          'get_rate_request',
          'One rate request with every lane: route, truck type, sourcing rates gathered, overhead and margin added, the rate quoted, and whether the lane was won. Needs the id from search_rate_requests.',
          { id: { type: 'string', description: 'The rate request id.' } },
        ),
        run: async (input) => {
          const id = String(input.id ?? '').trim();
          return { data: forModel(await rfqs.getById(id)), sources: [{ label: 'Rate request', href: `/rfq/${id}` }] };
        },
      },
      // ---- checks waiting, and trucks on the road ---------------------------------
      {
        permission: 'document.verify',
        definition: tool(
          'list_verification_queue',
          'What is waiting for Compliance to check: transporters to clear, documents uploaded and not yet verified, and anything ageing — each with how long it has waited.',
          {},
        ),
        run: async () => ({
          data: forModel(await compliance.queues()),
          sources: [{ label: 'Document verification', href: '/compliance' }],
        }),
      },
      {
        permission: 'indent.view',
        definition: tool(
          'list_trucks_on_the_road',
          'The live fleet board: every truck on a trip, where it was last reported and when, its speed, and any alert (stopped too long, off route, no signal).',
          {},
        ),
        run: async () => ({
          data: forModel(await telematics.board()),
          sources: [{ label: 'Tracking', href: '/telematics' }],
        }),
      },
      // ---- orders, trips, payments, transporters ------------------------------------
      {
        permission: 'indent.view',
        definition: tool(
          'search_orders',
          'Find orders (loads). Use this first when the person names a client, a route, a transporter, a truck number, or an order, indent or trip number, or asks which orders are at a given step. Returns each order with the step it is on, its truck, transporter, route and ids. Follow with get_order for the full picture of one.',
          {
            query: optionalText('Free text: order/indent/trip number, client name, or a city on the route.'),
            truck: optionalText('A truck registration number, e.g. AP39EW3699.'),
            transporter: optionalText("A transporter's name."),
            status: optionalText(
              'One step, or several separated by commas: INDENT_CREATED, TRIP_GENERATED, LR_ISSUED, ADVANCE_DOCS_UPLOADED, ADVANCE_PAID, TRACKING, UNLOADED, POD_UPLOADED, POD_VERIFIED, BALANCE_RELEASED, FAILED, POD_FORFEITED, CANCELLED.',
            ),
            openOnly: { type: 'boolean', description: 'True to leave out orders whose final payment is already released.' },
          },
        ),
        run: async (input) => {
          const page = await orders.list({
            q: text(input.query),
            truck: text(input.truck),
            vendor: text(input.transporter),
            status: text(input.status),
            openOnly: input.openOnly === true,
            limit: MAX_ROWS,
            offset: 0,
          });
          return {
            data: listed(page.rows, page.total),
            sources: page.rows.slice(0, 5).map((o) => ({ label: `Order ${o.indentCode}`, href: `/orders/${o.indentId}` })),
          };
        },
      },
      {
        permission: 'indent.view',
        definition: tool(
          'get_order',
          'Everything about one order: the step it is on, client, route, transporter, truck and driver, rates, what has been paid, the trip milestones, proof-of-delivery status, the client invoice, and who did each step. Takes the order or indent number (e.g. 1004) or an order id from search_orders.',
          { ref: { type: 'string', description: 'The order or indent number, or an order id.' } },
        ),
        run: async (input, user) => {
          const order = await orders.getById(String(input.ref ?? '').trim(), user);
          return {
            data: forModel(order),
            sources: [{ label: `Order ${order.indentCode}`, href: `/orders/${order.indentId}` }],
          };
        },
      },
      {
        definition: tool(
          'get_tracking',
          'Where a truck is: the tracking sheet of one trip — every position update and milestone with its time and who recorded it, and the e-way bill validity. Needs the tripId from search_orders or get_order.',
          { tripId: { type: 'string', description: 'The trip id (not the trip number).' } },
        ),
        run: async (input) => {
          const tripId = String(input.tripId ?? '').trim();
          return { data: forModel(await trips.trackingSheet(tripId)), sources: [{ label: 'Trip tracking', href: `/trips/${tripId}` }] };
        },
      },
      {
        definition: tool(
          'get_trip_documents',
          'The documents of one trip (client invoice, e-way bill, vehicle papers, driving licence, loading and weighment slips, proof of delivery): whether each is uploaded, verified or rejected, by whom and when, and the details typed from it. Needs the tripId.',
          { tripId: { type: 'string', description: 'The trip id (not the trip number).' } },
        ),
        run: async (input) => {
          const tripId = String(input.tripId ?? '').trim();
          return { data: forModel(await trips.listDocuments(tripId)), sources: [{ label: 'Trip documents', href: `/trips/${tripId}` }] };
        },
      },
      {
        permission: 'indent.view',
        definition: tool(
          'list_advance_payments',
          'The advance-payment queue: trips whose advance is not yet released, with the amount, and whether each is blocked and by how many unmet conditions. Use for "which advances are ready / pending / blocked".',
          {},
        ),
        run: async () => ({
          data: listed(await payments.advanceQueue()),
          sources: [{ label: 'Advance payments', href: '/payments/advance' }],
        }),
      },
      {
        permission: 'indent.view',
        definition: tool(
          'list_final_payments',
          'The final-payment (balance) queue: delivered trips whose balance is not yet released, with the net amount, penalties, shortage/damage deductions, proof-of-delivery status, and whether each is blocked.',
          {},
        ),
        run: async () => ({
          data: listed(await payments.balanceQueue()),
          sources: [{ label: 'Final payments', href: '/payments/balance' }],
        }),
      },
      {
        definition: tool(
          'search_transporters',
          'Find transporters (vendors) by name, code, city or phone. Returns each with its status, base city, fleet size, trips done and id. Follow with get_transporter for one transporter in full.',
          { query: optionalText('Name, code, city or phone. Null lists them all.') },
        ),
        run: async (input) => {
          const rows = await vendors.list({ q: text(input.query) });
          return {
            data: listed(rows),
            sources: rows.slice(0, 5).map((v) => ({ label: v.legalName, href: `/vendors/${v.id}` })),
          };
        },
      },
      {
        definition: tool(
          'get_transporter',
          "One transporter's file: status, contact, the state of each legal document, fleet, advance policy, and business done with us (trips, revenue, margin, what is outstanding, what they owe from shortage or damage). Identity and bank details are not included. Needs the transporter id from search_transporters.",
          { id: { type: 'string', description: 'The transporter id.' } },
        ),
        run: async (input) => {
          const id = String(input.id ?? '').trim();
          const vendor = await vendors.getById(id);
          return { data: forModel(vendor), sources: [{ label: vendor.legalName, href: `/vendors/${id}` }] };
        },
      },
      {
        definition: tool(
          'list_sdr_records',
          'Shortage, damage and details-mismatch records (SDR): what was claimed, what is being deducted, what is still to recover from the transporter. An OPEN record holds that trip\'s final payment.',
          { status: optionalText('OPEN or RESOLVED. Null for both.') },
        ),
        run: async (input) => ({
          data: listed(await sdr.list({ status: text(input.status) })),
          sources: [{ label: 'SDR', href: '/sdr' }],
        }),
      },
      {
        definition: tool(
          'list_pod_pending',
          'Delivered loads whose signed proof of delivery has not reached us: days since delivery, days left before the penalty window closes, penalty so far, and the balance being held.',
          {},
        ),
        run: async () => {
          const pending = await pod.pending({});
          return { data: forModel(pending), sources: [{ label: 'Check POD status', href: '/pod/pending' }] };
        },
      },
    ];
  }

  /** The lookups this person may use — the ones whose screen they could open themselves. */
  definitionsFor(user: AuthenticatedUser): Anthropic.Tool[] {
    return this.lookups.filter((l) => this.allowed(l, user)).map((l) => l.definition);
  }

  /**
   * Runs one lookup as this person. The permission is checked again here, not
   * only when the list was offered: what the model asks for is not trusted to
   * stay within what it was shown.
   */
  async run(name: string, input: unknown, user: AuthenticatedUser): Promise<LookupResult> {
    const lookup = this.lookups.find((l) => l.definition.name === name);
    if (!lookup) throw new Error(`There is no lookup called ${name}.`);
    if (!this.allowed(lookup, user)) throw new Error('This person does not have access to that.');
    const args = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    return lookup.run(args, user);
  }

  private allowed(lookup: Lookup, user: AuthenticatedUser): boolean {
    return !lookup.permission || (user.permissions.get(lookup.permission) ?? 'NONE') !== 'NONE';
  }
}
