import { NextRequest, NextResponse } from 'next/server';
import { integrationById, type IntegrationId } from '@/lib/integrations';
import { administrator } from '@/lib/server/admin-session';
import { testIntegration } from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';
// The fuel check can go down its list of sources.
export const maxDuration = 30;

/** POST /api/integrations/test { id } — tries one service for real. Administrators only. */
export async function POST(request: NextRequest) {
  const who = await administrator(request);
  if ('refused' in who) return who.refused;
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = String(body.id ?? '');
  if (!integrationById(id)) {
    return NextResponse.json({ error: 'There is no such integration.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const result = await testIntegration(id as IntegrationId, who.email);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
