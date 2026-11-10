'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { Dialog, Field, Panel, useCan, useToast } from '@/lib/ui';
import { createPortalLogin, getPortalLogin, PortalLoginIssued, resetPortalLogin } from '../apis';

/**
 * The transporter's portal login — the email they sign in with, made or reset
 * by the desk that clears them (`vendor.activate`).
 *
 * Activation makes one when the transporter has an email; this is where it is
 * made otherwise, and where a forgotten password is reset. A new password is
 * shown here once — it cannot be read back — and emailed to the transporter
 * when email is set up on the server.
 */
export function PortalLoginPanel({ vendorId, vendorEmail, refreshKey }: { vendorId: string; vendorEmail: string | null; refreshKey?: unknown }) {
  const can = useCan();
  const toast = useToast();
  const manage = can('vendor.activate');
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [address, setAddress] = useState(vendorEmail ?? '');
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<PortalLoginIssued | null>(null);

  const load = () => {
    setError(null);
    getPortalLogin(vendorId)
      .then((r) => setEmail(r.email))
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [vendorId, refreshKey]);

  const run = async (action: () => Promise<PortalLoginIssued>) => {
    setBusy(true);
    try {
      const result = await action();
      setIssued(result);
      setCreating(false);
      setConfirmReset(false);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Transporter portal login">
      <div data-portal-login style={{ display: 'grid', gap: 10, fontSize: 13 }}>
        {error && <div className="muted">{error}</div>}
        {email === undefined && !error && <div className="muted">Checking…</div>}
        {email === null && <div>No login yet — this transporter cannot sign in to the portal.</div>}
        {email && (
          <div>
            Signs in as <strong className="mono">{email}</strong>
          </div>
        )}
        {manage && email !== undefined && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {email === null ? (
              <button className="btn btn-sm" onClick={() => setCreating(true)}>
                Create portal login
              </button>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmReset(true)}>
                Reset password
              </button>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={creating}
        title="Create a portal login"
        body="The transporter signs in to the portal with this email and a password made now. You will see the password once; it is also emailed to them when email is set up."
        confirmLabel="Create login"
        confirmDisabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address.trim())}
        busy={busy}
        onConfirm={() => run(() => createPortalLogin(vendorId, address.trim()))}
        onClose={() => setCreating(false)}
      >
        <Field label="Email they sign in with" required>
          <input name="portal-login-email" type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="accounts@transporter.in" />
        </Field>
      </Dialog>

      <Dialog
        open={confirmReset}
        title="Reset the portal password?"
        body="Their current password stops working at once. A new one is made, shown to you once, and emailed to them when email is set up."
        confirmLabel="Reset password"
        busy={busy}
        onConfirm={() => run(() => resetPortalLogin(vendorId))}
        onClose={() => setConfirmReset(false)}
      />

      <Dialog
        open={!!issued}
        title="Portal sign-in details"
        body={
          issued?.emailed
            ? 'Emailed to the transporter. This password is shown only now.'
            : 'Email is not set up, so nothing was sent — pass these on privately. This password is shown only now.'
        }
        confirmLabel="Copy and close"
        onConfirm={async () => {
          if (issued) await navigator.clipboard?.writeText(`Email: ${issued.email}\nPassword: ${issued.temporaryPassword}`).catch(() => {});
          setIssued(null);
          toast('Sign-in details copied');
        }}
        onClose={() => setIssued(null)}
      >
        {issued && (
          <div data-portal-login-issued style={{ display: 'grid', gap: 6, fontSize: 14 }}>
            <div>
              Email: <strong className="mono">{issued.email}</strong>
            </div>
            <div>
              Password: <strong className="mono">{issued.temporaryPassword}</strong>
            </div>
          </div>
        )}
      </Dialog>
    </Panel>
  );
}
