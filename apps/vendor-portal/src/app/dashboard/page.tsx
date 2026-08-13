'use client';

import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { userAtom } from '@/store/atoms';
import { getHealth } from './apis';
import { HealthResponse } from './types';

export default function DashboardPage() {
  const [user] = useAtom(userAtom);
  const [health, setHealth] = useState<HealthResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then((res) => setHealth(res.data))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Signed in as: {user?.name ?? 'guest'}</p>
      {error && <p style={{ color: 'crimson' }}>API error: {error}</p>}
      {health ? (
        <pre>{JSON.stringify(health, null, 2)}</pre>
      ) : (
        !error && <p>Loading API health…</p>
      )}
    </main>
  );
}
