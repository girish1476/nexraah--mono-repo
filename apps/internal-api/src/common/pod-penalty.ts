/**
 * BR-12/BR-24/BR-25 penalty math, extracted out of `PodService` so the
 * nightly `pod-ageing` job (`modules/jobs/jobs.service.ts`) computes the
 * identical number `pod.service.ts` already shows on screen — one formula,
 * not two copies that quietly drift.
 */
export interface PenaltyConfig {
  tatDays: number;
  penaltyPerDayPaise: number;
  forfeitDays: number;
}

/** Clock runs from delivery until receipt, then freezes — never received means it keeps running against `now`. */
export function computePenalty(
  deliveredAt: string | null,
  receivedAt: string | null,
  config: PenaltyConfig,
): { ageDays: number; penaltyPaise: number; forfeited: boolean } {
  if (!deliveredAt) return { ageDays: 0, penaltyPaise: 0, forfeited: false };
  const delivered = new Date(deliveredAt).getTime();
  const clockEnd = receivedAt ? new Date(receivedAt).getTime() : Date.now();
  const ageDays = Math.max(0, Math.floor((clockEnd - delivered) / 86_400_000));
  const penaltyDays = Math.max(0, Math.min(ageDays, config.forfeitDays) - config.tatDays);
  return {
    ageDays,
    penaltyPaise: penaltyDays * config.penaltyPerDayPaise,
    forfeited: ageDays > config.forfeitDays,
  };
}

/** Zero once waived (BR-43) — a waived penalty must never still read as accruing. */
export function effectivePenalty(
  trip: { delivered_at: string | null; pod_received_at: string | null; pod_closure_basis: string | null },
  config: PenaltyConfig,
): { ageDays: number; penaltyPaise: number; forfeited: boolean } {
  const computed = computePenalty(trip.delivered_at, trip.pod_received_at, config);
  if (trip.pod_closure_basis === 'WAIVED') return { ...computed, penaltyPaise: 0 };
  return computed;
}
