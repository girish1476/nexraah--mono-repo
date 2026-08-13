'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Callout, ErrorNote, Facts, Loading, Pill, ScreenHeader, TabBar } from '@/components/shell';
import { inr } from '@/lib/format';
import { DOCUMENT_TONE } from '@/lib/status';
import { getProfile, uploadDocument } from './apis';
import { DOCUMENT_STATUS_LABEL, Profile, VendorDocument } from './types';

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
        <span style={{ fontSize: 14 }}>{doc.label}</span>
        <Pill tone={DOCUMENT_TONE[doc.status]}>{DOCUMENT_STATUS_LABEL[doc.status]}</Pill>
      </div>

      {doc.status === 'REJECTED' && doc.rejectionReason && (
        <p className="muted" style={{ marginTop: 4 }}>
          Rejected {doc.rejectedOn} — {doc.rejectionReason}
        </p>
      )}
      {doc.status === 'EXPIRED' && (
        <p className="muted" style={{ marginTop: 4 }}>
          Expired {doc.expiredOn}
          {doc.groundsVehicleRegistrationNo
            ? ` · ${doc.groundsVehicleRegistrationNo} is unavailable for new loads until this is renewed`
            : ''}
        </p>
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
            style={{
              marginTop: 8,
              border: '1px solid var(--color-divider)',
              background: 'var(--color-surface)',
              borderRadius: 999,
              padding: '6px 14px',
              fontSize: 13,
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
        <ScreenHeader title="Profile" back="Back" />
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
        back="Back"
      />

      {error && <ErrorNote message={error} />}
      {flash && <Callout tone="mint" title={flash} />}

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
        <p className="card-title" style={{ marginBottom: 8 }}>
          Your business with us
        </p>
        <div className="row-between" style={{ padding: '6px 0' }}>
          <span className="muted">Trips carried</span>
          <span>{profile.business.trips}</span>
        </div>
        <div className="row-between" style={{ padding: '6px 0' }}>
          <span className="muted">Freight value</span>
          <span>{inr(profile.business.valuePaise)}</span>
        </div>
        <div className="row-between" style={{ padding: '6px 0' }}>
          <span className="muted">Outstanding to you</span>
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
        We verify your identity once, not on every load. Your Aadhaar number is never stored in
        full — only the last four digits. A lapsed vehicle document grounds that truck; see{' '}
        <Link href="/fleet">Fleet</Link>.
      </p>

      <TabBar />
    </main>
  );
}
