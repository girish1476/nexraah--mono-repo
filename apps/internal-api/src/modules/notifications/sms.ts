/**
 * SMS — the third channel, switched on by the deployment's settings.
 *
 * The company's DLT registration is done (Nov 2026); the texts go out through
 * a gateway it holds an account with. Two are built in, the two DLT gateways
 * most Indian businesses use, so the company configures rather than waits for
 * code:
 *
 *   SMS_PROVIDER   msg91 | fast2sms
 *   SMS_API_KEY    the gateway's API key (MSG91 "authkey"; Fast2SMS "Authorization")
 *   SMS_SENDER_ID  the 6-letter DLT header — Fast2SMS needs it on each send;
 *                  MSG91 keeps it on the template, so it is not sent there
 *   SMS_TEMPLATES  JSON, event → the id the gateway knows the approved template
 *                  by: MSG91's template id, or the Fast2SMS DLT Manager
 *                  message id. e.g. {"payment.released":"6553…"}
 *
 * With any of these missing no SMS is queued at all, and email and push carry
 * every notification. An event with no template is not sent by SMS: an
 * unregistered text is refused by every Indian operator under DLT.
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

/** DLT caps a {#var#} at 30 characters; a longer value fails the template match and the SMS with it. */
const DLT_VAR_MAX = 30;
const dltValue = (v: string) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, DLT_VAR_MAX);

/** A gateway's refusal, with what it said, so the notification row records why. */
export class SmsGatewayError extends Error {}

/**
 * MSG91 — POST https://control.msg91.com/api/v5/flow (docs.msg91.com,
 * send-sms.openapi.yml). The template is MSG91's own template id; the DLT
 * header and template id are attached to it in MSG91, not sent here. Values
 * are VAR1, VAR2, … in the template's order. Success is {"type":"success",
 * "message":"<request id>"}.
 */
export function msg91Gateway(authKey: string, fetchImpl: typeof fetch = fetch): SmsGateway {
  return {
    name: 'msg91',
    async send(message) {
      const recipient: Record<string, string> = { mobiles: `91${message.mobile}` };
      message.values.forEach((v, i) => (recipient[`VAR${i + 1}`] = dltValue(v)));
      const response = await fetchImpl('https://control.msg91.com/api/v5/flow', {
        method: 'POST',
        headers: { authkey: authKey, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ template_id: message.templateId, short_url: '0', recipients: [recipient] }),
      });
      const body = (await response.json().catch(() => ({}))) as { type?: string; message?: string };
      if (!response.ok || body.type !== 'success') {
        throw new SmsGatewayError(`MSG91 refused the SMS (${response.status}): ${body.message ?? 'no reason given'}`);
      }
      return { providerRef: String(body.message ?? '') };
    },
  };
}

/**
 * Fast2SMS — GET https://www.fast2sms.com/dev/bulkV2, route "dlt"
 * (docs.fast2sms.com, dlt-sms). `message` is the message id DLT Manager shows
 * for the approved template; the values go pipe-separated, one per {#var#} in
 * order, so a pipe inside a value is replaced. Success is {"return":true,
 * "request_id":…}; errors answer 400/401 with a code (e.g. 424 invalid message
 * id, 416 low balance).
 */
export function fast2smsGateway(apiKey: string, senderId: string, fetchImpl: typeof fetch = fetch): SmsGateway {
  return {
    name: 'fast2sms',
    async send(message) {
      const query = new URLSearchParams({
        route: 'dlt',
        sender_id: senderId,
        message: message.templateId,
        variables_values: message.values.map((v) => dltValue(v).replace(/\|/g, '/')).join('|'),
        numbers: message.mobile,
      });
      const response = await fetchImpl(`https://www.fast2sms.com/dev/bulkV2?${query}`, {
        method: 'GET',
        headers: { authorization: apiKey },
      });
      const body = (await response.json().catch(() => ({}))) as { return?: boolean; request_id?: string; message?: unknown; status_code?: number };
      if (!response.ok || body.return !== true) {
        const said = Array.isArray(body.message) ? body.message.join(' ') : String(body.message ?? 'no reason given');
        throw new SmsGatewayError(`Fast2SMS refused the SMS (${body.status_code ?? response.status}): ${said}`);
      }
      return { providerRef: String(body.request_id ?? '') };
    },
  };
}

/** The gateways that can be named in `SMS_PROVIDER`. */
export const SMS_PROVIDERS = ['msg91', 'fast2sms'] as const;

/**
 * The gateway the deployment's settings name, or null — which is also the
 * answer when a setting it needs is missing, so a half-set gateway sends
 * nothing rather than failing every notification.
 */
export function smsGatewayFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): SmsGateway | null {
  const provider = (env.SMS_PROVIDER ?? '').trim().toLowerCase();
  const key = (env.SMS_API_KEY ?? '').trim();
  if (!provider || !key) return null;
  if (provider === 'msg91') return msg91Gateway(key, fetchImpl);
  if (provider === 'fast2sms') {
    const sender = (env.SMS_SENDER_ID ?? '').trim();
    return sender ? fast2smsGateway(key, sender, fetchImpl) : null;
  }
  return null;
}
