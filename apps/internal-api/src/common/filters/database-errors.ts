/**
 * A database refusal, said as the rule it broke.
 *
 * PostgreSQL enforces rules the services do not all repeat — an end date not
 * before its start, a due date not before the invoice date, one rate card lane
 * per route. Until preprod (Nov 2026) every one of these reached the screen as
 * "Internal server error", which tells the person nothing they can fix, and two
 * real bugs hid behind it for days (a synthetic RFQ dated today-to-today, an
 * upload owned by "unassigned"). The rule that was broken is now named, and the
 * filter still logs each one, so a refusal caused by our own code stays easy to
 * find.
 */

/** SQLSTATE codes from node-postgres (`error.code`) mapped to an answer. */
const BY_SQLSTATE: Record<string, { status: number; code: string; message: string }> = {
  '23514': { status: 400, code: 'DATA_RULE', message: 'That would break one of the record’s rules. Check the dates and amounts.' },
  '23505': { status: 409, code: 'ALREADY_EXISTS', message: 'A record with these details already exists.' },
  '23503': { status: 400, code: 'NOT_FOUND_REFERENCE', message: 'This refers to a record that does not exist, or no longer does.' },
  '23502': { status: 400, code: 'MISSING_VALUE', message: 'A required value is missing.' },
  '22P02': { status: 400, code: 'BAD_FORMAT', message: 'A value is in the wrong format.' },
  '22007': { status: 400, code: 'BAD_FORMAT', message: 'A date is in the wrong format.' },
  '22008': { status: 400, code: 'BAD_FORMAT', message: 'A date is out of range.' },
  '22003': { status: 400, code: 'BAD_FORMAT', message: 'A number is too large.' },
};

/** Named rules (CHECK constraints) a person can actually trip over, in their words. */
const BY_CONSTRAINT: Record<string, string> = {
  invoices_due_after_date: 'The due date cannot be before the invoice date.',
  rate_card_lanes_validity: 'A rate cannot end before it starts.',
  client_documents_validity: 'A document cannot expire before it is valid from.',
  vendor_documents_validity: 'A document cannot expire before it is valid from.',
  rfqs_period: 'A rate request has to end after it starts.',
  rate_revisions_actually_revises: 'The new rate is the same as the current one.',
  lr_consignor_named: 'The lorry receipt needs the consignor’s name.',
  lr_consignee_named: 'The lorry receipt needs the consignee’s name.',
  client_route_points_unloading_pair: 'Give both the unloading place and its location, or neither.',
  trip_tracking_coords_together: 'A location needs both latitude and longitude.',
};

export interface DatabaseErrorAnswer {
  status: number;
  code: string;
  message: string;
  /** The rule, for the log and for support — never the row's values. */
  details: { constraint?: string; sqlstate: string };
}

/** `null` when this is not a database refusal we can explain. */
export function databaseErrorAnswer(exception: unknown): DatabaseErrorAnswer | null {
  if (!exception || typeof exception !== 'object') return null;
  const e = exception as { code?: unknown; constraint?: unknown; severity?: unknown };
  // node-postgres errors carry a five-character SQLSTATE and a severity.
  if (typeof e.code !== 'string' || !/^[0-9A-Z]{5}$/.test(e.code) || typeof e.severity !== 'string') return null;
  const known = BY_SQLSTATE[e.code];
  if (!known) return null;
  const constraint = typeof e.constraint === 'string' ? e.constraint : undefined;
  const message = (constraint && BY_CONSTRAINT[constraint]) || known.message;
  return { status: known.status, code: known.code, message, details: { constraint, sqlstate: e.code } };
}
