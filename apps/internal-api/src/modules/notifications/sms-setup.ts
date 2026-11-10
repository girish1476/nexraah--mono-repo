import { EVENTS, renderEvent, type NotificationEvent } from './notification-events';
import { SMS_PROVIDERS, smsGatewayFromEnv, smsTemplates } from './sms';

/**
 * Where the SMS set-up stands, for the administrator configuring it one
 * setting at a time — which gateway, what is still missing, and which
 * notifications have an approved template. Never returns a key.
 */
export interface SmsSetup {
  provider: string | null;
  ready: boolean;
  /** The settings still to be filled in, by their deployment names. */
  missing: string[];
  /** Every notification, and whether a template id is set for it. */
  templates: { event: NotificationEvent; templateId: string | null }[];
}

export function smsSetup(env: NodeJS.ProcessEnv = process.env): SmsSetup {
  const provider = (env.SMS_PROVIDER ?? '').trim().toLowerCase() || null;
  const missing: string[] = [];
  if (!provider || !(SMS_PROVIDERS as readonly string[]).includes(provider)) missing.push(`SMS_PROVIDER (${SMS_PROVIDERS.join(' or ')})`);
  if (!(env.SMS_API_KEY ?? '').trim()) missing.push('SMS_API_KEY');
  if (provider === 'fast2sms' && !(env.SMS_SENDER_ID ?? '').trim()) missing.push('SMS_SENDER_ID');
  const ids = smsTemplates(env);
  if (Object.keys(ids).length === 0) missing.push('SMS_TEMPLATES');
  return {
    provider,
    ready: smsGatewayFromEnv(env) !== null && Object.keys(ids).length > 0,
    missing,
    templates: EVENTS.map((event) => ({ event, templateId: ids[event] ?? null })),
  };
}

/** Plausible values for each notification, so a test SMS reads like the real one. */
const SAMPLE: Record<NotificationEvent, Record<string, unknown>> = {
  'quote.awarded': { loadCode: '4471', route: 'Visakhapatnam → Hyderabad', amountPaise: 4472000, pickupDate: new Date().toISOString() },
  'payment.released': { kind: 'ADVANCE', amountPaise: 3130400, tripCode: '100242', utr: 'TESTUTR0001', valueDate: new Date().toISOString() },
  'pod.due': { tripCode: '100242', route: 'Visakhapatnam → Hyderabad', deliveredOn: new Date().toISOString(), dueOn: new Date().toISOString() },
  'pod.breached': { tripCode: '100242', dueOn: new Date().toISOString(), daysLate: 2 },
  'pod.forfeit_warning': { tripCode: '100242', forfeitOn: new Date().toISOString() },
  'pod.rejected': { tripCode: '100242', reason: 'Consignee stamp missing' },
  'bill.queried': { tripCode: '100242', note: 'Please attach the halting receipt' },
  'vendor.activated': { vendorName: 'Test Transporter' },
  'approval.raised': { title: 'Test approval', requesterName: 'Administrator', detail: '' },
  'approval.decided': { title: 'Test approval', deciderName: 'Administrator', decision: 'APPROVED', note: '' },
};

/** The values a test of this notification fills its template with — the same ones the real send would use. */
export function sampleSmsValues(event: NotificationEvent): string[] {
  return renderEvent(event, SAMPLE[event]).sms;
}
