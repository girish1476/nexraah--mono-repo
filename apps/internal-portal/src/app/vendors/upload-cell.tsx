'use client';

import { useState } from 'react';
import { errorMessage } from '@/apis';
import { readFile, type ReadField } from '@/lib/attachments';
import { useToast } from '@/lib/ui';

/**
 * A compact upload control for a table row — the vendor detail page's way to
 * complete a KYC item or document that's MISSING or REJECTED, without
 * sending the operator back through the onboarding wizard. Same capture
 * contract as `vendors/new/page.tsx`'s `CaptureRow` (kept as a separate,
 * intentionally duplicated component rather than a shared import, so this
 * file never needs to touch `new/page.tsx`). A re-uploaded yard photo is held
 * to the same standard as the original: a photo from a GPS camera app with the
 * time and place printed on it, which Compliance checks.
 *
 * With `read`, a "Fetch" button appears once a file is picked: it reads the
 * number off that file into the box, for the operator to check before
 * uploading. Nothing is stored by fetching.
 */
export function UploadCell({
  placeholder,
  needsReference = true,
  imageOnly = false,
  normalize,
  validate,
  read,
  onUpload,
}: {
  placeholder: string;
  needsReference?: boolean;
  /** A photo, not a PDF — picked from the gallery, so a stamped photo can be chosen. */
  imageOnly?: boolean;
  normalize?: (value: string) => string;
  validate?: (value: string) => string | undefined;
  /** What Fetch reads off the file: what the paper is called, its kind, and the `reference` box. */
  read?: { document: string; docType: string; fields: ReadField[] };
  onUpload: (value: string, file: File) => void | Promise<void>;
}) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  /** Shown under the box while it still holds what Fetch put there. */
  const [fetchNote, setFetchNote] = useState<string | undefined>();

  const handleValueChange = (raw: string) => {
    const next = normalize ? normalize(raw) : raw;
    setValue(next);
    setError(validate ? validate(next) : undefined);
    setFetchNote(undefined);
  };

  const canUpload = needsReference ? !!value.trim() && !error && !!file : !!file;

  const handleUpload = async () => {
    if (!canUpload || !file || busy) return;
    setBusy(true);
    try {
      await onUpload(needsReference ? value.trim() : '', file);
      setValue('');
      setFile(null);
      setFetchNote(undefined);
    } finally {
      setBusy(false);
    }
  };

  const handleFetch = async () => {
    if (!read || !file || fetching) return;
    setFetching(true);
    try {
      const reading = await readFile(file, read.document, read.fields, read.docType);
      const found = reading.values.reference;
      if (!found) {
        toast(reading.notes.reference ?? 'That could not be read off this file — type it in.');
        return;
      }
      handleValueChange(found);
      setFetchNote(reading.notes.reference ?? 'Fetched from the file — check it');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setFetching(false);
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
      {fetchNote && !error && (
        <span className="muted" style={{ fontSize: 11 }}>
          {fetchNote}
        </span>
      )}
      {read && needsReference && (
        <button className="btn btn-secondary btn-sm" disabled={!file || fetching || busy} onClick={handleFetch}>
          {fetching ? 'Fetching…' : '✨ Fetch'}
        </button>
      )}
      <button className="btn btn-secondary btn-sm" disabled={!canUpload || busy} onClick={handleUpload}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </div>
  );
}
