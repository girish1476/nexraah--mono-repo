/**
 * SMS — the third channel, switched on when a gateway is named.
 *
 * The specs say the company's DLT registration is done and a gateway is in
 * place (D-31); which gateway is not recorded here. Each gateway takes the
 * same thing — a mobile number, a DLT-registered template id, and the values
 * for its placeholders — through its own API. A gateway is one implementation
 * of `SmsGateway`; until one is set (`SMS_PROVIDER`), no SMS is queued at all
 * and email and push carry every notification.
 *
 * Template ids come from `SMS_TEMPLATES`, a JSON object from event to the
 * template id registered for it, e.g. {"payment.released":"1207…"}. An event
 * with no template is not sent by SMS: an unregistered text is refused by
 * every Indian operator under DLT.
 */

export interface SmsMessage {
  /** Ten digits; the gateway adds the country code its API wants. */
  mobile: string;
  templateId: string;
  /** The template's placeholder values, in order. */
  values: string[];
}

export interface SmsGateway {
  readonly name: string;
  send(message: SmsMessage): Promise<{ providerRef: string }>;
}

/** Which events have a DLT template, from `SMS_TEMPLATES`. Bad JSON counts as none. */
export function smsTemplates(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  try {
    const parsed = JSON.parse(env.SMS_TEMPLATES ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.trim()),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * The gateway named in `SMS_PROVIDER`, or null. No gateway is built in yet:
 * the one the company already uses is connected here once it is named, so that
 * nothing is sent through a provider the company has no account with.
 */
export function smsGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): SmsGateway | null {
  const provider = (env.SMS_PROVIDER ?? '').trim().toLowerCase();
  if (!provider) return null;
  return null;
}
