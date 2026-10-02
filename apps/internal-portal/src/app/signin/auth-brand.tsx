/**
 * The brand side of the sign-in screen. The logo already carries the name
 * and the tagline, so it is shown large and lit rather than repeated in text.
 */
export function AuthBrand() {
  return (
    <div className="auth-brand">
      <div className="auth-brand-head">
        <div className="auth-brand-logo-plate">
          <img src="/logo.png" alt="Nexraah — Built to move. Born to deliver." className="auth-brand-logo" />
        </div>
        <div className="auth-brand-tag" style={{ marginTop: 28 }}>
          Operations console
        </div>
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
