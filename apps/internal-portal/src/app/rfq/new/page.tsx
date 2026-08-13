'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/apis';
import { listClients } from '@/app/clients/apis';
import { Client } from '@/app/clients/types';
import { Field, FormGrid, ModuleGuard, PageHeader, Panel, useLevel, useToast } from '@/lib/ui';
import { createRfq } from '../apis';

/** New RFQ — `/rfq/new` (part 09 §1). The period end is derived from the cycle. */
export default function NewRfqPage() {
  const router = useRouter();
  const toast = useToast();
  const level = useLevel('rfq');
  const [clients, setClients] = useState<Client[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    clientId: '',
    cycleMonths: 12,
    periodFrom: '',
    dueAt: '',
    reference: '',
  });

  useEffect(() => {
    listClients().then(setClients).catch(() => setClients([]));
  }, []);

  const periodTo = form.periodFrom
    ? new Date(new Date(form.periodFrom).setMonth(new Date(form.periodFrom).getMonth() + form.cycleMonths) - 86_400_000)
        .toISOString()
        .slice(0, 10)
    : '';

  const submit = async () => {
    setBusy(true);
    try {
      const rfq = await createRfq({ ...form, periodTo });
      toast('RFQ created · add the lanes it covers');
      router.push(`/rfq/${rfq.id}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (level !== 'EDIT') {
    return (
      <ModuleGuard module="rfq">
        <PageHeader path="/rfq/new" title="New RFQ" module="rfq" />
        <Panel>Creating an RFQ belongs to operations, branch management or leadership.</Panel>
      </ModuleGuard>
    );
  }

  return (
    <ModuleGuard module="rfq">
      <PageHeader path="/rfq/new" title="New RFQ" sub="Client · cycle · period · submission deadline" module="rfq" />
      <Panel>
        <FormGrid>
          <Field label="Client" required>
            <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">Select</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cycle" required>
            <select
              value={form.cycleMonths}
              onChange={(e) => setForm({ ...form, cycleMonths: Number(e.target.value) })}
            >
              {[3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m} months
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period from" required>
            <input type="date" value={form.periodFrom} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} />
          </Field>
          <Field label="Period to" hint="Derived from the cycle.">
            <input value={periodTo} disabled />
          </Field>
          <Field label="Submission due" required>
            <input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          </Field>
          <Field label="Client reference">
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
        </FormGrid>
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={submit} disabled={busy || !form.clientId || !form.periodFrom || !form.dueAt}>
            Create RFQ
          </button>
        </div>
      </Panel>
    </ModuleGuard>
  );
}
