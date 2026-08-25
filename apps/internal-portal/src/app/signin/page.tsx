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
import { DEMO_PASSWORD, resetToEmpty } from '@/mocks/db';
import { ROLES } from '@/lib/permissions';
import { Field } from '@/lib/ui';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

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
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div className="surface" style={{ padding: 22 }}>
          <h1 style={{ fontSize: 18, marginBottom: 4 }}>Sign in</h1>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 18 }}>
            Nexraah operations console.
          </p>

          <form onSubmit={submit} noValidate>
            {/* `Field` renders its <label> without an htmlFor, so nothing
                ties it to the input for a screen reader. Naming these two
                explicitly is the narrow fix; giving every field in the app a
                properly associated label is a change to the shared component
                and its own piece of work. */}
            <Field label="Email" required>
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
            </Field>

            <Field label="Password" required>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type={reveal ? 'text' : 'password'}
                  name="password"
                  aria-label="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  style={{ flex: 'none', padding: '0 12px' }}
                >
                  {reveal ? '🙈' : '👁️'}
                </button>
              </div>
            </Field>

            {/* One line, above the button, in the place the eye already is
                after a failed attempt — not a toast that has faded by the
                time the password is retyped. */}
            {error && (
              <p
                role="alert"
                className="err"
                style={{ fontSize: 12.5, marginTop: 2, marginBottom: 10 }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn"
              style={{ width: '100%', marginTop: 6 }}
              disabled={busy || !email.trim() || !password}
            >
              {busy ? 'Signing in…' : 'Sign in'}
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
          <div className="surface" style={{ padding: 16, marginTop: 12 }}>
            <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
              Testing from scratch? This clears every seeded vendor, client, indent, trip, invoice,
              approval and RFQ so you can build your own data end to end. The six accounts above, the
              branch list and system config stay — you still need somewhere to sign in.
            </p>
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              disabled={cleared}
              onClick={() => {
                resetToEmpty();
                setCleared(true);
              }}
            >
              {cleared ? 'Cleared — sign in above to start building' : 'Start with a clean slate'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Present only with mocks on, where these six accounts are the only ones that
 * exist. Picking one *fills the form* rather than signing in: the password is
 * still checked, so the demo exercises the real path instead of routing around
 * it — which is exactly what the old one-click role buttons did wrong.
 */
function DemoAccounts({ onPick }: { onPick: (email: string) => void }) {
  return (
    <div className="surface" style={{ padding: 16, marginTop: 12 }}>
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
        Demo accounts — sample data only. Pick one to fill the form, then sign in. The password for
        all six is <strong>{DEMO_PASSWORD}</strong>.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mockAccounts().map((account) => (
          <button
            key={account.email}
            type="button"
            className="btn btn-secondary"
            style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 10 }}
            onClick={() => onPick(account.email)}
          >
            <span>{account.name}</span>
            <span className="muted" style={{ fontSize: 11 }}>
              {ROLES[account.role].label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
