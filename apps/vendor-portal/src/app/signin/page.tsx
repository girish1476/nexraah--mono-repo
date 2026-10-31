'use client';

/**
 * The transporter's front door.
 *
 * Until now this app had none: `apis.ts` read `localStorage.token`, nothing
 * ever wrote it, and its 401 handler pointed at a commented-out `/login` that
 * did not exist. That is survivable only while the fixture adapter ignores
 * auth — against a real `vendor-api` every request is a 401 with nowhere to go.
 *
 * Written for the person actually holding the phone: a fleet owner or driver,
 * often at a loading dock, frequently in a second language. They sign in with
 * the email and password Nexraah gave them (`provision.mjs` makes the login).
 */
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthError, DEMO_LOGIN, isSignedIn, signIn } from '@/lib/auth';
import { USE_MOCK } from '@/lib/mock';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in — skip the form rather than making someone sign in twice.
  useEffect(() => {
    if (isSignedIn()) router.replace('/loads');
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace('/loads');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not sign you in. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="signin-shell">
      <div className="signin-brand-panel">
        <img src="/logo.png" alt="" aria-hidden className="signin-brand-panel-logo" />
        <div className="signin-brand-panel-name">Nexraah</div>
        <div className="signin-brand-panel-tag">Built to move. Born to deliver.</div>
        <ul className="signin-brand-panel-points">
          <li>
            <span aria-hidden>📦</span>
            <span>Loads matched to the truck types you run, with a clear price range before you quote.</span>
          </li>
          <li>
            <span aria-hidden>📝</span>
            <span>Upload your delivery proof and get paid without chasing anyone.</span>
          </li>
          <li>
            <span aria-hidden>🚛</span>
            <span>Your trips, your fleet, your billing — all in one place.</span>
          </li>
        </ul>
      </div>
      <main className="screen signin-screen">
      <div className="signin-card">
        <div className="signin-brand">
          <span className="signin-mark" aria-hidden>
            🚚
          </span>
          <div>
            <h1>Nexraah</h1>
            <p className="signin-sub">For transporters carrying our loads</p>
          </div>
        </div>

        <form onSubmit={submit} noValidate>
          <label className="signin-label" htmlFor="email">
            Your email
          </label>
          <input
            id="email"
            name="email"
            className="field"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="accounts@transporter.in"
            aria-describedby="email-hint"
          />
          <p id="email-hint" className="signin-hint">
            The address Nexraah set up your login with.
          </p>

          <label className="signin-label" htmlFor="password">
            Password
          </label>
          <div className="signin-password">
            <input
              id="password"
              name="password"
              className="field"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* Typing a password blind on a phone keyboard is where most
                failed sign-ins actually come from. */}
            <button
              type="button"
              className="signin-reveal tap"
              onClick={() => setReveal((v) => !v)}
              aria-pressed={reveal}
            >
              {reveal ? 'Hide' : 'Show'}
            </button>
          </div>

          {error && (
            <p className="signin-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="signin-submit tap" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {USE_MOCK && (
          /* Demo builds only. A real deployment sets NEXT_PUBLIC_MOCK=0 and
             this disappears with it, so no credential is ever printed on a
             screen that talks to a real backend. */
          <div className="signin-demo">
            <p className="signin-demo-title">Demo login</p>
            <p>
              Email <strong>{DEMO_LOGIN.email}</strong> · password{' '}
              <strong>{DEMO_LOGIN.password}</strong>
            </p>
            <button
              type="button"
              className="tap signin-demo-fill"
              onClick={() => {
                setEmail(DEMO_LOGIN.email);
                setPassword(DEMO_LOGIN.password);
              }}
            >
              Fill it in for me
            </button>
          </div>
        )}

        <p className="signin-help">
          No login yet, or forgotten your password? Call your Nexraah contact — logins are
          created by them, not here.
        </p>
      </div>
      </main>
    </div>
  );
}
