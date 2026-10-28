import { NextRequest, NextResponse } from 'next/server';
import { allowedPerson, peopleStoreConfigured } from './people-store';
import { SESSION_COOKIE, openSession, realEmailConfigured } from './sign-in-code';

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * The administrator making this request, as the server itself knows them: the
 * session cookie set when their sign-in code was accepted, and their role
 * looked up again now. Anything else gets the refusal to send back.
 */
/**
 * With the real backend (`NEXT_PUBLIC_USE_MOCKS=0`) sign-in goes to Supabase,
 * not to this server, so there is no `nx_session` cookie to read. The browser
 * sends its Supabase token instead, and the backend — which already knows who
 * holds it and in what role (`GET /auth/session`) — is asked. Nothing about the
 * token is trusted here that the backend has not checked.
 */
async function administratorFromBackend(authorization: string): Promise<{ email: string } | { refused: NextResponse }> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { refused: json({ error: 'NEXT_PUBLIC_API_BASE_URL is not set on this deployment.' }, 503) };
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/auth/session`, {
      headers: { Authorization: authorization },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { refused: json({ error: 'The server could not be reached to check who you are. Try again in a minute.' }, 502) };
  }
  if (response.status === 401) return { refused: json({ error: 'Sign out and sign in again, then repeat this.' }, 401) };
  if (!response.ok) return { refused: json({ error: 'Who you are could not be checked just now. Try again in a minute.' }, 502) };
  const body = (await response.json().catch(() => ({}))) as { data?: { role?: string; email?: string } };
  if (body.data?.role !== 'ADMIN') return { refused: json({ error: 'Only administrators manage integrations.' }, 403) };
  return { email: String(body.data.email ?? '') };
}

export async function administrator(request: NextRequest): Promise<{ email: string } | { refused: NextResponse }> {
  const authorization = request.headers.get('authorization');
  if (process.env.NEXT_PUBLIC_USE_MOCKS === '0' && authorization?.startsWith('Bearer ')) {
    return administratorFromBackend(authorization);
  }
  if (!realEmailConfigured() || !peopleStoreConfigured()) {
    return { refused: json({ error: 'This needs sign-in by email and the shared database, which are not both set up on this deployment.' }, 503) };
  }
  const email = openSession(process.env.SIGNIN_SECRET as string, request.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return { refused: json({ error: 'Sign out and sign in again, then repeat this.' }, 401) };
  const me = await allowedPerson(email);
  if (!me || me.role !== 'ADMIN') return { refused: json({ error: 'Only administrators manage integrations.' }, 403) };
  return { email };
}
