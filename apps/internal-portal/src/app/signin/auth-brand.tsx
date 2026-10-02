/**
 * The brand side of the sign-in screen: the Nexraah logo itself. Its navy
 * background is the page's own (#060e32), so it sits on a plate of the same
 * colour, framed and lit, rather than as a picture pasted on the page. The
 * logo already carries the name and the tagline, so they are not repeated.
 */
export function AuthBrand() {
  return (
    <div className="auth-brand">
      <div className="auth-brand-head">
        <div className="auth-logo-plate">
          <img src="/nexraah-logo.png" alt="Nexraah — Built to move. Born to deliver." className="auth-logo" />
        </div>
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
  );
}
