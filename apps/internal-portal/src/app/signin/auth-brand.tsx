import type { ReactNode } from 'react';

/** Thin line icons, drawn in the logo's sky blue. */
const Icon = ({ children }: { children: ReactNode }) => (
  <span className="auth-point-icon" aria-hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  </span>
);

const POINTS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: (
      <>
        <path d="M3 7h11v9H3z" />
        <path d="M14 10h4l3 3v3h-7" />
        <circle cx="7" cy="17.5" r="1.8" />
        <circle cx="17" cy="17.5" r="1.8" />
      </>
    ),
    title: 'Every load, end to end',
    body: 'Ten steps, one place — from the first quote to the final payment.',
  },
  {
    icon: (
      <>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    title: 'Cleared before they carry',
    body: 'Compliance checks every transporter before a load reaches them.',
  },
  {
    icon: (
      <>
        <path d="M7 5h10M7 9h10M7 5c5 0 6 8 0 8l7 6" />
      </>
    ),
    title: 'Money, to the rupee',
    body: 'Advances, balances and receivables, tracked as they move.',
  },
];

/**
 * The brand side of the sign-in screen: the Nexraah logo itself — the
 * original artwork with its navy cut away, so it floats on the page with no
 * box around it — and what the console is for.
 */
export function AuthBrand() {
  return (
    <div className="auth-brand">
      <div className="auth-brand-head">
        <picture className="auth-logo-wrap">
          <source srcSet="/nexraah-logo.webp" type="image/webp" />
          <img
            src="/nexraah-logo.png"
            width={1000}
            height={1178}
            alt="Nexraah — Built to move. Born to deliver."
            className="auth-logo"
            decoding="async"
          />
        </picture>
        <div className="auth-brand-console">
          <span />
          Operations console
          <span />
        </div>
      </div>
      <ul className="auth-brand-points">
        {POINTS.map((p) => (
          <li key={p.title}>
            <Icon>{p.icon}</Icon>
            <div>
              <strong>{p.title}</strong>
              <span>{p.body}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="auth-brand-foot">Secure sign-in · one-time code to your work email</p>
    </div>
  );
}
