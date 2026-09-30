'use client';

import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/apis';
import { recordPlacement } from '@/app/indents/apis';
import type { IndentDetail } from '@/app/indents/types';
import { getVendor } from '@/app/vendors/apis';
import type { FleetRow } from '@/app/vendors/types';
import { Dialog, Field, FormGrid, useToast } from '@/lib/ui';

const MOBILE_RE = /^(\+91|0)?[6-9]\d{9}$/;

/**
 * Vehicle allocation — one dialog, used from the indent page and from the
 * order page, so the flow can be moved forward from whichever screen the
 * operator is on.
 *
 * The driver's mobile number is the one required contact detail: it is how
 * Operations reaches the truck. Name and licence are optional — often not
 * known when the vehicle is confirmed, and the licence is checked later with
 * the advance documents anyway.
 *
 * The transporter's own fleet is offered as suggestions (available trucks
 * first), but any plate can be typed — a transporter may send a truck they
 * have not listed.
 */
export function AllocateVehicleDialog({
  open,
  indent,
  onClose,
  onAllocated,
}: {
  open: boolean;
  indent: Pick<
    IndentDetail,
    'id' | 'vendorId' | 'vehicleNo' | 'driverName' | 'driverLicence' | 'driverPhone' | 'pickupDate' | 'reportingRule' | 'quotes' | 'awardedQuoteId'
  >;
  onClose: () => void;
  onAllocated: (updated: IndentDetail) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [form, setForm] = useState({
    vehicleNo: '',
    driverPhone: '',
    driverName: '',
    driverLicence: '',
    reportedAt: new Date().toISOString().slice(0, 16),
    remarks: '',
  });

  // Pre-fill once, when the dialog opens. Keyed on `open` only — the page
  // refreshes its indent in the background, and re-running this on every new
  // indent object wiped whatever had just been typed (the mobile number went
  // blank and the button greyed out mid-entry).
  const indentRef = useRef(indent);
  indentRef.current = indent;
  useEffect(() => {
    if (!open) return;
    const current = indentRef.current;
    const awarded = current.quotes.find((q) => q.id === current.awardedQuoteId);
    setForm((f) => ({
      ...f,
      vehicleNo: current.vehicleNo ?? awarded?.truckRegistration ?? '',
      driverPhone: current.driverPhone ?? '',
      driverName: current.driverName ?? '',
      driverLicence: current.driverLicence ?? '',
    }));
    if (current.vendorId) {
      getVendor(current.vendorId)
        .then((v) => setFleet(v.fleet ?? []))
        .catch(() => setFleet([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const phone = form.driverPhone.replace(/\s/g, '');
  const phoneError = phone && !MOBILE_RE.test(phone) ? 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.' : undefined;
  const available = fleet.filter((v) => v.status === 'AVAILABLE');

  const submit = async () => {
    setBusy(true);
    const late = new Date(form.reportedAt).getTime() > new Date(indent.pickupDate).getTime();
    try {
      const updated = await recordPlacement(indent.id, {
        vehicleNo: form.vehicleNo.trim().toUpperCase(),
        driverPhone: phone,
        driverName: form.driverName.trim() || undefined,
        driverLicence: form.driverLicence.trim() || undefined,
        reportedAt: form.reportedAt,
        remarks: form.remarks.trim() || undefined,
        transitDelay: late,
      });
      toast(late ? 'Vehicle allocated · flagged as a transit delay' : 'Vehicle allocated');
      onAllocated(updated);
      onClose();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Allocate vehicle"
      body="The vehicle number and the driver's mobile number are all that is needed. Driver name and licence can be added now or later."
      confirmLabel="Allocate vehicle"
      confirmDisabled={!form.vehicleNo.trim() || !MOBILE_RE.test(phone)}
      busy={busy}
      onConfirm={submit}
      onClose={onClose}
    >
      <FormGrid>
        <Field
          label="Vehicle number"
          required
          hint={available.length ? `${available.length} available truck(s) in this transporter's fleet — start typing.` : undefined}
        >
          <input
            list="allocate-fleet"
            autoComplete="off"
            value={form.vehicleNo}
            onChange={(e) => setForm({ ...form, vehicleNo: e.target.value.toUpperCase() })}
          />
          <datalist id="allocate-fleet">
            {[...available, ...fleet.filter((v) => v.status !== 'AVAILABLE')].map((v) => (
              <option key={v.registration} value={v.registration}>
                {`${v.type} · ${v.capacityTn} MT · ${v.status.replace(/_/g, ' ').toLowerCase()}`}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label="Driver mobile number" required error={phoneError}>
          <input
            inputMode="tel"
            placeholder="10-digit mobile number"
            value={form.driverPhone}
            onChange={(e) => setForm({ ...form, driverPhone: e.target.value.replace(/[^\d+]/g, '').slice(0, 13) })}
          />
        </Field>
        <Field label="Driver name" hint="Optional">
          <input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} />
        </Field>
        <Field label="Driver licence" hint="Optional — checked with the advance documents">
          <input value={form.driverLicence} onChange={(e) => setForm({ ...form, driverLicence: e.target.value })} />
        </Field>
        <Field label="Reported at" required hint={`Client requirement: ${indent.reportingRule.replace(/_/g, ' ').toLowerCase()}`}>
          <input
            type="datetime-local"
            value={form.reportedAt}
            onChange={(e) => setForm({ ...form, reportedAt: e.target.value })}
          />
        </Field>
        <Field label="Remarks">
          <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </Field>
      </FormGrid>
    </Dialog>
  );
}
