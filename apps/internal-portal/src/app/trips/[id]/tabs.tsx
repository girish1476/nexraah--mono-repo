'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getCrossCheck } from '../apis';

const TABS = [
  { slug: '', label: 'Details' },
  { slug: 'documents', label: 'Documents' },
  { slug: 'charges', label: 'Charges' },
  { slug: 'lr', label: 'Lorry receipt' },
];

export function TripTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname() ?? '';

  // Lightweight, own fetch — the same cross-check GET the documents and LR
  // tabs already call, not the full document list. Lets the Documents tab
  // flag an open mismatch without duplicating that page's data loading.
  const [mismatchCount, setMismatchCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getCrossCheck(tripId)
      .then((c) => {
        if (!cancelled) setMismatchCount(c.overridden ? 0 : c.mismatches.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
      {TABS.map((tab) => {
        const href = `/trips/${tripId}${tab.slug ? `/${tab.slug}` : ''}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 13px',
              fontSize: 13,
              textDecoration: 'none',
              border: '1px solid var(--color-divider)',
              background: active ? 'var(--color-accent)' : 'var(--color-surface)',
              color: active ? '#F0F3F8' : 'var(--color-text)',
            }}
          >
            {tab.label}
            {tab.slug === 'documents' && mismatchCount > 0 && (
              <span
                className="mono"
                style={{
                  fontSize: 10.5,
                  minWidth: 17,
                  height: 17,
                  borderRadius: 'var(--radius-pill)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--red)',
                  color: '#fff',
                  fontWeight: 600,
                }}
              >
                {mismatchCount}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
