import { NextRequest, NextResponse } from 'next/server';
import { ROLE_CODES, SESSION_COOKIE, openSession, realEmailConfigured, type SignInRole } from '@/lib/server/sign-in-code';
import {
  allowedPerson,
  fixedPeople,
  isFixedPerson,
  listStoredPeople,
  peopleStoreConfigured,
  saveStoredPerson,
  storedPerson,
} from '@/lib/server/people-store';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Only an administrator, as the server itself knows them: the session cookie
 * set when their code was accepted, and the role looked up again now.
 */
async function administrator(request: NextRequest): Promise<NextResponse | null> {
  if (!realEmailConfigured() || !peopleStoreConfigured()) {
    return json({ error: 'The shared list of people is not set up on this deployment.' }, 503);
  }
  const email = openSession(process.env.SIGNIN_SECRET as string, request.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return json({ error: 'Sign out and sign in again, then repeat this.' }, 401);
  const me = await allowedPerson(email);
  if (!me || me.role !== 'ADMIN') return json({ error: 'Only administrators manage sign-in access.' }, 403);
  return null;
}

/**
 * GET /api/people — everyone who may sign in: the people on the server's own
 * list (SIGNIN_PEOPLE, marked `fixed`) and the people administrators added.
 */
export async function GET(request: NextRequest) {
  try {
    const refused = await administrator(request);
    if (refused) return refused;
    const fixed = fixedPeople();
    const stored = (await listStoredPeople()).filter((p) => !fixed.some((f) => f.email === p.email));
    return json({
      people: [
        ...fixed.map((p) => ({ ...p, branch: null, phone: null, disabled: false, fixed: true })),
        ...stored.map((p) => ({ ...p, fixed: false })),
      ],
    });
  } catch (e) {
    console.error('[people] list failed:', (e as Error).message);
    return json({ error: 'The list of people could not be read. Try again in a minute.' }, 502);
  }
}

/**
 * PUT /api/people { email, role, name?, branch?, phone?, disabled? } — allow
 * an email, change it, or switch it off. Someone on SIGNIN_PEOPLE is changed
 * there, not here.
 */
export async function PUT(request: NextRequest) {
  try {
    const refused = await administrator(request);
    if (refused) return refused;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (isFixedPerson(email)) {
      return json(
        { error: `${email} is on the deployment's own list (SIGNIN_PEOPLE). Their access is changed there, not on this screen.` },
        409,
      );
    }
    const role = String(body.role ?? '').toUpperCase() as SignInRole;
    if (!ROLE_CODES.includes(role)) {
      return json(
        { error: 'A role added from Access control cannot sign in by email yet. Choose one of the built-in roles.' },
        400,
      );
    }
    const existing = await storedPerson(email);
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null);
    await saveStoredPerson({
      email,
      role,
      name: text(body.name) ?? existing?.name ?? email.split('@')[0],
      branch: body.branch === undefined ? (existing?.branch ?? null) : text(body.branch),
      phone: body.phone === undefined ? (existing?.phone ?? null) : text(body.phone),
      disabled: body.disabled === true,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    });
    return json({ ok: true });
  } catch (e) {
    console.error('[people] save failed:', (e as Error).message);
    return json({ error: 'The change could not be saved for sign-in. Try again in a minute.' }, 502);
  }
}
