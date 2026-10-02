import { NexraahMark } from '@/components/nexraah-mark';

/**
 * The brand side of the sign-in screen: the Nexraah symbol, drawn as a vector
 * so it stays sharp, set very large beside the form — and once more, faint and
 * oversized, behind the whole screen.
 */
export function AuthBrand() {
  return (
    <>
      <NexraahMark id="nx-back" className="auth-backdrop-mark" />
      <div className="auth-brand">
        <div className="auth-brand-head">
          <div className="auth-mark-wrap">
            <NexraahMark id="nx-hero" className="auth-mark" title="Nexraah" />
          </div>
          <div className="auth-wordmark">NEXRAAH</div>
          <div className="auth-brand-tag">Built to move. Born to deliver.</div>
          <div className="auth-brand-console">Operations console</div>
        </div>
        <ul className="auth-brand-points">
          <li>
            <span aria-hidden>🚚</span>
            <span>Every shipment, ten steps, one place — from the first quote to the final payment.</span>
          </li>
          <li>
            <span aria-hidden>🛡️</span>
            <span>Compliance clears every transporter before a load ever reaches them.</span>
          </li>
          <li>
            <span aria-hidden>💰</span>
            <span>Advances, balances and receivables tracked to the rupee.</span>
          </li>
        </ul>
      </div>
    </>
  );
}
