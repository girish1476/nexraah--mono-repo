/** Control panel — part 01 §4. */

export interface CompanyDetails {
  name: string;
  gstin: string;
  pan: string;
  cin: string;
  address: string;
  bank: string;
  /** SAC — the GST service code printed on the invoice (996511 for a goods
   *  transport agency's road transport service). */
  sac: string;
  /** The name/title printed under the signature line on a printed invoice
   *  — e.g. "Authorised Signatory", or a specific person once designated. */
  signatory: string;
}

export interface Config {
  modules: Record<string, boolean>;
  kyc_strict_gate: boolean;
  kyc_route: 'MANUAL' | 'API';
  /** BR-58 — the eight documents that gate the advance. Editing is audited. */
  advance_document_set: string[];
  advance_default_pct: number;
  credit_default_days: number;
  sla_hours: number;
  pod_tat_days: number;
  pod_penalty_per_day_paise: number;
  pod_forfeit_days: number;
  eway_warning_window_hours: number;
  overspeed_kmph: number;
  halt_minutes: number;
  dark_vehicle_interval_minutes: number;
  minimum_margin_pct: number;
  branch_catchment_km: number;
  company: CompanyDetails;
}

export interface NumberSeries {
  key: string;
  prefix: string;
  nextValue: number;
  width: number;
  scope: 'GLOBAL' | 'BRANCH' | 'MASTER';
  branchId: string | null;
}
