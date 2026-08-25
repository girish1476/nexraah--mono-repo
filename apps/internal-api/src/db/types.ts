import type { Generated, GeneratedAlways } from 'kysely';

/**
 * Mirrors supabase/migrations exactly — snake_case, one interface per table.
 * Money stays `number` (paise): pools.ts installs a pg type parser for OID 20
 * (int8) that parses to JS number, safe up to 2^53-1 paise (~₹90bn), and this
 * business's volumes (NFR-05) are nowhere near that.
 *
 * The API layer maps these to camelCase DTOs; nothing here is exposed as-is.
 */
export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type SupplySource = 'UNION' | 'MARKET' | 'BOTH' | 'DIRECT_OWNER';

/**
 * The ten steps of an order, plus the exception branch — FLOWS.md §6/§11, in
 * the user's own wording. Fixed vocabulary: an eleventh step is a business
 * decision, not a schema one.
 */
export type OrderStatus =
  | 'FAILED'
  | 'POD_FORFEITED'
  | 'INDENT_CREATED'
  | 'TRIP_GENERATED'
  | 'LR_ISSUED'
  | 'ADVANCE_DOCS_UPLOADED'
  | 'ADVANCE_PAID'
  | 'TRACKING'
  | 'UNLOADED'
  | 'POD_UPLOADED'
  | 'POD_VERIFIED'
  | 'BALANCE_RELEASED';

export interface BranchesTable {
  id: Generated<string>;
  code: string;
  name: string;
  city: string;
  lat: string | null;
  lng: string | null;
  catchment_km: Generated<number>;
  supply_source: SupplySource | null;
  supply_remarks: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RolesTable {
  id: Generated<string>;
  code: string;
  name: string;
  is_system: Generated<boolean>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PermissionsTable {
  id: Generated<string>;
  code: string;
  created_at: Generated<string>;
}

export interface PermissionFixedOwnersTable {
  permission_code: string;
  owner_role_code: string;
}

export interface RolePermissionsTable {
  role_id: string;
  permission_id: string;
  level: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface UsersTable {
  id: Generated<string>;
  auth_user_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  role_id: string;
  branch_id: string | null;
  status: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ConfigTable {
  key: string;
  value: Json;
  updated_by: string | null;
  updated_at: Generated<string>;
  created_at: Generated<string>;
}

export interface NumberSeriesTable {
  id: Generated<string>;
  key: string;
  prefix: string;
  next_value: Generated<number>;
  width: Generated<number>;
  scope: string;
  branch_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AttachmentsTable {
  id: Generated<string>;
  kind: string;
  entity_type: string;
  entity_id: string;
  storage_path: string;
  mime: string;
  bytes: number;
  sha256: string;
  uploaded_by: string;
  uploaded_at: Generated<string>;
  retain_until: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ApprovalsTable {
  id: Generated<string>;
  kind: string;
  entity_type: string;
  entity_id: string;
  requester_id: string;
  reason: string;
  payload: Json;
  status: Generated<string>;
  approver_id: string | null;
  decided_at: string | null;
  note: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AuditEventsTable {
  id: Generated<string>;
  at: Generated<string>;
  actor_id: string | null;
  actor_role: string;
  actor_vendor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Json | null;
  after: Json | null;
  request_id: string | null;
}

export interface VendorsTable {
  id: Generated<string>;
  code: string;
  legal_name: string;
  party_type: string;
  base_city: string;
  branch_id: string;
  gstin: string | null;
  pan: string | null;
  phone: string;
  alt_phone: string | null;
  fleet_base: Generated<number>;
  operating_states: Generated<string[]>;
  // Self-reported at onboarding (part 03 §1 step 3), distinct from
  // `vendor_fleet`'s row count — that table tracks actually-registered
  // trucks with plate numbers, a separate, not-yet-built intake path.
  declared_fleet_count: Generated<number>;
  truck_types: Generated<string[]>;
  fleet_body_type: string | null;
  advance_pct: Generated<number>;
  bank_account: string | null;
  ifsc: string | null;
  account_holder: string | null;
  status: Generated<string>;
  verified_by: string | null;
  panel_date: string | null;
  rating: number | null;
  source: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface VendorUsersTable {
  auth_user_id: string;
  vendor_id: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface VendorKycTable {
  id: Generated<string>;
  vendor_id: string;
  kind: string;
  value_masked: string | null;
  route: string;
  status: Generated<string>;
  verified_by: string | null;
  verified_at: string | null;
  attachment_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface VendorDocumentsTable {
  id: Generated<string>;
  vendor_id: string;
  kind: string;
  attachment_id: string | null;
  reference: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: Generated<string>;
  verified_by: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface VendorFleetTable {
  id: Generated<string>;
  vendor_id: string;
  registration: string;
  type: string;
  capacity_kg: number;
  body_type: string | null;
  current_city: string | null;
  free_from: string | null;
  status: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface VendorAdvanceHistoryTable {
  id: Generated<string>;
  vendor_id: string;
  old_pct: number;
  new_pct: number;
  approval_id: string | null;
  changed_by: string;
  changed_at: Generated<string>;
  created_at: Generated<string>;
}

export interface LeadsTable {
  id: Generated<string>;
  code: string;
  name: string;
  city: string | null;
  source: string | null;
  party_type: string | null;
  trucks_claimed: number | null;
  phone: string | null;
  owner_id: string | null;
  stage: string;
  notes: string | null;
  converted_vendor_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface MarketGapTargetsTable {
  id: Generated<string>;
  branch_id: string;
  lane: string;
  truck_type: string;
  target: number;
  on_panel: Generated<number>;
  converted: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ClientsTable {
  id: Generated<string>;
  code: string;
  name: string;
  billing_city: string;
  gstin: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  engagement: string;
  agreement_no: string | null;
  valid_from: string | null;
  valid_to: string | null;
  agreement_attachment_id: string | null;
  credit_days: Generated<number>;
  service_level: string | null;
  status: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RfqsTable {
  id: Generated<string>;
  client_id: string;
  cycle_months: number;
  period_from: string;
  period_to: string;
  due_at: string | null;
  reference: string | null;
  status: Generated<string>;
  submitted_by: string | null;
  submitted_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RfqLanesTable {
  id: Generated<string>;
  rfq_id: string;
  origin: string;
  destination: string;
  truck_type: string;
  transit_days: number | null;
  reporting_rule: string | null;
  sourcing_mode: string | null;
  sourcing_avg: number | null;
  overhead: number | null;
  margin: number | null;
  quoted_rate: number | null;
  outcome: string | null;
  awarded_rate: number | null;
  supply_source: SupplySource | null;
  supply_remarks: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RfqLaneSourcingTable {
  id: Generated<string>;
  rfq_lane_id: string;
  month: string | null;
  rate: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RateCardLanesTable {
  id: Generated<string>;
  client_id: string;
  rfq_lane_id: string;
  origin: string;
  destination: string;
  truck_type: string;
  rate: number;
  transit_days: number | null;
  reporting_rule: string | null;
  valid_from: string;
  valid_to: string | null;
  supply_source: SupplySource | null;
  supply_remarks: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface IndentsTable {
  id: Generated<string>;
  code: string;
  client_id: string;
  branch_id: string;
  from_city: string;
  to_city: string;
  material: string;
  weight_kg: number;
  truck_type: string;
  pickup_date: string;
  transit_days: number | null;
  reporting_rule: string | null;
  remarks: string | null;
  sell_rate: number;
  buy_rate: number | null;
  rate_source: string;
  rate_card_lane_id: string | null;
  sourcing_rate: number | null;
  spot_confirmation_attachment_id: string | null;
  bid_min: number | null;
  bid_max: number | null;
  band_locked: Generated<boolean>;
  advance_pct: Generated<number>;
  stage: Generated<string>;
  vendor_id: string | null;
  awarded_quote_id: string | null;
  vehicle_no: string | null;
  driver_name: string | null;
  driver_licence: string | null;
  reported_at: string | null;
  failure_cause: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface QuotesTable {
  id: Generated<string>;
  code: string;
  indent_id: string;
  vendor_id: string;
  amount: number;
  truck_registration: string | null;
  remarks: string | null;
  band_position: string;
  status: Generated<string>;
  submitted_at: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

/**
 * One row per indent — the indent is the request, the order is its journey.
 *
 * `status`/`step_no` are a materialised view of facts that live in `indents`
 * and `trips`, not a second source of truth: `OrdersService.recompute()` is
 * the only writer, and it derives them the same way for every caller. That
 * single copy is the point — the browser-side ladder this replaced ran twice
 * with different inputs, so a list row and its own detail page could disagree
 * about which step an order was on.
 */
export interface OrdersTable {
  id: Generated<string>;
  order_no: string;
  indent_id: string;
  trip_id: string | null;
  invoice_id: string | null;
  client_id: string;
  branch_id: string;
  status: Generated<OrderStatus>;
  step_no: Generated<number>;
  closed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Append-only step history. Nothing updates or deletes a row here. */
export interface OrderEventsTable {
  id: Generated<string>;
  order_id: string;
  status: OrderStatus;
  step_no: number;
  /** Null means the system did it — a nightly sweep, a tracking ping. */
  actor_user_id: string | null;
  note: string | null;
  at: Generated<Date>;
}

export interface TripsTable {
  id: Generated<string>;
  code: string;
  indent_id: string;
  client_id: string;
  vendor_id: string;
  branch_id: string;
  vehicle_no: string;
  vehicle_type: string | null;
  capacity_kg: number | null;
  driver_name: string | null;
  driver_licence: string | null;
  lane: string | null;
  weight_kg: number | null;
  transit_days_required: number | null;
  actual_transit_days: number | null;
  remarks: string | null;
  buy_rate: number;
  eway_no: string | null;
  eway_valid_till: string | null;
  stage: Generated<string>;
  delivered_at: string | null;
  pod_status: Generated<string>;
  pod_received_at: string | null;
  pod_penalty: Generated<number>;
  pod_closure_basis: string | null;
  advance_paid: Generated<number>;
  balance_paid: Generated<number>;
  billed: Generated<boolean>;
  cross_check_overridden: Generated<boolean>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface TripDocumentsTable {
  id: Generated<string>;
  trip_id: string;
  kind: string;
  attachment_id: string | null;
  status: Generated<string>;
  verified_by: string | null;
  verified_at: string | null;
  reject_reason: string | null;
  keyed_values: Json | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface TripChargesTable {
  id: Generated<string>;
  trip_id: string;
  charge_type: string;
  cost_amount: Generated<number>;
  billed_amount: Generated<number>;
  captured_by: string;
  captured_at: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface LorryReceiptsTable {
  id: Generated<string>;
  code: string;
  trip_id: string;
  lr_date: string;
  booked_at: Generated<string>;
  branch_id: string;
  consignor: Json;
  consignee: Json;
  goods: Json;
  invoice: Json | null;
  eway: Json | null;
  vehicle: Json;
  driver: Json;
  transit_days: number | null;
  remarks: string | null;
  charges: Json | null;
  status: Generated<string>;
  shared_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PodReceiptsTable {
  id: Generated<string>;
  code: string;
  trip_id: string;
  courier_docket: string | null;
  sent_on: string | null;
  received_on: string | null;
  pages: number | null;
  received_by: string | null;
  condition: string | null;
  attachment_ids: Generated<string[]>;
  verified_by: string | null;
  verified_at: string | null;
  checklist: Json | null;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  supersedes_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface VendorBillsTable {
  id: Generated<string>;
  trip_id: string;
  vendor_id: string;
  bill_no: string;
  bill_date: string;
  attachment_id: string | null;
  freight: number;
  charges: Generated<number>;
  total: number;
  submitted_at: Generated<string>;
  computed_balance: number;
  variance: GeneratedAlways<number>;
  status: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PaymentsTable {
  id: Generated<string>;
  trip_id: string | null;
  indent_id: string | null;
  kind: string;
  gross: number;
  penalty: Generated<number>;
  net: GeneratedAlways<number>;
  mode: string;
  transfer_type: string;
  remitting_account: string;
  utr: string;
  value_date: string;
  released_by: string;
  released_at: Generated<string>;
  idempotency_key: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface InvoicesTable {
  id: Generated<string>;
  code: string;
  client_id: string;
  invoice_date: string;
  due_date: string;
  freight: Generated<number>;
  loading: Generated<number>;
  unloading: Generated<number>;
  detention: Generated<number>;
  other: Generated<number>;
  discount: Generated<number>;
  round_off: Generated<number>;
  total: number;
  received: Generated<number>;
  tax_mechanism: Generated<string>;
  taxable: Generated<number>;
  cgst: Generated<number>;
  sgst: Generated<number>;
  igst: Generated<number>;
  status: Generated<string>;
  cancel_reason: string | null;
  notes: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface InvoiceTripsTable {
  invoice_id: string;
  trip_id: string;
  created_at: Generated<string>;
}

export interface ReceiptsTable {
  id: Generated<string>;
  code: string;
  invoice_id: string;
  client_id: string;
  amount: number;
  received_on: string;
  mode: string;
  reference: string | null;
  remarks: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface TelematicsPingsTable {
  id: Generated<number>;
  vehicle_no: string;
  at: string;
  lat: string | null;
  lng: string | null;
  speed: number | null;
  fuel: number | null;
  raw: Json | null;
  created_at: Generated<string>;
}

export interface TelematicsAlertsTable {
  id: Generated<string>;
  vehicle_no: string;
  trip_id: string | null;
  kind: string;
  raised_at: Generated<string>;
  cleared_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface NotificationsTable {
  id: Generated<string>;
  event: string;
  channel: string;
  recipient: string;
  template_id: string;
  payload: Json;
  status: Generated<string>;
  sent_at: string | null;
  provider_ref: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

/**
 * `docs/api/11-portal.md` §3 — the replay ledger every portal write goes
 * through. `20260824090000_c_portal_idempotency.sql`. Scoped
 * (vendor_id, endpoint, idempotency_key): never a global key space, so one
 * vendor cannot probe another's keys.
 */
export interface PortalIdempotencyKeysTable {
  id: Generated<string>;
  vendor_id: string;
  endpoint: string;
  idempotency_key: string;
  response: Json;
  created_at: Generated<string>;
}

export interface IssuesTable {
  id: Generated<string>;
  code: string;
  vendor_id: string;
  category: string;
  severity: string;
  raised_by: string;
  raised_at: Generated<string>;
  trip_id: string | null;
  status: string;
  note: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface Database {
  branches: BranchesTable;
  roles: RolesTable;
  permissions: PermissionsTable;
  permission_fixed_owners: PermissionFixedOwnersTable;
  role_permissions: RolePermissionsTable;
  users: UsersTable;
  config: ConfigTable;
  number_series: NumberSeriesTable;
  attachments: AttachmentsTable;
  approvals: ApprovalsTable;
  audit_events: AuditEventsTable;
  vendors: VendorsTable;
  vendor_users: VendorUsersTable;
  vendor_kyc: VendorKycTable;
  vendor_documents: VendorDocumentsTable;
  vendor_fleet: VendorFleetTable;
  vendor_advance_history: VendorAdvanceHistoryTable;
  leads: LeadsTable;
  market_gap_targets: MarketGapTargetsTable;
  clients: ClientsTable;
  rfqs: RfqsTable;
  rfq_lanes: RfqLanesTable;
  rfq_lane_sourcing: RfqLaneSourcingTable;
  rate_card_lanes: RateCardLanesTable;
  indents: IndentsTable;
  quotes: QuotesTable;
  trips: TripsTable;
  trip_documents: TripDocumentsTable;
  trip_charges: TripChargesTable;
  lorry_receipts: LorryReceiptsTable;
  pod_receipts: PodReceiptsTable;
  vendor_bills: VendorBillsTable;
  payments: PaymentsTable;
  invoices: InvoicesTable;
  invoice_trips: InvoiceTripsTable;
  receipts: ReceiptsTable;
  telematics_pings: TelematicsPingsTable;
  telematics_alerts: TelematicsAlertsTable;
  notifications: NotificationsTable;
  issues: IssuesTable;
  portal_idempotency_keys: PortalIdempotencyKeysTable;
  orders: OrdersTable;
  order_events: OrderEventsTable;
}
