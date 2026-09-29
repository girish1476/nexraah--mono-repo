'use client';

/**
 * The console's sign-in screen.
 *
 * Replaces `/dev-login`, which was a row of buttons — one per role, no
 * password — backed by six JWTs hand-signed months earlier and pasted into
 * `lib/dev-tokens.ts`. Those tokens carried a fixed `exp` and had quietly
 * passed it, so every sign-in against a real internal-api failed with
 * "Invalid or expired token" and no indication that the cause was a stale
 * constant rather than anything the person had done.
 *
 * What happens on submit depends only on `NEXT_PUBLIC_USE_MOCKS`, and
 * `lib/auth.ts` owns that decision — with mocks off the password goes to
 * Supabase Auth, which issues the token internal-api verifies against JWKS
 * (part 14 §4.1). This screen never sees a token either way.
 */
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthError, isSignedIn, signIn } from '@/lib/auth';
import { MOCKS_ENABLED, mockAccounts } from '@/mocks';
import { DEMO_PASSWORD } from '@/mocks/db';
import { forgetSaved } from '@/mocks/persist';
import { ROLES } from '@/lib/permissions';
import { Field } from '@/lib/ui';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Someone who still holds a session has no business on this screen; send
  // them on rather than letting them sign in a second time over the top.
  useEffect(() => {
    if (isSignedIn()) router.replace('/');
  }, [router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      // router.push, not window.location — a hard navigation re-executes every
      // JS module, which would reset the mock adapter's in-memory `db` to its
      // seed data and throw away anything built during a test pass. '/' is
      // where SessionBootstrap decides which landing page this role gets.
      router.push('/');
    } catch (e) {
      setError(
        e instanceof AuthError || e instanceof Error
          ? e.message
          : 'Sign-in failed. Try again.',
      );
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="auth-brand-head">
          <div className="auth-brand-logo-plate">
            <img src="/logo.png" alt="" aria-hidden className="auth-brand-logo" />
          </div>
          <div>
            <div className="auth-brand-name">Nexraah</div>
            <div className="auth-brand-tag">Built to move. Born to deliver.</div>
          </div>
        </div>
        <ul className="auth-brand-points">
          <li>
            <span aria-hidden>🚚</span>
            <span>Every shipment, ten steps, one place — from the first quote to the final payment.</span>
          </li>
          <li>
            <span aria-hidden>🛡️</span>
            <span>Compliance clears every transporter before a load ever reaches them.</span>
          </li>
          <li>
            <span aria-hidden>💰</span>
            <span>Advances, balances and receivables tracked to the rupee.</span>
          </li>
        </ul>
      </div>
      <div className="auth-form-col">
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div className="surface auth-card">
          <p className="auth-card-eyebrow">Nexraah operations console</p>
          <h1>Welcome back</h1>
          <p className="auth-card-sub">Sign in with your work email to pick up where you left off.</p>

          <form onSubmit={submit} noValidate>
            {/* `Field` renders its <label> without an htmlFor, so nothing
                ties it to the input for a screen reader. Naming these two
                explicitly is the narrow fix; giving every field in the app a
                properly associated label is a change to the shared component
                and its own piece of work. */}
            <Field label="Email" required>
              <div className="auth-input-wrap">
                <span className="auth-input-icon" aria-hidden>✉️</span>
                <input
                  type="email"
                  name="email"
                  aria-label="Email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@nexraah.in"
                  disabled={busy}
                />
              </div>
            </Field>

            <Field label="Password" required>
              <div className="auth-input-wrap">
                <span className="auth-input-icon" aria-hidden>🔒</span>
                <input
                  type={reveal ? 'text' : 'password'}
                  name="password"
                  aria-label="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className="auth-input-has-toggle"
                />
                <button
                  type="button"
                  className="auth-input-toggle"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                >
                  {reveal ? '🙈' : '👁️'}
                </button>
              </div>
            </Field>

            {/* One line, above the button, in the place the eye already is
                after a failed attempt — not a toast that has faded by the
                time the password is retyped. */}
            {error && (
              <p role="alert" className="auth-error">
                <span aria-hidden>⚠️</span>
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-lg auth-submit"
              disabled={busy || !email.trim() || !password}
            >
              {busy ? 'Signing in…' : (
                <>
                  Sign in <span aria-hidden>→</span>
                </>
              )}
            </button>
          </form>
        </div>

        {MOCKS_ENABLED && (
          <DemoAccounts
            onPick={(pickedEmail) => {
              setEmail(pickedEmail);
              setPassword(DEMO_PASSWORD);
              setError(null);
            }}
          />
        )}

        {MOCKS_ENABLED && (
          <div className="surface auth-reset-panel">
            <p className="auth-reset-copy">
              <span aria-hidden>🧹</span>
              The console keeps what you do in this browser, so you can pick up where you left off. To begin again
              from a clean start — one client, one transporter and nothing else — clear it here. The demo accounts
              above and the system settings stay.
            </p>
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => {
                forgetSaved();
                window.location.reload();
              }}
            >
              Clear my work and start over
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/** Deterministic accent per role for the demo-account avatar — reuses the
 * console's own area hues rather than inventing new colour meaning. */
const ROLE_AVATAR_COLOR: Record<string, string> = {
  OPS: 'var(--area-desk)',
  COMPLIANCE: 'var(--area-supply)',
  FINANCE: 'var(--area-money)',
  BD: 'var(--area-biz)',
  LEADERSHIP: 'var(--area-control)',
  ADMIN: 'var(--area-control)',
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/**
 * Present only with mocks on, where these demo accounts are the only ones that
 * exist. Picking one *fills the form* rather than signing in: the password is
 * still checked, so the demo exercises the real path instead of routing around
 * it — which is exactly what the old one-click role buttons did wrong.
 */
function DemoAccounts({ onPick }: { onPick: (email: string) => void }) {
  return (
    <div className="surface auth-demo-panel">
      <p className="auth-demo-copy">
        Demo accounts — sample data only. Pick one to fill the form, then sign in. The password for
        every one of them is <strong>{DEMO_PASSWORD}</strong>.
      </p>
      <div className="auth-demo-list">
        {mockAccounts().map((account) => (
          <button
            key={account.email}
            type="button"
            className="auth-demo-card"
            onClick={() => onPick(account.email)}
          >
            <span
              className="auth-demo-avatar"
              style={{ background: ROLE_AVATAR_COLOR[account.role] ?? 'var(--color-accent)' }}
              aria-hidden
            >
              {initials(account.name)}
            </span>
            <span className="auth-demo-info">
              <span className="auth-demo-name">{account.name}</span>
              <span className="auth-demo-role">{ROLES[account.role].label}</span>
            </span>
            <span className="auth-demo-arrow" aria-hidden>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
