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
import { FormEvent, useEffect, useRef, useState } from 'react';
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
  // False until this page's script is running — see the effect below.
  const [ready, setReady] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Already signed in — skip the form rather than making someone sign in twice.
  useEffect(() => {
    if (isSignedIn()) router.replace('/loads');
  }, [router]);

  // The form arrives as plain HTML before its script runs. On a slow phone a
  // transporter can type their email and password in that gap, and so can a
  // password manager — the boxes show the text but the form never heard it,
  // and "Sign in" answered "Enter your email and password." Take over whatever
  // is already in the boxes the moment the script starts.
  //
  // Pressing "Sign in" in that same gap was worse: with no script to stop it
  // the browser sent the form itself, as a GET, and the password landed in the
  // address bar, the phone's history and the site's request logs
  // (`/signin?email=…&password=…`). So the button stays disabled until the
  // script runs — a disabled default button also blocks Enter-to-submit — the
  // form says POST should anything still slip through, and a URL that already
  // carries a password from an older copy of this page is wiped from history.
  useEffect(() => {
    if (emailRef.current?.value) setEmail(emailRef.current.value);
    if (passwordRef.current?.value) setPassword(passwordRef.current.value);
    if (window.location.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.has('password') || params.has('email')) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    setReady(true);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // What is in the boxes is what the person sees — trust that over state
    // that an autofill without an input event may have left behind.
    const typedEmail = emailRef.current?.value ?? email;
    const typedPassword = passwordRef.current?.value ?? password;
    setBusy(true);
    setError(null);
    try {
      await signIn(typedEmail, typedPassword);
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

        <form onSubmit={submit} method="post" noValidate>
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
            ref={emailRef}
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
              ref={passwordRef}
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

          <button type="submit" className="signin-submit tap" disabled={busy || !ready}>
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
