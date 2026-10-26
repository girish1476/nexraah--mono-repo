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
export async function administrator(request: NextRequest): Promise<{ email: string } | { refused: NextResponse }> {
  if (!realEmailConfigured() || !peopleStoreConfigured()) {
    return { refused: json({ error: 'This needs sign-in by email and the shared database, which are not both set up on this deployment.' }, 503) };
  }
  const email = openSession(process.env.SIGNIN_SECRET as string, request.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return { refused: json({ error: 'Sign out and sign in again, then repeat this.' }, 401) };
  const me = await allowedPerson(email);
  if (!me || me.role !== 'ADMIN') return { refused: json({ error: 'Only administrators manage integrations.' }, 403) };
  return { email };
}
