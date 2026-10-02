import { Permission } from '@/lib/permissions';
import { Tone } from '@/lib/ui';
import { listApprovals } from '../admin/approvals/apis';
import { listClientOnboarding } from '../clients/onboarding/apis';
import { listAdvanceQueue, listBalanceQueue } from '../payments/apis';
import { getReceiving } from '../pod/apis';
import { listRfqs } from '../rfq/apis';
import { listTickets } from '../tickets/apis';
import { getComplianceQueues } from '../vendors/apis';

/** One pile of work waiting on a desk, with the screen it is worked on. */
export interface WorkItem {
  key: string;
  emoji: string;
  tone: Tone;
  count: number;
  /** Follows the count: "3 · advances ready to release". */
  title: string;
  why: string;
  href: string;
  action: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The work waiting on the desks other than Operations, by what the signed-in
 * person is allowed to do.
 *
 * Every count is read from the list the linked screen itself shows, so the
 * number on My desk and the rows on that screen cannot disagree. A list that
 * fails to load is left out rather than failing the desk: one screen being
 * down is no reason to hide the others.
 */
export async function loadDeskWork(can: (permission: Permission) => boolean): Promise<WorkItem[]> {
  const quiet = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const none = Promise.resolve(null);

  const pays = can('payment.release');
  const verifiesPapers = can('document.verify') || can('vendor.verify');
  const checksPods = can('pod.verify') || can('pod.approve');
  const prices = can('rfq.edit') || can('rfq.submit');
  const approves =
    can('approve.above_band') || can('approve.waiver') || can('approve.exception') || can('approve.contract');

  const [advances, balances, papers, clients, pods, rfqs, approvals, tickets] = await Promise.all([
    pays ? quiet(listAdvanceQueue()) : none,
    pays ? quiet(listBalanceQueue()) : none,
    verifiesPapers ? quiet(getComplianceQueues()) : none,
    can('client.onboard') ? quiet(listClientOnboarding()) : none,
    checksPods ? quiet(getReceiving()) : none,
    prices ? quiet(listRfqs()) : none,
    approves ? quiet(listApprovals({ status: 'PENDING' })) : none,
    can('ticket.resolve') ? quiet(listTickets()) : none,
  ]);

  const items: WorkItem[] = [];
  const add = (item: WorkItem) => {
    if (item.count > 0) items.push(item);
  };

  if (balances) {
    const n = balances.filter((r) => !r.blocked).length;
    add({
      key: 'balances',
      emoji: '🏁',
      tone: 'flag',
      count: n,
      title: `final payment${plural(n, '', 's')} ready to release`,
      why: 'Delivery is proven and nothing is holding these — the transporter is waiting for the rest of their money.',
      href: '/payments/balance',
      action: 'Release final payments',
    });
  }
  if (advances) {
    const n = advances.filter((r) => !r.blocked).length;
    add({
      key: 'advances',
      emoji: '⏩',
      tone: 'flag',
      count: n,
      title: `advance${plural(n, '', 's')} ready to release`,
      why: 'Every document the advance needs is in. The truck moves once this is paid.',
      href: '/payments/advance',
      action: 'Release advances',
    });
  }
  if (papers) {
    const n = papers.reduce((a, q) => a + q.rows.length, 0);
    add({
      key: 'papers',
      emoji: '🛡️',
      tone: papers.some((q) => q.rows.some((r) => r.tone === 'red')) ? 'red' : 'flag',
      count: n,
      title: `paper${plural(n, '', 's')} waiting to be verified`,
      why: 'Transporter and trip documents that work is waiting on until somebody checks them.',
      href: '/compliance',
      action: 'Verify documents',
    });
  }
  if (clients) {
    const n = clients.filter((c) => c.status === 'PENDING_VERIFICATION').length;
    add({
      key: 'clients',
      emoji: '📋',
      tone: 'blue',
      count: n,
      title: `new client${plural(n, '', 's')} waiting to be cleared`,
      why: 'No load can be raised for a client until their papers are checked.',
      href: '/clients/onboarding',
      action: 'Check client papers',
    });
  }
  if (pods && can('pod.verify')) {
    const n = pods.stats.awaitingVerification;
    add({
      key: 'pod-verify',
      emoji: '🔍',
      tone: 'flag',
      count: n,
      title: `delivery proof${plural(n, '', 's')} waiting to be checked`,
      why: 'The paper has arrived. The transporter’s final payment stays held until it is checked and approved.',
      href: '/pod/receiving',
      action: 'Check delivery proofs',
    });
  }
  if (pods && can('pod.approve')) {
    const n = pods.stats.awaitingApproval;
    add({
      key: 'pod-approve',
      emoji: '✅',
      tone: 'blue',
      count: n,
      title: `delivery proof${plural(n, '', 's')} checked and waiting for approval`,
      why: 'Checked by one person, and waiting for a second to approve.',
      href: '/pod/receiving',
      action: 'Approve delivery proofs',
    });
  }
  if (rfqs && can('rfq.edit')) {
    const n = rfqs.rows.filter((r) => r.status === 'DRAFT' || r.status === 'SOURCING').length;
    add({
      key: 'rfq-price',
      emoji: '💬',
      tone: 'blue',
      count: n,
      title: `rate request${plural(n, '', 's')} still to be priced`,
      why: 'A client has asked for rates and the lanes are not all priced yet.',
      href: '/rfq',
      action: 'Price rate requests',
    });
  }
  if (rfqs && can('rfq.submit')) {
    const n = rfqs.rows.filter((r) => r.status === 'QUOTED').length;
    add({
      key: 'rfq-submit',
      emoji: '📤',
      tone: 'flag',
      count: n,
      title: `rate request${plural(n, '', 's')} priced and waiting to be sent to the client`,
      why: 'The price is built. It reaches the client only when it is submitted.',
      href: '/rfq',
      action: 'Review and submit',
    });
  }
  if (approvals) {
    const n = approvals.length;
    add({
      key: 'approvals',
      emoji: '✋',
      tone: 'flag',
      count: n,
      title: `decision${plural(n, '', 's')} waiting for sign-off`,
      why: 'Somebody’s work is stopped until each of these is approved or turned down.',
      href: '/admin/approvals',
      action: 'Open approvals',
    });
  }
  if (tickets) {
    const n = tickets.summary.open;
    add({
      key: 'tickets',
      emoji: '🎫',
      tone: tickets.summary.blocking > 0 ? 'red' : 'flag',
      count: n,
      title: `reported problem${plural(n, '', 's')} waiting to be picked up`,
      why:
        tickets.summary.blocking > 0
          ? `${tickets.summary.blocking} of the open reports ${plural(tickets.summary.blocking, 'is', 'are')} stopping somebody’s work.`
          : 'Wrong or missing data that somebody on a screen has reported.',
      href: '/tickets',
      action: 'Open tickets',
    });
  }
  return items;
}
