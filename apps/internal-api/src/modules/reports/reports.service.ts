import { Injectable } from '@nestjs/common';
import { ReportsRepository } from './reports.repository';

function ageDaysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** docs/api/09-reporting.md `GET /reports/today` — three working queues, not a dashboard. */
@Injectable()
export class ReportsService {
  constructor(private readonly reportsRepository: ReportsRepository) {}

  async today(branchId: string | null) {
    const [open, failures, issues, overdue] = await Promise.all([
      this.reportsRepository.openIndents(branchId),
      this.reportsRepository.placementFailures(branchId),
      this.reportsRepository.openVendorIssues(),
      this.reportsRepository.podOverdue(branchId),
    ]);

    const openRows = open.map((i) => ({
      id: i.id,
      code: i.code,
      clientName: i.clientName,
      lane: `${i.fromCity} → ${i.toCity}`,
      // weight_kg is the schema column (NFR-09 bars numeric/float); the API
      // still exposes weightTn — part 02's documented departure.
      weightTn: i.weightKg / 1000,
      truckType: i.truckType,
      pickupDate: i.pickupDate,
      sellRatePaise: i.sellRatePaise,
      quoteCount: i.quoteCount ?? 0,
      branchName: i.branchName,
    }));

    const failureRows = failures.map((i) => ({
      id: i.id,
      code: i.code,
      clientName: i.clientName,
      lane: `${i.fromCity} → ${i.toCity}`,
      pickupDate: i.pickupDate,
      branchName: i.branchName,
      // The nightly placement-failure job writes this; never computed here.
      cause: i.failureCause ?? 'NO_QUOTE_AT_ALL',
      sellRatePaise: i.sellRatePaise,
      quoteCount: i.quoteCount ?? 0,
    }));

    return {
      pendingAllocation: {
        stats: {
          waiting: openRows.length,
          freightAtStakePaise: openRows.reduce((a, r) => a + r.sellRatePaise, 0),
          noQuotes: openRows.filter((r) => r.quoteCount === 0).length,
          quotesIn: openRows.reduce((a, r) => a + r.quoteCount, 0),
          earliestPickup: openRows[0]?.pickupDate ?? null,
          tonnes: openRows.reduce((a, r) => a + r.weightTn, 0),
        },
        rows: openRows,
      },
      placementFailures: {
        stats: {
          failed: failureRows.length,
          freightLostPaise: failureRows.reduce((a, r) => a + r.sellRatePaise, 0),
          neverQuoted: failureRows.filter((r) => r.quoteCount === 0).length,
        },
        rows: failureRows,
      },
      vendorIssues: { rows: issues },
      podOverdue: {
        rows: overdue.map((t) => ({
          tripId: t.tripId,
          tripCode: t.tripCode,
          lane: t.lane,
          vendorName: t.vendorName,
          ageDays: ageDaysSince(String(t.deliveredAt)),
          balanceHeldPaise: t.buyRatePaise - t.advancePaidPaise,
        })),
      },
    };
  }

  /**
   * docs/api/09-reporting.md `GET /reports/home?month=YYYY-MM`. Blocks M and
   * P are scoped to the given month (trips delivered within it); block S
   * ("where things stand") is a current snapshot, not month-scoped — an
   * advance released last month and still outstanding today belongs on it.
   *
   * `onTimePct`, `withinTat`/`breached` and "placed by pickup" have no single
   * formula spelled out in the spec at this granularity; the definitions
   * below are the most literal reading of the fields they're named after
   * (actual vs required transit days; `config.pod_tat_days`; vehicle placed
   * by the indent's own pickup date) rather than an invented shortcut.
   */
  async home(branchId: string | null, month: string | undefined) {
    const { monthStart, monthEnd } = resolveMonth(month);

    const [trips, failures, placedByPickup, advanceOutstanding, balancePending, receivables, unbilledTrips, podTatDays] =
      await Promise.all([
        this.reportsRepository.homeTrips(branchId, monthStart, monthEnd),
        this.reportsRepository.homeFailureCount(branchId, monthStart, monthEnd),
        this.reportsRepository.homePlacedByPickupCount(branchId, monthStart, monthEnd),
        this.reportsRepository.advanceOutstanding(branchId),
        this.reportsRepository.balancePending(branchId),
        this.reportsRepository.receivables(branchId),
        this.reportsRepository.unbilledTripsCount(branchId),
        this.reportsRepository.podTatDays(),
      ]);

    const revenuePaise = trips.reduce((a, t) => a + t.sellRatePaise, 0);
    const costPaise = trips.reduce((a, t) => a + t.buyRatePaise + (t.chargeCostPaise ?? 0), 0);
    const onTime = trips.filter(
      (t) => t.actualTransitDays !== null && t.transitDaysRequired !== null && t.actualTransitDays <= t.transitDaysRequired,
    );

    const branchTotals = new Map<string, { branchName: string; trips: number; revenuePaise: number; costPaise: number }>();
    for (const t of trips) {
      const acc = branchTotals.get(t.branchId) ?? { branchName: t.branchName, trips: 0, revenuePaise: 0, costPaise: 0 };
      acc.trips += 1;
      acc.revenuePaise += t.sellRatePaise;
      acc.costPaise += t.buyRatePaise + (t.chargeCostPaise ?? 0);
      branchTotals.set(t.branchId, acc);
    }

    const clientTotals = new Map<string, { clientName: string; revenuePaise: number }>();
    for (const t of trips) {
      const acc = clientTotals.get(t.clientId) ?? { clientName: t.clientName, revenuePaise: 0 };
      acc.revenuePaise += t.sellRatePaise;
      clientTotals.set(t.clientId, acc);
    }

    const collected = trips.filter((t) => ['APPROVED', 'WAIVED'].includes(t.podStatus));
    const withinTat = collected.filter((t) => tatDays(t.deliveredAt, t.podReceivedAt) <= podTatDays);

    return {
      month: {
        trips: trips.length,
        revenuePaise,
        costPaise,
        marginPaise: revenuePaise - costPaise,
        vendorsUsed: new Set(trips.map((t) => t.vendorId)).size,
        onTimePct: trips.length ? Number(((onTime.length / trips.length) * 100).toFixed(1)) : 0,
        placedByPickup: Number(placedByPickup.c),
        failures: Number(failures.c),
        distinctTrucks: new Set(trips.map((t) => t.vehicleNo)).size,
      },
      branches: [...branchTotals.values()],
      topClients: [...clientTotals.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 5),
      pod: {
        delivered: trips.length,
        collected: collected.length,
        pending: trips.length - collected.length,
        withinTat: withinTat.length,
        breached: collected.length - withinTat.length,
        collectionPct: trips.length ? Number(((collected.length / trips.length) * 100).toFixed(1)) : 0,
        penaltyAccruedPaise: trips.reduce((a, t) => a + t.podPenaltyPaise, 0),
      },
      standing: {
        advanceOutstandingPaise: Number(advanceOutstanding.total),
        balancePendingPaise: Number(balancePending.total),
        receivablesPaise: Number(receivables.total),
        unbilledTrips: Number(unbilledTrips.c),
      },
    };
  }
}

/** `YYYY-MM` → `[first-of-month, first-of-next-month)`; defaults to the current month. */
function resolveMonth(month: string | undefined): { monthStart: string; monthEnd: string } {
  const [yearStr, monthStr] = (month ?? new Date().toISOString().slice(0, 7)).split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { monthStart: start.toISOString().slice(0, 10), monthEnd: end.toISOString().slice(0, 10) };
}

function tatDays(deliveredAt: string | null, podReceivedAt: string | null): number {
  if (!deliveredAt || !podReceivedAt) return Infinity;
  return Math.floor((new Date(podReceivedAt).getTime() - new Date(deliveredAt).getTime()) / 86_400_000);
}
