'use client';

import { useState } from 'react';

/**
 * A compact upload control for a table row — the vendor detail page's way to
 * complete a KYC item or document that's MISSING or REJECTED, without
 * sending the operator back through the onboarding wizard. Same capture
 * contract as `vendors/new/page.tsx`'s `CaptureRow` (kept as a separate,
 * intentionally duplicated component rather than a shared import, so this
 * file never needs to touch `new/page.tsx`). A re-uploaded yard photo is held
 * to the same standard as the original: a photo from a GPS camera app with the
 * time and place printed on it, which Compliance checks.
 */
export function UploadCell({
  placeholder,
  needsReference = true,
  imageOnly = false,
  normalize,
  validate,
  onUpload,
}: {
  placeholder: string;
  needsReference?: boolean;
  /** A photo, not a PDF — picked from the gallery, so a stamped photo can be chosen. */
  imageOnly?: boolean;
  normalize?: (value: string) => string;
  validate?: (value: string) => string | undefined;
  onUpload: (value: string, file: File) => void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const handleValueChange = (raw: string) => {
    const next = normalize ? normalize(raw) : raw;
    setValue(next);
    setError(validate ? validate(next) : undefined);
  };

  const canUpload = needsReference ? !!value.trim() && !error && !!file : !!file;

  const handleUpload = async () => {
    if (!canUpload || !file || busy) return;
    setBusy(true);
    try {
      await onUpload(needsReference ? value.trim() : '', file);
      setValue('');
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      {needsReference && (
        <input
          style={{
            width: 120,
            padding: '5px 7px',
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          placeholder={placeholder}
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          disabled={busy}
        />
      )}
      <input
        type="file"
        accept={imageOnly ? 'image/*' : 'image/*,application/pdf'}
        style={{ width: 120, fontSize: 11 }}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        disabled={busy}
      />
      {error && needsReference && <span style={{ fontSize: 11, color: 'var(--red)' }}>{error}</span>}
      <button className="btn btn-secondary btn-sm" disabled={!canUpload || busy} onClick={handleUpload}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </div>
  );
}
