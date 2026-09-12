'use client';

import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { AppHeader, ErrorNote, Facts, Loading, ScreenHeader, TabBar } from '@/components/shell';
import { dateTime } from '@/lib/format';
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
    <main className="screen">
      <AppHeader />
      <ScreenHeader
        title="Connection check"
        sub="Dashboard"
        what="This screen only checks that your phone can reach Nexraah. Your loads, quotes and trips are on their own tabs at the bottom."
      />

      <p style={{ fontSize: 15.5, lineHeight: 1.5, marginBottom: 12 }}>
        {user?.name
          ? `You are signed in as ${user.name}.`
          : 'You are not signed in. You are seeing this as a guest.'}
      </p>

      {error && <ErrorNote message={error} />}
      {!health && !error && <Loading />}

      {health && (
        <>
          <Facts
            rows={[
              ['Connection', health.status],
              ['Service answering', health.service],
              ['Checked at', dateTime(health.timestamp)],
            ]}
          />
          <p className="muted">
            If this screen answers, the app can reach Nexraah. A load or trip that still looks
            wrong is not a signal problem — open that screen and read the note on it.
          </p>
        </>
      )}

      <TabBar />
    </main>
  );
}
