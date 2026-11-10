'use client';

import { useEffect, useState } from 'react';
import { errorMessage, request } from '@/apis';
import { ErrorState, Field, FormGrid, Loading, Panel, Tag, useToast } from '@/lib/ui';

/** `GET /notifications/sms` — never carries a key. */
interface SmsSetup {
  provider: string | null;
  ready: boolean;
  missing: string[];
  templates: { event: string; templateId: string | null }[];
}

/** What each notification is, in the words the DLT template list uses. */
const EVENT_LABEL: Record<string, string> = {
  'payment.released': 'Payment advice (advance or balance paid)',
  'quote.awarded': 'Load awarded',
  'pod.due': 'POD due',
  'pod.breached': 'POD late',
  'pod.forfeit_warning': 'Balance forfeit warning',
  'pod.rejected': 'POD rejected',
  'bill.queried': 'Bill query',
  'vendor.activated': 'Transporter cleared',
  'approval.raised': 'Approval waiting (staff)',
  'approval.decided': 'Approval decided (staff)',
};

/**
 * Text messages — Admin → Control panel.
 *
 * SMS is set on the server (Render → Environment), not here: a gateway key
 * does not belong in a browser. This shows how far the set-up has got — which
 * gateway, which settings are still missing, which notifications have an
 * approved template — and sends one test SMS to a number typed here, so a
 * wrong key or template id is found now and not on a live payment.
 */
export function SmsPanel({ editable }: { editable: boolean }) {
  const toast = useToast();
  const [setup, setSetup] = useState<SmsSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobile, setMobile] = useState('');
  const [event, setEvent] = useState('payment.released');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    setError(null);
    request<SmsSetup>({ url: '/notifications/sms', method: 'GET' })
      .then(setSetup)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const sendTest = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await request<{ provider: string; providerRef: string; values: string[] }>({
        url: '/notifications/sms/test',
        method: 'POST',
        data: { mobile: mobile.replace(/\D/g, '').slice(-10), event },
      });
      setResult({ ok: true, text: `Sent through ${r.provider} (reference ${r.providerRef || '—'}) with: ${r.values.join(' · ')}` });
      toast('Test SMS sent');
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const withTemplate = setup?.templates.filter((t) => t.templateId) ?? [];

  return (
    <Panel
      title="Text messages (SMS)"
      right={setup && <Tag tone={setup.ready ? 'mint' : 'flag'}>{setup.ready ? `On · ${setup.provider}` : 'Needs setting up'}</Tag>}
    >
      {error && <ErrorState message={error} retry={load} />}
      {!setup && !error && <Loading what="Reading the SMS set-up" />}
      {setup && (
        <div data-sms-setup style={{ display: 'grid', gap: 12, fontSize: 13 }}>
          <div className="muted">
            Set on the server: Render → the API service → Environment. <span className="mono">SMS_PROVIDER</span> is{' '}
            <span className="mono">msg91</span> or <span className="mono">fast2sms</span>; <span className="mono">SMS_API_KEY</span> is
            the gateway&rsquo;s key; Fast2SMS also needs <span className="mono">SMS_SENDER_ID</span> (the 6-letter DLT header);{' '}
            <span className="mono">SMS_TEMPLATES</span> maps each notification to its approved template id, e.g.{' '}
            <span className="mono">{'{"payment.released":"1234567"}'}</span>. A notification with no template goes by email and app
            notification only.
          </div>

          {setup.missing.length > 0 && (
            <div>
              <strong>Still to fill in:</strong> {setup.missing.map((m) => <span key={m} className="mono">{m} </span>)}
            </div>
          )}

          <table className="table" style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th>Notification</th>
                <th>Key in SMS_TEMPLATES</th>
                <th>Template id</th>
              </tr>
            </thead>
            <tbody>
              {setup.templates.map((t) => (
                <tr key={t.event}>
                  <td>{EVENT_LABEL[t.event] ?? t.event}</td>
                  <td className="mono">{t.event}</td>
                  <td className="mono">{t.templateId ?? <span className="muted">not set — email and app only</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {editable && (
            <div>
              <strong>Send a test SMS</strong>
              <FormGrid>
                <Field label="To mobile number">
                  <input name="sms-test-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10 digits" inputMode="numeric" />
                </Field>
                <Field label="Message">
                  <select name="sms-test-event" value={event} onChange={(e) => setEvent(e.target.value)}>
                    {(withTemplate.length ? withTemplate : setup.templates).map((t) => (
                      <option key={t.event} value={t.event}>
                        {EVENT_LABEL[t.event] ?? t.event}
                      </option>
                    ))}
                  </select>
                </Field>
              </FormGrid>
              <button
                className="btn"
                style={{ marginTop: 8 }}
                disabled={busy || !/^[6-9]\d{9}$/.test(mobile.replace(/\D/g, '').slice(-10))}
                onClick={sendTest}
              >
                {busy ? 'Sending…' : 'Send test SMS'}
              </button>
              {result && (
                <div data-sms-test-result style={{ marginTop: 8, color: result.ok ? 'var(--mint-ink, #0f766e)' : 'var(--red-ink, #b91c1c)' }}>
                  {result.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
