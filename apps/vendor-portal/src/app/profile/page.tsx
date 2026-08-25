'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Callout, ErrorNote, Facts, Loading, Pill, ScreenHeader, TabBar } from '@/components/shell';
import { inr } from '@/lib/format';
import { DOCUMENT_TONE } from '@/lib/status';
import { getProfile, uploadDocument } from './apis';
import { DOCUMENT_STATUS_LABEL, DocumentStatus, Profile, VendorDocument } from './types';

/** What each document status means for the transporter, in one sentence. */
const DOCUMENT_STATUS_REASON: Record<DocumentStatus, string> = {
  MISSING: 'Nexraah does not have this paper yet.',
  PENDING: 'Sent. Nexraah is checking it — nothing for you to do.',
  VERIFIED: 'Checked and accepted. Nothing to do.',
  REJECTED: 'Not accepted. The reason is written below.',
  EXPIRED: 'The date on this paper has passed. Upload the renewed one.',
};

/** Selfie geo-stamp — a refusal must be visible, never a silent success. */
function currentPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share your location. Use a phone browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () =>
        reject(
          new Error('Location permission is needed for the selfie. Allow it and try again.'),
        ),
    );
  });
}

function DocumentRow({
  doc,
  onUploaded,
  onError,
}: {
  doc: VendorDocument;
  onUploaded: () => void;
  onError: (m: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const geo = doc.needsGeotag ? await currentPosition() : undefined;
      await uploadDocument(doc.kind, file, geo);
      onUploaded();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const action =
    doc.status === 'VERIFIED' ? null : doc.status === 'MISSING' ? 'Upload' : 'Re-upload';

  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--color-divider)' }}>
      <div className="row-between">
        <span style={{ fontSize: 15.5, fontWeight: 600 }}>{doc.label}</span>
        <Pill tone={DOCUMENT_TONE[doc.status]} reason={DOCUMENT_STATUS_REASON[doc.status]}>
          {DOCUMENT_STATUS_LABEL[doc.status]}
        </Pill>
      </div>

      {/* A rejection without a visible reason gets re-uploaded identically and
          rejected again (part 08 §1) — so the reason is the loudest thing here. */}
      {doc.status === 'REJECTED' && (
        <div
          style={{
            marginTop: 8,
            background: 'var(--red-t)',
            borderLeft: '3px solid var(--red)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <p style={{ color: 'var(--red)', fontWeight: 700, fontSize: 14.5 }}>
            Why this was not accepted
          </p>
          {doc.rejectionReason ? (
            <p style={{ marginTop: 4, fontSize: 15, lineHeight: 1.5 }}>
              Rejected {doc.rejectedOn} — {doc.rejectionReason}
            </p>
          ) : (
            <p style={{ marginTop: 4, fontSize: 15, lineHeight: 1.5 }}>
              Rejected {doc.rejectedOn}. The reason has not come through to this screen.
            </p>
          )}
          <p className="muted" style={{ marginTop: 6 }}>
            Put this one thing right first. Sending the same picture again will get the same
            answer.
          </p>
        </div>
      )}
      {doc.status === 'EXPIRED' && (
        <>
          <p style={{ marginTop: 6, fontSize: 15, lineHeight: 1.5 }}>
            Expired {doc.expiredOn}
            {doc.groundsVehicleRegistrationNo
              ? ` · ${doc.groundsVehicleRegistrationNo} is unavailable for new loads until this is renewed`
              : ''}
          </p>
          <p className="muted" style={{ marginTop: 4 }}>
            Upload the renewed paper here.
            {doc.groundsVehicleRegistrationNo
              ? ' That is the only thing that frees the truck — changing its status on the Fleet screen will not.'
              : ' Nexraah checks it and the status changes on its own.'}
          </p>
        </>
      )}

      {action && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            {...(doc.capture ? { capture: 'environment' as const } : {})}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="tap"
            style={{
              marginTop: 8,
              border: '1px solid var(--color-accent)',
              background: 'var(--color-surface)',
              borderRadius: 999,
              padding: '9px 16px',
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--color-accent-700)',
            }}
          >
            {busy ? 'Uploading…' : doc.capture ? `${action} — opens the camera` : action}
          </button>
        </>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    getProfile()
      .then(setProfile)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  if (!profile) {
    return (
      <main className="screen">
        <ScreenHeader
          title="Profile"
          what="Your company details and the papers Nexraah needs from you."
          back="Back"
        />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  return (
    <main className="screen">
      <ScreenHeader
        title="Profile"
        sub={`${profile.companyName} · vendor ${profile.vendorCode}`}
        what="Your company details and every paper Nexraah needs from you. A paper that is rejected or out of date holds up your advance and can stop a truck getting loads."
        back="Back"
      />

      {error && <ErrorNote message={error} />}
      {flash && (
        <Callout tone="mint" title={flash}>
          Nothing more to do. The status changes to Verified once it has been checked.
        </Callout>
      )}

      <Facts
        rows={[
          ['Contact', `${profile.contactName} · ${profile.phone}`],
          ['City', profile.city],
          ['GSTIN', profile.gstin ?? 'Not registered'],
          ['PAN', profile.panMasked],
          ['Aadhaar', `•••• •••• ${profile.aadhaarLast4}`],
          ['Bank account', `${profile.bankAccountMasked} · ${profile.bankIfsc}`],
          ['Advance policy', `${profile.advancePolicyPct}% of freight`],
        ]}
      />

      <div className="card">
        <p className="card-title" style={{ marginBottom: 4 }}>
          Your business with us
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          Your own totals with Nexraah, all trips added together.
        </p>
        <div className="row-between" style={{ padding: '6px 0' }}>
          <span className="muted">Trips carried</span>
          <span>{profile.business.trips}</span>
        </div>
        <div className="row-between" style={{ padding: '6px 0' }}>
          <span className="muted">Freight value of those trips</span>
          <span>{inr(profile.business.valuePaise)}</span>
        </div>
        <div className="row-between" style={{ padding: '6px 0' }}>
          <span className="muted">Still to be paid to you</span>
          <span style={{ fontWeight: 600 }}>{inr(profile.business.outstandingPaise)}</span>
        </div>
      </div>

      {profile.documents.map((group) => (
        <div key={group.group} className="card">
          <p className="card-title">{group.group}</p>
          {group.documents.map((d) => (
            <DocumentRow
              key={d.kind}
              doc={d}
              onUploaded={() => {
                setFlash('Uploaded — sent to compliance for verification');
                load();
              }}
              onError={setError}
            />
          ))}
        </div>
      ))}

      <p className="muted" style={{ marginBottom: 24 }}>
        Your identity is checked once, not on every load. Your Aadhaar number is never kept in
        full — only the last four digits. When a truck&apos;s paper runs out, that truck stops
        getting loads until you upload the new one here; you can see which truck on{' '}
        <Link href="/fleet">Fleet</Link>.
      </p>

      <TabBar />
    </main>
  );
}
