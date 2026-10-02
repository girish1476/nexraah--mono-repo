'use client';

/**
 * The console's sign-in screen — email and a one-time code, no password.
 *
 * Step 1 asks for the work email and has Supabase email a one-time code to
 * it. Only emails an administrator added under Settings → Allowed emails can
 * get one; anyone else is told so before any email is sent. Step 2 takes the
 * code and signs in, with the role the administrator chose for that email.
 *
 * What happens on submit depends only on `NEXT_PUBLIC_USE_MOCKS`, and
 * `lib/auth.ts` owns that decision — with mocks off the code comes from
 * Supabase Auth, which issues the token internal-api verifies against JWKS
 * (part 14 §4.1). This screen never sees a token either way.
 */
import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthError, isSignedIn, sendSignInCode, verifySignInCode } from '@/lib/auth';
import { MOCKS_ENABLED, mockAccounts } from '@/mocks';
import { DEMO_CODE } from '@/mocks/db';
import { forgetSaved } from '@/mocks/persist';
import { ROLES } from '@/lib/permissions';
import { Field } from '@/lib/ui';
import { AuthBrand } from './auth-brand';

const CODE_LENGTH = 6;
/** Seconds before "Send a new code" is offered again — Supabase rate-limits resends anyway. */
const RESEND_AFTER_S = 60;

export default function SignInPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Someone who still holds a session has no business on this screen; send
  // them on rather than letting them sign in a second time over the top.
  useEffect(() => {
    if (isSignedIn()) router.replace('/');
  }, [router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const message = (e: unknown) =>
    e instanceof AuthError || e instanceof Error ? e.message : 'Sign-in failed. Try again.';

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendSignInCode(email);
      setStep('code');
      setDigits(Array(CODE_LENGTH).fill(''));
      setResendIn(RESEND_AFTER_S);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (code: string) => {
    if (busy || code.length < CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await verifySignInCode(email, code);
      // router.push, not window.location — a hard navigation re-executes every
      // JS module, which would reset the mock adapter's in-memory `db` to its
      // seed data and throw away anything built during a test pass. '/' is
      // where SessionBootstrap decides which landing page this role gets.
      router.push('/');
    } catch (e) {
      setError(message(e));
      setDigits(Array(CODE_LENGTH).fill(''));
      setShake(true);
      setTimeout(() => setShake(false), 450);
      setBusy(false);
    }
  };

  const onDigits = (next: string[]) => {
    setDigits(next);
    if (error) setError(null);
    // Submit the moment the last digit lands — no extra click.
    if (next.every((d) => d)) void verify(next.join(''));
  };

  return (
    <div className="auth-shell">
      <AuthBrand />
      <div className="auth-form-col">
        <div style={{ maxWidth: 440, width: '100%' }}>
          <div className="surface auth-card">
            <p className="auth-card-eyebrow">{step === 'email' ? 'Sign in' : 'Step 2 of 2 · verify'}</p>
            <h1>{step === 'email' ? 'Welcome back' : 'Enter your code'}</h1>

            {step === 'email' ? (
              <>
                <p className="auth-card-sub">
                  Enter your work email and we’ll send a one-time code to it. No password to remember.
                </p>
                <form onSubmit={sendCode} noValidate>
                  <Field label="Work email" required>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon" aria-hidden>✉️</span>
                      <input
                        type="email"
                        name="email"
                        aria-label="Work email"
                        autoComplete="email"
                        autoFocus
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@nexraah.in"
                        disabled={busy}
                      />
                    </div>
                  </Field>

                  {error && <ErrorLine text={error} />}

                  <button type="submit" className="btn btn-lg auth-submit" disabled={busy || !email.trim()}>
                    {busy ? 'Sending code…' : <>Send me a code <span aria-hidden>→</span></>}
                  </button>
                </form>
                <p className="auth-foot">Only emails your administrator has allowed can sign in.</p>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify(digits.join(''));
                }}
                noValidate
              >
                <p className="auth-sent-to">
                  <span aria-hidden>📨</span>
                  <span>
                    Code sent to <strong>{email.trim().toLowerCase()}</strong>. Check your inbox (and spam). It works once
                    and expires soon.
                  </span>
                </p>

                <OtpBoxes digits={digits} onChange={onDigits} disabled={busy} shake={shake} />

                {error && <ErrorLine text={error} />}

                <button type="submit" className="btn btn-lg auth-submit" disabled={busy || digits.some((d) => !d)}>
                  {busy ? 'Signing in…' : <>Sign in <span aria-hidden>→</span></>}
                </button>

                <div className="auth-links">
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => {
                      setStep('email');
                      setError(null);
                    }}
                    disabled={busy}
                  >
                    ← Change email
                  </button>
                  <button type="button" className="auth-link" onClick={() => sendCode()} disabled={busy || resendIn > 0}>
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {MOCKS_ENABLED && (
            <DemoAccounts
              onPick={(pickedEmail) => {
                setEmail(pickedEmail);
                setStep('email');
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

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="auth-error">
      <span aria-hidden>⚠️</span>
      {text}
    </p>
  );
}

/**
 * One box per digit. Typing moves forward, Backspace moves back, arrows move
 * freely, and pasting the code from the email fills every box at once.
 */
function OtpBoxes({
  digits,
  onChange,
  disabled,
  shake,
}: {
  digits: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  shake: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => refs.current[Math.max(0, Math.min(digits.length - 1, i))]?.focus();

  // Back to the first box whenever the code is cleared (new code, wrong code).
  useEffect(() => {
    if (digits.every((d) => !d)) focus(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits.join('')]);

  const fill = (from: number, text: string) => {
    const clean = text.replace(/\D/g, '').slice(0, digits.length - from);
    if (!clean) return;
    const next = [...digits];
    clean.split('').forEach((d, k) => (next[from + k] = d));
    onChange(next);
    focus(from + clean.length);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...digits];
      if (next[i]) {
        next[i] = '';
        onChange(next);
      } else if (i > 0) {
        next[i - 1] = '';
        onChange(next);
        focus(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      focus(i + 1);
    }
  };

  return (
    <div className={`auth-otp${shake ? ' shake' : ''}`} role="group" aria-label="Sign-in code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={d ? 'filled' : undefined}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={digits.length}
          value={d}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) return;
            // Typing over a filled box replaces its digit; anything longer is a
            // phone's one-time-code autofill dropping the whole code into one box.
            fill(i, d && v.length === 2 ? v.slice(-1) : v);
          }}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
            e.preventDefault();
            fill(i, e.clipboardData.getData('text'));
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

/** Deterministic accent per role for the demo-account avatar. */
const ROLE_AVATAR_COLOR: Record<string, string> = {
  OPS: '#2196e6',
  COMPLIANCE: '#14b8a6',
  FINANCE: '#f59e0b',
  BD: '#a855f7',
  LEADERSHIP: '#ef4444',
  ADMIN: '#6366f1',
  LOADING_SUPERVISOR: '#64748b',
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/**
 * Present only with mocks on, where these demo accounts are the only ones that
 * exist and no email is really sent. Picking one *fills the email* rather than
 * signing in: the code is still checked, so the demo exercises the real path.
 */
function DemoAccounts({ onPick }: { onPick: (email: string) => void }) {
  return (
    <div className="surface auth-demo-panel">
      <p className="auth-demo-copy">
        Demo mode — no email is sent. Pick an account, press “Send me a code”, then enter{' '}
        <strong>{DEMO_CODE}</strong>.
      </p>
      <div className="auth-demo-list">
        {mockAccounts().map((account) => (
          <button key={account.email} type="button" className="auth-demo-card" onClick={() => onPick(account.email)}>
            <span
              className="auth-demo-avatar"
              style={{ background: ROLE_AVATAR_COLOR[account.role] ?? '#2196e6' }}
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
