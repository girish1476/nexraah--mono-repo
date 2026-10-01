'use client';

import { type MouseEvent, useEffect, useState } from 'react';
import { request } from '@/apis';

interface SignedFile {
  url: string;
  mime?: string;
  expiresAt?: string;
}

/**
 * One uploaded file, shown as what it is: a photo as the photo, a PDF as a
 * PDF tile that opens in a new tab. The address is a short-lived signed URL,
 * fetched when the preview mounts — nothing is kept on the page.
 *
 * `size` is the box the preview fits in; a click opens the full file.
 */
export function DocPreview({
  attachmentId,
  label,
  width = 150,
  height = 190,
}: {
  attachmentId: string | null;
  label: string;
  width?: number;
  height?: number;
}) {
  const [file, setFile] = useState<SignedFile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFile(null);
    setFailed(false);
    if (!attachmentId) return;
    let cancelled = false;
    request<SignedFile>({ url: `/attachments/${attachmentId}/url`, method: 'GET' })
      .then((f) => !cancelled && setFile(f))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  const box = {
    width,
    height,
    maxWidth: '100%',
    flex: 'none' as const,
    border: '1px solid var(--color-divider)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface-sunken, #f4f6f9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    fontSize: 12,
    textAlign: 'center' as const,
  };

  if (!attachmentId) {
    return (
      <div style={box} className="muted" aria-label={`${label}: not uploaded`}>
        <span style={{ padding: 10 }}>
          <span aria-hidden style={{ fontSize: 22, display: 'block' }}>
            📄
          </span>
          Not uploaded yet
        </span>
      </div>
    );
  }
  if (failed) {
    return (
      <div style={box} className="muted">
        <span style={{ padding: 10 }}>Could not load the file</span>
      </div>
    );
  }
  if (!file) {
    return (
      <div style={box} className="muted">
        <span>Loading…</span>
      </div>
    );
  }

  // A browser refuses to open a `data:` address in a new tab (the fixture
  // serves files that way), so those open as a blob of the same bytes.
  const open = (e: MouseEvent) => {
    if (!file.url.startsWith('data:')) return;
    e.preventDefault();
    fetch(file.url)
      .then((r) => r.blob())
      .then((b) => window.open(URL.createObjectURL(b), '_blank', 'noopener'))
      .catch(() => undefined);
  };

  const isPdf = (file.mime ?? '').includes('pdf') || /\.pdf(\?|$)/i.test(file.url) || file.url.startsWith('data:application/pdf');
  if (isPdf) {
    return (
      <a href={file.url} target="_blank" rel="noreferrer" onClick={open} style={{ ...box, textDecoration: 'none' }} title={`Open ${label}`}>
        <span style={{ padding: 10 }}>
          <span aria-hidden style={{ fontSize: 30, display: 'block' }}>
            📕
          </span>
          <strong style={{ display: 'block', color: 'var(--color-text)' }}>PDF</strong>
          <span className="muted">Open ↗</span>
        </span>
      </a>
    );
  }
  return (
    <a href={file.url} target="_blank" rel="noreferrer" onClick={open} style={box} title={`Open ${label} full size`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={file.url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
    </a>
  );
}
