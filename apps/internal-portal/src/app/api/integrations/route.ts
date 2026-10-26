import { NextRequest, NextResponse } from 'next/server';
import { integrationById, type IntegrationId } from '@/lib/integrations';
import { administrator } from '@/lib/server/admin-session';
import { SettingRefused, integrationStates, integrationsStoreReady, saveIntegration } from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';
// A change to sign-in email sends a test email before it is saved.
export const maxDuration = 30;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** GET /api/integrations — every outside service and how it is set. Administrators only; keys come back as a hint. */
export async function GET(request: NextRequest) {
  const who = await administrator(request);
  if ('refused' in who) return who.refused;
  try {
    return json({ integrations: await integrationStates(), canSave: integrationsStoreReady() });
  } catch (e) {
    console.error('[integrations] read failed:', (e as Error).message);
    return json({ error: 'The settings could not be read. Try again in a minute.' }, 502);
  }
}

const strings = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<
    string,
    string
  >;
};

/**
 * PUT /api/integrations { id, enabled?, values?, secrets? } — switch a service
 * on or off, or change its settings. An empty string puts a setting back to
 * the deployment's own.
 */
export async function PUT(request: NextRequest) {
  const who = await administrator(request);
  if ('refused' in who) return who.refused;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? '');
  if (!integrationById(id)) return json({ error: 'There is no such integration.' }, 400);
  try {
    const integration = await saveIntegration(
      id as IntegrationId,
      {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        values: strings(body.values),
        secrets: strings(body.secrets),
      },
      who.email,
    );
    console.info(`[integrations] ${id} changed by ${who.email}`);
    return json({ integration });
  } catch (e) {
    if (e instanceof SettingRefused) return json({ error: e.message }, 400);
    console.error('[integrations] save failed:', (e as Error).message);
    return json({ error: 'The change could not be saved. Try again in a minute.' }, 502);
  }
}
