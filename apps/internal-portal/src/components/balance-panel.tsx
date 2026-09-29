'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, errorMessage, newIdempotencyKey } from '@/apis';
import { getBalance, releaseBalance } from '@/app/payments/apis';
import { BalanceDetail, PaymentCapture } from '@/app/payments/types';
import { inr } from '@/lib/format';
import { ROLES } from '@/lib/permissions';
import { Banner, BlockedPanel, Loading, Panel, useCan, useToast } from '@/lib/ui';
import { ReleaseDialog } from './release-dialog';

/**
 * The balance gate, scoped to one trip (part 07 §2).
 *
 * The deduction breakdown is shown as four lines, never as a single net
 * figure: a transporter paid a number with no working disputes it, and a
 * transporter shown the working argues about the penalty — which is a
 * conversation the system can answer.
 */
export function BalancePanel({
  tripId,
  onReleased,
  hideOrderLink,
}: {
  tripId: string;
  onReleased?: () => void;
  /** The order page renders this panel itself — a link back to the page
      you're already on is dead weight, not navigation. */
  hideOrderLink?: boolean;
}) {
  const can = useCan();
  const toast = useToast();
  const [detail, setDetail] = useState<BalanceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forfeited, setForfeited] = useState(false);
  const [idempotencyKey, setKey] = useState(newIdempotencyKey);

  const load = useCallback(() => {
    getBalance(tripId)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [tripId]);

  useEffect(load, [load]);

  const release = async (capture: PaymentCapture) => {
    setBusy(true);
    try {
      const payment = await releaseBalance(tripId, idempotencyKey, capture);
      toast(`Balance released · ${inr(payment.netPaise)} · UTR ${payment.utr}`);
      setOpen(false);
      setKey(newIdempotencyKey());
      load();
      onReleased?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'POD_FORFEITED') {
        setForfeited(true);
        setOpen(false);
        toast('Nothing is payable — the POD is past forty days');
      } else if (e instanceof ApiError && e.code === 'BALANCE_BLOCKED') {
        setDetail((d) => (d ? { ...d, unmet: e.unmet, releasable: false } : d));
        setOpen(false);
        toast('Release refused — the balance gate is closed');
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Banner tone="grey" title="Balance">{error}</Banner>;
  if (!detail) return <Loading what="Checking the balance gate" />;

  const b = detail.breakdown;
  const isFinance = can('payment.release');

  const orderLink = !hideOrderLink && (
    <div style={{ marginBottom: 10 }}>
      <Link href={`/orders/${detail.indentCode}`} className="btn btn-secondary btn-sm">
        View order
      </Link>
    </div>
  );

  const workings = (
    <Panel title="What reaches the transporter" pad={false}>
      <div style={{ padding: '10px 15px' }}>
        <Line label="Billable — buy rate plus captured charges" value={inr(b.billablePaise)} />
        <Line label="Less advance paid" value={`−${inr(b.advancePaidPaise)}`} />
        <Line
          label={`Less POD penalty (${b.penaltyDays} day${b.penaltyDays === 1 ? '' : 's'})`}
          value={`−${inr(b.penaltyPaise)}`}
          note={`${inr(b.penaltyPerDayPaise)}/day beyond ${detail.podAgeDays - b.penaltyDays} days`}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            paddingTop: 9,
            marginTop: 4,
            borderTop: '1px solid var(--color-divider)',
            fontWeight: 600,
          }}
        >
          <span>Net payable</span>
          <span className="mono" style={{ fontSize: 17 }}>
            {inr(b.netPaise)}
          </span>
        </div>
      </div>
    </Panel>
  );

  if (detail.alreadyReleased) {
    return (
      <>
        {orderLink}
        <Banner tone="mint" title="Balance released">
          {inr(b.netPaise)} released against {detail.tripCode}
        </Banner>
        {workings}
      </>
    );
  }

  if (forfeited) {
    return (
      <>
        {orderLink}
        <Banner tone="red" title="Balance forfeited">
          The proof of delivery wasn't approved within 40 days, so this trip closes with nothing payable to the
          transporter. This forfeiture is recorded on the transporter's record.
        </Banner>
      </>
    );
  }

  return (
    <>
      {orderLink}
      <BlockedPanel
        title={detail.unmet.length ? 'Balance blocked' : 'Balance ready to release'}
        subtitle={
          <>
            <span className="mono">{inr(b.netPaise)}</span> net · proof of delivery is{' '}
            {detail.podStatus.toLowerCase()} · day {detail.podAgeDays}
          </>
        }
        unmet={detail.unmet}
        action={
          isFinance && (
            <button className="btn" disabled={detail.unmet.length > 0} onClick={() => setOpen(true)}>
              Release {inr(b.netPaise)}
            </button>
          )
        }
        note={
          isFinance
            ? detail.unmet.length
              ? 'Only an approved proof of delivery unblocks this. Approval is compliance or the branch; release is yours.'
              : 'The proof of delivery is approved and the penalty is computed. Release is yours to make.'
            : `Release is a ${ROLES.FINANCE.label} action. Approving the proof of delivery is what unblocks it.`
        }
      />
      {workings}

      <ReleaseDialog
        open={open}
        title="Release balance"
        body="The proof of delivery is approved and the penalty has been calculated. The net figure below is what reaches the transporter."
        facts={[
          ['Vendor', detail.vendorName],
          ['Account', `${detail.beneficiary.account} · ${detail.beneficiary.ifsc}`],
          ['Billable', inr(b.billablePaise)],
          ['Less advance', `−${inr(b.advancePaidPaise)}`],
          ['Less penalty', `−${inr(b.penaltyPaise)}`],
          ['Net', inr(b.netPaise)],
        ]}
        confirmLabel="Confirm release"
        busy={busy}
        onConfirm={release}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function Line({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ fontSize: 13 }}>
        {label}
        {note && (
          <span className="muted" style={{ fontSize: 11.5, display: 'block' }}>
            {note}
          </span>
        )}
      </span>
      <span className="mono" style={{ fontSize: 13.5 }}>
        {value}
      </span>
    </div>
  );
}
