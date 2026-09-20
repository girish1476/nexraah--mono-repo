'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, errorMessage, newIdempotencyKey } from '@/apis';
import { getAdvance, releaseAdvance } from '@/app/payments/apis';
import { AdvanceDetail, PaymentCapture } from '@/app/payments/types';
import { inr } from '@/lib/format';
import { ROLES } from '@/lib/permissions';
import { Banner, BlockedPanel, Loading, useCan, useToast } from '@/lib/ui';
import { ReleaseDialog } from './release-dialog';

/**
 * The advance gate, scoped to one record (part 07 §1). Rendered on the indent
 * detail, the trip detail and the advance queue — one component, because the
 * rule is one rule.
 *
 * The blocking list is the server's; nothing here decides what is missing.
 */
export function AdvancePanel({
  indentId,
  onReleased,
  hideOrderLink,
}: {
  indentId: string;
  onReleased?: () => void;
  /** The order page renders this panel itself — a link back to the page
      you're already on is dead weight, not navigation. */
  hideOrderLink?: boolean;
}) {
  const can = useCan();
  const toast = useToast();
  const [detail, setDetail] = useState<AdvanceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setKey] = useState(newIdempotencyKey);

  const load = useCallback(() => {
    getAdvance(indentId)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [indentId]);

  useEffect(load, [load]);

  const release = async (capture: PaymentCapture) => {
    setBusy(true);
    try {
      const payment = await releaseAdvance(indentId, idempotencyKey, capture);
      toast(`Advance released · ${inr(payment.netPaise)} · UTR ${payment.utr}`);
      setOpen(false);
      setKey(newIdempotencyKey());
      load();
      onReleased?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ADVANCE_BLOCKED') {
        setDetail((d) => (d ? { ...d, unmet: e.unmet, releasable: false } : d));
        toast('Release refused — the gate is still closed');
        setOpen(false);
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Banner tone="grey" title="Advance">{error}</Banner>;
  if (!detail) return <Loading what="Checking the advance gate" />;

  const orderLink = !hideOrderLink && (
    <div style={{ marginBottom: 10 }}>
      <Link href={`/orders/${detail.indentCode}`} className="btn btn-secondary btn-sm">
        View order
      </Link>
    </div>
  );

  if (detail.alreadyReleased) {
    return (
      <>
        {orderLink}
        <Banner
          tone="mint"
          title="Advance released"
          right={
            <div className="mono" style={{ fontSize: 23, color: 'var(--mint)' }}>
              {inr(detail.grossPaise)}
            </div>
          }
        >
          {detail.advancePct}% of {inr(detail.buyRatePaise)} · released to {detail.beneficiary.account}
        </Banner>
      </>
    );
  }

  const isFinance = can('payment.release');

  return (
    <>
      {orderLink}
      <BlockedPanel
        title={detail.unmet.length ? 'Advance blocked' : 'Advance ready to release'}
        subtitle={
          <>
            <span className="mono">{inr(detail.grossPaise)}</span>{' '}
            {detail.unmet.length ? 'held' : 'cleared for release'} · {detail.advancePct}% of{' '}
            {inr(detail.buyRatePaise)} · no TDS deducted in this release
          </>
        }
        unmet={detail.unmet}
        cleared={detail.cleared}
        action={
          isFinance && (
            <button className="btn" disabled={detail.unmet.length > 0} onClick={() => setOpen(true)}>
              Release {inr(detail.grossPaise)}
            </button>
          )
        }
        note={
          isFinance
            ? detail.unmet.length
              ? 'Release stays disabled until every item above is verified. The endpoint refuses it too.'
              : 'Every check has cleared. Release is yours to make.'
            : detail.unmet.length
              ? `Release is a ${ROLES.FINANCE.label} action. You can see what is held and why, and clear what is yours to clear.`
              : 'Everything is cleared. Finance releases the money — no other role can, including you.'
        }
      />

      <ReleaseDialog
        open={open}
        title="Release advance"
        body="This disburses to the transporter's registered bank account. Finance is the only role that can do this, and the action is written to the audit log with your user id."
        facts={[
          ['Vendor', detail.vendorName],
          ['Account', `${detail.beneficiary.account} · ${detail.beneficiary.ifsc}`],
          ['Amount', inr(detail.grossPaise)],
          ['TDS (not deducted in this release)', inr(detail.tdsPaise)],
          ['Against', detail.tripCode ?? detail.indentCode],
        ]}
        confirmLabel="Confirm release"
        busy={busy}
        onConfirm={release}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
