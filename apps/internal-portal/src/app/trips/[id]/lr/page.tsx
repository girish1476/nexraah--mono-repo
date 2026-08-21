'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { fmtDateTime, inr } from '@/lib/format';
import {
  Banner,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { generateLr, getCrossCheck, getLr, getTrip, patchLr, shareLr } from '../../apis';
import { CrossCheckResult, LorryReceipt, TripDetail } from '../../types';
import { TripTabs } from '../tabs';

const EMPTY: LorryReceipt = {
  code: null,
  status: 'DRAFT',
  lrDate: null,
  bookedAt: null,
  sharedAt: null,
  consignor: { name: '', address: '', gstin: '' },
  consignee: { name: '', address: '', gstin: '' },
  goods: { description: '', packages: 0, weightTn: 0, valuePaise: 0 },
  invoice: { number: '', datedOn: '', valuePaise: 0 },
  eway: { number: '', validTill: '' },
  vehicle: { registration: '', type: '' },
  driver: { name: '', licence: '', phone: '' },
  transitDays: 0,
  remarks: '',
  chargeHeads: { freightPaise: 0, loadingPaise: 0, unloadingPaise: 0, detentionPaise: 0, otherPaise: 0, discountPaise: 0 },
};

/**
 * Lorry receipt — `/trips/[id]/lr` (part 05 §5).
 *
 * One record per trip: the LR and the E-LR are the same document, held once
 * (BR-22). `Generate LR` consumes the number inside the issuing transaction
 * and is blocked before the truck is placed (BR-13) and while any cross-check
 * mismatch is open (BR-32). Sharing is optional, always.
 */
export default function LorryReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();

  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [lr, setLr] = useState<LorryReceipt | null>(null);
  const [crossCheck, setCrossCheck] = useState<CrossCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([getTrip(id), getLr(id), getCrossCheck(id)])
      .then(([t, l, c]) => {
        setTrip(t);
        setLr(l ?? { ...EMPTY, vehicle: { registration: t.vehicleNo, type: t.vehicleType }, transitDays: t.transitDaysRequired, remarks: t.remarks });
        setCrossCheck(c);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  /** Autosave every 3 seconds after the last keystroke. */
  const edit = (patch: Partial<LorryReceipt>) => {
    setLr((prev) => {
      const next = { ...(prev ?? EMPTY), ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        patchLr(id, next)
          .then(() => setSavedAt(new Date().toISOString()))
          .catch(() => undefined);
      }, 3000);
      return next;
    });
  };

  const generate = async () => {
    setBusy(true);
    try {
      const issued = await generateLr(id);
      setLr(issued);
      toast(`${issued.code} issued · the trip is open`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    try {
      const shared = await shareLr(id);
      setLr(shared);
      toast('Shared with the transporter — sharing is never a required step');
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!trip || !lr) return <Loading what="Loading the lorry receipt" />;

  const mismatchOpen = !!crossCheck && crossCheck.mismatches.length > 0 && !crossCheck.overridden;
  const notPlaced = !trip.vehicleNo;
  const canIssue = can('indent.manage') && !lr.code && !mismatchOpen && !notPlaced;

  return (
    <ModuleGuard module="trips">
      <PageHeader
        path={`/trips/${id}/lr`}
        title={lr.code ?? 'Lorry receipt — draft'}
        sub={lr.code ? `${lr.status.replace(/_/g, ' ').toLowerCase()} · issued ${fmtDateTime(lr.bookedAt)}` : 'Autosaves every three seconds'}
        module="trips"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {lr.code && (
              <Link href={`/print/lr/${id}`} className="btn btn-secondary" target="_blank">
                Print
              </Link>
            )}
            {lr.code && !lr.sharedAt && (
              <button className="btn btn-secondary" onClick={share}>
                Share with transporter
              </button>
            )}
            {!lr.code && (
              <button className="btn" onClick={generate} disabled={!canIssue || busy}>
                Generate LR
              </button>
            )}
          </div>
        }
      />
      <TripTabs tripId={id} />

      <Stack>
        {notPlaced && (
          <Banner tone="red" title="The truck is not placed">
            A lorry receipt cannot be issued before placement (BR-13). Record the placed vehicle on the indent
            first.
          </Banner>
        )}
        {mismatchOpen && (
          <Banner tone="red" title="A cross-check mismatch is open">
            Generation stays blocked until the mismatch is rejected or overridden — the penalty happens at a
            checkpost, and by then it is too late (BR-32).
          </Banner>
        )}
        {lr.sharedAt && (
          <Banner tone="mint" title="Shared">
            Sent to the transporter at {fmtDateTime(lr.sharedAt)}. Sharing was optional and remains so (BR-22).
          </Banner>
        )}
        {savedAt && (
          <div className="muted" style={{ fontSize: 11.5 }}>
            Draft saved {fmtDateTime(savedAt)}
          </div>
        )}

        <Panel title="Consignor">
          <FormGrid>
            <Field label="Name">
              <input
                value={lr.consignor.name}
                disabled={!!lr.code}
                onChange={(e) => edit({ consignor: { ...lr.consignor, name: e.target.value } })}
              />
            </Field>
            <Field label="Address">
              <input
                value={lr.consignor.address}
                disabled={!!lr.code}
                onChange={(e) => edit({ consignor: { ...lr.consignor, address: e.target.value } })}
              />
            </Field>
            <Field label="GSTIN">
              <input
                value={lr.consignor.gstin}
                disabled={!!lr.code}
                onChange={(e) => edit({ consignor: { ...lr.consignor, gstin: e.target.value } })}
              />
            </Field>
          </FormGrid>
        </Panel>

        <Panel title="Consignee">
          <FormGrid>
            <Field label="Name">
              <input
                value={lr.consignee.name}
                disabled={!!lr.code}
                onChange={(e) => edit({ consignee: { ...lr.consignee, name: e.target.value } })}
              />
            </Field>
            <Field label="Address">
              <input
                value={lr.consignee.address}
                disabled={!!lr.code}
                onChange={(e) => edit({ consignee: { ...lr.consignee, address: e.target.value } })}
              />
            </Field>
            <Field label="GSTIN">
              <input
                value={lr.consignee.gstin}
                disabled={!!lr.code}
                onChange={(e) => edit({ consignee: { ...lr.consignee, gstin: e.target.value } })}
              />
            </Field>
          </FormGrid>
        </Panel>

        <Panel title="Goods, invoice and e-way bill">
          <FormGrid>
            <Field label="Goods description">
              <input
                value={lr.goods.description}
                disabled={!!lr.code}
                onChange={(e) => edit({ goods: { ...lr.goods, description: e.target.value } })}
              />
            </Field>
            <Field label="Packages">
              <input
                type="number"
                value={lr.goods.packages}
                disabled={!!lr.code}
                onChange={(e) => edit({ goods: { ...lr.goods, packages: Number(e.target.value) } })}
              />
            </Field>
            <Field label="Weight (MT)">
              <input
                type="number"
                value={lr.goods.weightTn}
                disabled={!!lr.code}
                onChange={(e) => edit({ goods: { ...lr.goods, weightTn: Number(e.target.value) } })}
              />
            </Field>
            <Field label="Client invoice number">
              <input
                value={lr.invoice.number}
                disabled={!!lr.code}
                onChange={(e) => edit({ invoice: { ...lr.invoice, number: e.target.value } })}
              />
            </Field>
            <Field label="Invoice value (₹)">
              <input
                type="number"
                value={lr.invoice.valuePaise / 100}
                disabled={!!lr.code}
                onChange={(e) => edit({ invoice: { ...lr.invoice, valuePaise: Number(e.target.value) * 100 } })}
              />
            </Field>
            <Field label="E-way bill number">
              <input
                value={lr.eway.number}
                disabled={!!lr.code}
                onChange={(e) => edit({ eway: { ...lr.eway, number: e.target.value } })}
              />
            </Field>
            <Field label="E-way valid till">
              <input
                type="datetime-local"
                value={lr.eway.validTill?.slice(0, 16) ?? ''}
                disabled={!!lr.code}
                onChange={(e) => edit({ eway: { ...lr.eway, validTill: e.target.value } })}
              />
            </Field>
          </FormGrid>
        </Panel>

        <Panel title="Vehicle, driver, transit">
          <FormGrid>
            <Field label="Registration">
              <input value={lr.vehicle.registration} disabled />
            </Field>
            <Field label="Vehicle type">
              <input value={lr.vehicle.type} disabled />
            </Field>
            <Field label="Driver">
              <input
                value={lr.driver.name}
                disabled={!!lr.code}
                onChange={(e) => edit({ driver: { ...lr.driver, name: e.target.value } })}
              />
            </Field>
            <Field label="Licence">
              <input
                value={lr.driver.licence}
                disabled={!!lr.code}
                onChange={(e) => edit({ driver: { ...lr.driver, licence: e.target.value } })}
              />
            </Field>
            <Field label="Transit days" hint="Carried from the indent (BR-27).">
              <input type="number" value={lr.transitDays} disabled />
            </Field>
            <Field label="Remarks" hint="Carried from the indent (BR-28).">
              <input
                value={lr.remarks}
                disabled={!!lr.code}
                onChange={(e) => edit({ remarks: e.target.value })}
              />
            </Field>
          </FormGrid>
        </Panel>

        <Panel title="Charge heads">
          <FormGrid>
            {(
              [
                ['freightPaise', 'Freight'],
                ['loadingPaise', 'Loading'],
                ['unloadingPaise', 'Unloading'],
                ['detentionPaise', 'Detention'],
                ['otherPaise', 'Other'],
                ['discountPaise', 'Discount'],
              ] as [keyof LorryReceipt['chargeHeads'], string][]
            ).map(([key, label]) => (
              <Field key={key} label={`${label} (₹)`}>
                <input
                  type="number"
                  value={lr.chargeHeads[key] / 100}
                  disabled={!!lr.code}
                  onChange={(e) => edit({ chargeHeads: { ...lr.chargeHeads, [key]: Number(e.target.value) * 100 } })}
                />
              </Field>
            ))}
          </FormGrid>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Tag tone="grey">Total</Tag>
            <span className="mono">
              {inr(Object.values(lr.chargeHeads).reduce((a, b) => a + b, 0) - 2 * lr.chargeHeads.discountPaise)}
            </span>
          </div>
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}
