'use client';

/**
 * Prototype-only, same footing as `?devToken=` (`providers.tsx`) and the
 * `X-Debug-Role` switcher (`shell.tsx`) — stands in for real sign-in until
 * Supabase Auth lands, then all three get deleted together.
 *
 * `?devToken=<jwt>` puts the whole token in the URL, and a URL that long
 * (several hundred characters) is exactly the kind of thing chat apps and
 * link previewers silently truncate or strip before it ever reaches a
 * browser — the failure then looks identical to a real auth error
 * ("Missing bearer token"), with nothing pointing at the actual cause. This
 * page removes the copy step entirely: the tokens live in this file, and
 * signing in is one click.
 */
import { DEV_TOKENS } from '@/lib/dev-tokens';
import { ROLE_CODES } from '@/lib/permissions';

function signIn(token: string) {
  localStorage.setItem('token', token);
  localStorage.removeItem('role');
  window.location.href = '/';
}

export default function DevLoginPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div className="surface" style={{ padding: 22 }}>
          <h1 style={{ fontSize: 18, marginBottom: 4 }}>Sign in</h1>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 18 }}>
            Prototype sign-in — pick a seat. No password; this stands in for Supabase Auth until that lands.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ROLE_CODES.map((code) => (
              <button
                key={code}
                className="btn btn-secondary"
                style={{ justifyContent: 'space-between', display: 'flex', width: '100%' }}
                onClick={() => signIn(DEV_TOKENS[code].token)}
              >
                <span>{DEV_TOKENS[code].name}</span>
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {code}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
