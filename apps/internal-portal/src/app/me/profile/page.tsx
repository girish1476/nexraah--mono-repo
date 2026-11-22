'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { dateLabel } from '@/lib/hr/calendar';
import { EMPLOYMENT_LABEL } from '@/lib/hr/policy';
import { MyProfile, getMyProfile, requestProfileChange, updateMyProfile } from '@/lib/hr/apis';
import { Dialog, ErrorState, Field, Loading, ModuleGuard, PageHeader, Stack, useToast } from '@/lib/ui';
import { Avatar, Card, DayPill, Empty, Facts } from '@/components/hr/hr-ui';

/**
 * My profile — `/me/profile`. Contact details and the emergency contact are
 * the person's own to change. The bank account and PAN decide where salary
 * goes and how tax is filed, so a change to either waits for HR.
 */
export default function MyProfilePage() {
  const toast = useToast();
  const [data, setData] = useState<MyProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ phone: string; address: string; eName: string; eRelation: string; ePhone: string } | null>(null);
  const [bank, setBank] = useState<{ bank: string; accountNo: string; ifsc: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getMyProfile().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Opening your profile" />;
  const e = data.employee;
  const bankPending = data.changes.some((c) => c.field === 'bank' && c.status === 'PENDING');

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await updateMyProfile({
        phone: edit.phone,
        address: edit.address,
        emergency: edit.eName || edit.ePhone ? { name: edit.eName, relation: edit.eRelation, phone: edit.ePhone } : null,
      });
      toast('Saved');
      setEdit(null);
      load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendBank = async () => {
    if (!bank) return;
    setBusy(true);
    try {
      await requestProfileChange({ field: 'bank', bank: { bank: bank.bank, accountNo: bank.accountNo, ifsc: bank.ifsc.toUpperCase() }, reason: bank.reason });
      toast('Sent to HR — your salary goes to the new account once they confirm it');
      setBank(null);
      load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleGuard module="me">
      <PageHeader title="My profile" sub="Your details as HR holds them. Keep your phone and emergency contact up to date." module="me" />
      <Stack gap={16}>
        <section className="hr-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <Avatar name={e.name} size={76} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>{e.name}</div>
            <div className="hr-muted" style={{ fontSize: 'var(--text-md)' }}>
              {e.designation} · {e.department} · {e.branchName}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <DayPill status="PRESENT">{e.code}</DayPill>
              <DayPill status="ON_DUTY">{EMPLOYMENT_LABEL[e.employmentType]}</DayPill>
              <DayPill status="ON_LEAVE">
                {data.yearsWithUs >= 1 ? `${data.yearsWithUs} year${data.yearsWithUs === 1 ? '' : 's'} with us` : `Joined ${dateLabel(e.joinedOn)}`}
              </DayPill>
            </div>
          </div>
          {e.managerName && (
            <div style={{ textAlign: 'right' }}>
              <div className="hr-muted">Reports to</div>
              <div style={{ fontWeight: 700 }}>{e.managerName}</div>
            </div>
          )}
        </section>

        <div className="hr-grid is-2">
          <Card
            title="Contact"
            emoji="📇"
            right={
              <button
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setEdit({ phone: e.phone, address: e.address ?? '', eName: e.emergency?.name ?? '', eRelation: e.emergency?.relation ?? '', ePhone: e.emergency?.phone ?? '' })
                }
              >
                Edit
              </button>
            }
          >
            <Facts
              items={[
                ['Mobile', e.phone],
                ['Work email', e.email ?? '—'],
                ['Address', e.address ?? '—'],
                ['Emergency contact', e.emergency ? `${e.emergency.name}${e.emergency.relation ? ` (${e.emergency.relation})` : ''} · ${e.emergency.phone}` : 'Not given yet'],
                ['Date of birth', dateLabel(e.dob)],
              ]}
            />
          </Card>

          <Card
            title="Pay and tax"
            emoji="🏦"
            right={
              <button className="btn btn-secondary btn-sm" disabled={bankPending} onClick={() => setBank({ bank: '', accountNo: '', ifsc: '', reason: '' })}>
                {bankPending ? 'Change waiting for HR' : 'Change bank account'}
              </button>
            }
          >
            <Facts
              items={[
                ['Salary account', e.bank ? `${e.bank.bank} · ${e.bank.accountNo}` : 'Not given yet — HR needs it to pay you'],
                ['IFSC', e.bank?.ifsc ?? '—'],
                ['PAN', e.pan ?? 'Not on file'],
                ['PF (UAN)', e.uan ?? 'Not yet'],
                ['ESI number', e.esicNo ?? 'Not covered'],
              ]}
            />
          </Card>
        </div>

        <Card title="Changes you asked HR for" emoji="📨">
          {data.changes.length ? (
            <div className="hr-list">
              {data.changes.map((c) => (
                <div key={c.id} className="hr-row">
                  <div className="hr-row-main">
                    <div style={{ fontWeight: 650 }}>{c.field === 'bank' ? 'Bank account' : 'PAN'}: {c.before ?? '—'} → {c.after}</div>
                    <div className="hr-muted">
                      Asked {dateLabel(c.raisedAt)} — “{c.reason}”
                    </div>
                  </div>
                  <DayPill status={c.status === 'APPROVED' ? 'PRESENT' : c.status === 'REJECTED' ? 'ABSENT' : 'LATE'}>
                    {c.status === 'APPROVED' ? 'Done' : c.status === 'REJECTED' ? 'Not accepted' : 'With HR'}
                  </DayPill>
                </div>
              ))}
            </div>
          ) : (
            <Empty emoji="✨">Nothing asked for.</Empty>
          )}
        </Card>
      </Stack>

      <Dialog open={!!edit} title="Your contact details" confirmLabel="Save" busy={busy} onConfirm={() => void save()} onClose={() => setEdit(null)} width={540}>
        {edit && (
          <Stack gap={12}>
            <Field label="Mobile">
              <input inputMode="numeric" value={edit.phone} onChange={(ev) => setEdit({ ...edit, phone: ev.target.value.replace(/\D/g, '').slice(0, 10) })} />
            </Field>
            <Field label="Address">
              <textarea rows={2} value={edit.address} onChange={(ev) => setEdit({ ...edit, address: ev.target.value })} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12 }}>
              <Field label="Emergency contact">
                <input value={edit.eName} onChange={(ev) => setEdit({ ...edit, eName: ev.target.value })} placeholder="Name" />
              </Field>
              <Field label="Relation">
                <input value={edit.eRelation} onChange={(ev) => setEdit({ ...edit, eRelation: ev.target.value })} placeholder="e.g. Spouse" />
              </Field>
            </div>
            <Field label="Their mobile">
              <input inputMode="numeric" value={edit.ePhone} onChange={(ev) => setEdit({ ...edit, ePhone: ev.target.value.replace(/\D/g, '').slice(0, 10) })} />
            </Field>
          </Stack>
        )}
      </Dialog>

      <Dialog
        open={!!bank}
        title="New salary account"
        body="HR checks it before the next payroll. Until then your salary goes to the account on file."
        confirmLabel="Send to HR"
        confirmDisabled={!bank || !bank.bank.trim() || bank.accountNo.length < 9 || bank.ifsc.length !== 11}
        busy={busy}
        onConfirm={() => void sendBank()}
        onClose={() => setBank(null)}
      >
        {bank && (
          <Stack gap={12}>
            <Field label="Bank">
              <input value={bank.bank} onChange={(ev) => setBank({ ...bank, bank: ev.target.value })} placeholder="e.g. HDFC Bank" />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
              <Field label="Account number">
                <input inputMode="numeric" value={bank.accountNo} onChange={(ev) => setBank({ ...bank, accountNo: ev.target.value.replace(/\D/g, '').slice(0, 18) })} />
              </Field>
              <Field label="IFSC">
                <input value={bank.ifsc} onChange={(ev) => setBank({ ...bank, ifsc: ev.target.value.toUpperCase().slice(0, 11) })} placeholder="HDFC0000188" />
              </Field>
            </div>
            <Field label="Why the change">
              <input value={bank.reason} onChange={(ev) => setBank({ ...bank, reason: ev.target.value })} placeholder="e.g. Opened a salary account with HDFC" />
            </Field>
          </Stack>
        )}
      </Dialog>
    </ModuleGuard>
  );
}
