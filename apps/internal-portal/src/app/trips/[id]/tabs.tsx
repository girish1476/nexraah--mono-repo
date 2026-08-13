'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { slug: '', label: 'Details' },
  { slug: 'documents', label: 'Documents' },
  { slug: 'charges', label: 'Charges' },
  { slug: 'lr', label: 'Lorry receipt' },
];

export function TripTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname() ?? '';
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
              padding: '7px 13px',
              fontSize: 13,
              textDecoration: 'none',
              border: '1px solid var(--color-divider)',
              background: active ? 'var(--color-accent)' : 'var(--color-surface)',
              color: active ? '#F0F3F8' : 'var(--color-text)',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
