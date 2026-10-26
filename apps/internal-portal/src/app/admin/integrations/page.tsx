'use client';

import './integrations.css';

import { useEffect, useState } from 'react';
import { forgetIntegrationSwitches } from '@/lib/integration-switches';
import { INTEGRATIONS, type IntegrationDef, type IntegrationField, type IntegrationState } from '@/lib/integrations';
import { fmtDateTime } from '@/lib/format';
import { Banner, Glyph, Loading, ModuleGuard, PageHeader, PageIntro, Tag, useCan, useToast } from '@/lib/ui';

/**
 * Integrations — `/admin/integrations` · `config.manage`.
 *
 * Every outside service the console talks to, on one screen: what it is for,
 * whether it is on, its key, and a button that tries it for real. The settings
 * are kept on the server (app/api/integrations), so every administrator sees
 * the same ones and every browser follows the switches within a minute.
 */

interface Loaded {
  integrations: IntegrationState[];
  canSave: boolean;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `The server answered ${response.status}.`);
  return payload;
}

export default function IntegrationsPage() {
  const can = useCan();
  const editable = can('config.manage');
  const [data, setData] = useState<Loaded | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const load = () => {
    setRefusal(null);
    call<Loaded>('/api/integrations')
      .then(setData)
      .catch((e) => setRefusal((e as Error).message));
  };
  useEffect(load, []);

  const replace = (next: IntegrationState) =>
    setData((d) => (d ? { ...d, integrations: d.integrations.map((i) => (i.id === next.id ? next : i)) } : d));

  const states = data?.integrations ?? [];
  const off = states.filter((s) => !s.enabled).length;
  const attention = states.filter((s) => s.enabled && (!s.ready || s.lastTest?.ok === false)).length;

  return (
    <ModuleGuard module="admin">
      <PageHeader
        title="Integrations"
        sub="Every outside service the console uses — its key, whether it is on, and a test that it answers."
        module="admin"
        badge={
          data && (
            <Tag tone={attention ? 'flag' : 'mint'} emoji={attention ? '⚠️' : '✅'}>
              {attention ? `${attention} need a look` : 'All working'}
              {off ? ` · ${off} switched off` : ''}
            </Tag>
          )
        }
      />
      <PageIntro
        what="A key saved here is used first. With nothing saved, the console uses the setting in Vercel, as before — so a wrong key typed here never stops sign-in."
        who="Administrators only. A saved key is stored encrypted and never shown again: you see its last four characters."
      >
        A switch takes effect for everyone within a minute. Switching a service off takes its button or lookup away; the
        rest of the screen keeps working.
      </PageIntro>

      {refusal && (
        <Banner tone="flag" title="The settings could not be loaded" right={<button className="btn btn-secondary btn-sm" onClick={load}>Try again</button>}>
          {refusal} The services below are shown as the console uses them; nothing can be changed until this is sorted.
        </Banner>
      )}
      {!data && !refusal && <Loading what="Loading integrations" />}

      {(data || refusal) && (
        <div className="integ-grid">
          {INTEGRATIONS.map((def) => (
            <IntegrationCard
              key={def.id}
              def={def}
              state={states.find((s) => s.id === def.id) ?? null}
              canSave={!!data?.canSave && editable}
              onChanged={replace}
            />
          ))}
        </div>
      )}
    </ModuleGuard>
  );
}

function statusOf(state: IntegrationState | null): { tone: 'mint' | 'flag' | 'red' | 'grey'; label: string } {
  if (!state) return { tone: 'grey', label: 'Not known' };
  if (!state.enabled) return { tone: 'grey', label: 'Switched off' };
  if (!state.ready) return { tone: 'flag', label: 'Needs setting up' };
  if (state.lastTest && !state.lastTest.ok) return { tone: 'red', label: 'Last test failed' };
  return { tone: 'mint', label: 'On' };
}

const SOURCE_NOTE: Record<'here' | 'host', string> = {
  here: 'Saved here',
  host: 'From the Vercel settings',
};

function IntegrationCard({
  def,
  state,
  canSave,
  onChanged,
}: {
  def: IntegrationDef;
  state: IntegrationState | null;
  canSave: boolean;
  onChanged: (next: IntegrationState) => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'switch' | 'test' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tested, setTested] = useState<IntegrationState['lastTest']>(null);
  /** Keys made on this screen, by field, until saved. */
  const [made, setMade] = useState<Record<string, string>>({});
  // This console's own address, for the setup steps — known only in the browser.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const makeKey = (key: string) => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[b % 56]).join('');
    setMade((m) => ({ ...m, [key]: value }));
    setSecrets((s) => ({ ...s, [key]: value }));
  };

  // A fresh copy from the server replaces whatever was typed.
  useEffect(() => {
    setValues(state?.values ?? {});
    setSecrets({});
    setMade({});
  }, [state]);

  const status = statusOf(state);
  const lastTest = tested ?? state?.lastTest ?? null;
  const changed =
    !!state &&
    (Object.values(secrets).some((v) => v.trim()) ||
      def.fields.some((f) => !f.secret && (values[f.key] ?? '') !== (state.values[f.key] ?? '')));

  const save = async (body: Record<string, unknown>, kind: 'save' | 'switch', done: string) => {
    setBusy(kind);
    setProblem(null);
    try {
      const { integration } = await call<{ integration: IntegrationState }>('/api/integrations', {
        method: 'PUT',
        body: JSON.stringify({ id: def.id, ...body }),
      });
      forgetIntegrationSwitches();
      setTested(null);
      onChanged(integration);
      toast(done);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveFields = () => {
    const changedValues = Object.fromEntries(
      def.fields.filter((f) => !f.secret && (values[f.key] ?? '') !== (state?.values[f.key] ?? '')).map((f) => [f.key, values[f.key] ?? '']),
    );
    const newSecrets = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim()));
    void save({ values: changedValues, secrets: newSecrets }, 'save', `${def.name}: saved`);
  };

  const backToHost = (field: IntegrationField) =>
    void save(
      field.secret ? { secrets: { [field.key]: '' } } : { values: { [field.key]: '' } },
      'save',
      `${def.name}: ${field.label.toLowerCase()} now comes from the Vercel settings`,
    );

  const test = async () => {
    setBusy('test');
    setProblem(null);
    try {
      const result = await call<{ ok: boolean; message: string }>('/api/integrations/test', {
        method: 'POST',
        body: JSON.stringify({ id: def.id }),
      });
      setTested({ at: new Date().toISOString(), ...result });
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="surface integ-card" aria-labelledby={`integ-${def.id}`} data-testid={`integration-${def.id}`}>
      <header className="integ-head">
        <Glyph size={22} chip>
          {def.emoji}
        </Glyph>
        <div className="integ-title">
          <h2 id={`integ-${def.id}`}>{def.name}</h2>
          <div className="muted">{def.provider}</div>
        </div>
        <Tag tone={status.tone}>{status.label}</Tag>
      </header>

      <div className="integ-body">
        <p className="integ-what">{def.what}</p>
        <dl className="integ-facts">
          <div>
            <dt>Used on</dt>
            <dd>{def.where}</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>{def.cost}</dd>
          </div>
        </dl>

        {def.canSwitchOff && state && (
          <div className="integ-switch-row">
            <button
              type="button"
              role="switch"
              aria-checked={state.enabled}
              aria-label={`${def.name} on`}
              className={state.enabled ? 'integ-switch is-on' : 'integ-switch'}
              disabled={!canSave || busy !== null}
              onClick={() =>
                save(
                  { enabled: !state.enabled },
                  'switch',
                  `${def.name} switched ${state.enabled ? 'off' : 'on'} — for everyone within a minute`,
                )
              }
            >
              <span className="integ-switch-knob" aria-hidden />
            </button>
            <div>
              <strong>{state.enabled ? 'On' : 'Off'}</strong>
              {def.offMeans && <div className="muted integ-small">Off: {def.offMeans}</div>}
            </div>
          </div>
        )}

        {def.setup && (
          <details className="integ-setup">
            <summary>How to connect it</summary>
            <ol>
              {def.setup.map((step) => (
                <li key={step}>{step.replace(/\{origin\}/g, origin)}</li>
              ))}
            </ol>
          </details>
        )}

        {def.hostOnly && (
          <p className="muted integ-small">
            {state?.missing ?? 'Set up in Vercel → Storage, so there is nothing to change here. The test below checks that it answers.'}
          </p>
        )}

        {def.fields.length > 0 && state && (
          <div className="integ-fields">
            {def.fields.map((field) => {
              const source = field.secret ? state.secrets[field.key]?.source : state.sources[field.key];
              return (
                <div className="field" key={field.key}>
                  <label htmlFor={`integ-${def.id}-${field.key}`}>{field.label}</label>
                  {field.options ? (
                    <select
                      id={`integ-${def.id}-${field.key}`}
                      value={values[field.key] ?? ''}
                      disabled={!canSave}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    >
                      <option value="">Not chosen</option>
                      {field.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : field.secret ? (
                    <input
                      id={`integ-${def.id}-${field.key}`}
                      // A key made here is shown until it is saved, so it can be copied to the devices.
                      type={made[field.key] && secrets[field.key] === made[field.key] ? 'text' : 'password'}
                      autoComplete="off"
                      spellCheck={false}
                      value={secrets[field.key] ?? ''}
                      disabled={!canSave}
                      placeholder={state.secrets[field.key]?.set ? 'Paste a new key to replace the one in use' : field.placeholder}
                      onChange={(e) => setSecrets((s) => ({ ...s, [field.key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      id={`integ-${def.id}-${field.key}`}
                      value={values[field.key] ?? ''}
                      disabled={!canSave}
                      spellCheck={false}
                      placeholder={field.placeholder}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    />
                  )}
                  <span className="muted integ-small integ-source">
                    {field.secret && state.secrets[field.key]?.set && (
                      <span className="integ-hint">In use: {state.secrets[field.key]?.hint}</span>
                    )}
                    {source ? SOURCE_NOTE[source] : 'Not set'}
                    {source === 'here' && canSave && (
                      <button type="button" className="integ-link" onClick={() => backToHost(field)} disabled={busy !== null}>
                        Use the Vercel setting instead
                      </button>
                    )}
                    {field.generate && canSave && (
                      <button type="button" className="integ-link" onClick={() => makeKey(field.key)} disabled={busy !== null}>
                        Make a key
                      </button>
                    )}
                    {made[field.key] && secrets[field.key] === made[field.key] && (
                      <span className="integ-field-hint">
                        <strong>Copy this key now</strong> — once saved it is never shown again.
                      </span>
                    )}
                    {field.hint && <span className="integ-field-hint">{field.hint}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {problem && (
          <div className="integ-result is-bad" role="alert">
            {problem}
          </div>
        )}
        {lastTest && (
          <div className={lastTest.ok ? 'integ-result is-good' : 'integ-result is-bad'} role="status">
            <strong>{lastTest.ok ? '✅ Working' : '⛔ Not working'}</strong> · {fmtDateTime(lastTest.at)}
            <div>{lastTest.message}</div>
          </div>
        )}
      </div>

      <footer className="integ-foot">
        <div className="muted integ-small">
          {state?.updatedBy ? `Changed by ${state.updatedBy} · ${fmtDateTime(state.updatedAt)}` : 'Never changed here'}
          {def.signUp && (
            <>
              {' · '}
              <a href={def.signUp.href} target="_blank" rel="noreferrer">
                {def.signUp.label} ↗
              </a>
            </>
          )}
        </div>
        <div className="integ-actions">
          {def.fields.length > 0 && canSave && (
            <button type="button" className="btn btn-sm" disabled={!changed || busy !== null} onClick={saveFields}>
              {busy === 'save' ? 'Saving…' : def.id === 'email' ? 'Send a test and save' : 'Save'}
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" disabled={!state || busy !== null} onClick={test}>
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
        </div>
      </footer>
    </section>
  );
}
