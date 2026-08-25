import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { ConfigRepository } from '../config/config.repository';
import { PodRepository } from '../pod/pod.repository';
import { effectivePenalty, type PenaltyConfig } from '../../common/pod-penalty';
import { IndentsRepository } from '../indents/indents.repository';
import { TelematicsService } from '../telematics/telematics.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { PnlRepository } from '../pnl/pnl.repository';
import { AttachmentsRepository } from '../attachments/attachments.repository';
import { StorageService } from '../attachments/storage.service';
import { IDENTITY_KINDS } from '../attachments/attachments.service';
import { JobsRepository } from './jobs.repository';

/**
 * Every job here has no human behind it — `AuditService.recordSystemEvent`
 * (not `.record`) is how each one leaves a trail, using its own name as the
 * `actor_role`. This app runs as a single instance (part 13 cross-cutting
 * §"single worker") so nothing here needs to coordinate against a
 * concurrent run of itself on *another* instance — but it can still overlap
 * itself on *this* instance, if a manual `POST /admin/jobs/:name/run` lands
 * while that job's own `@Cron` firing is still in flight. `runOnce` guards
 * against exactly that (and only that).
 *
 * Every `@Cron`-decorated method is also reachable by name from
 * `POST /admin/jobs/:name/run` (`jobs.controller.ts`) — real cron timing for
 * production, the same method for testing without waiting on it. `JOB_NAMES`
 * is the shared lookup between the two.
 */
export const JOB_NAMES = [
  'pod-ageing',
  'placement-failure',
  'eway-expiry',
  'telematics-alerts',
  'invoice-ageing',
  'charge-capture-exception',
  'forfeiture-report',
  'notification-dispatch',
  'attachment-retention',
  'identity-image-purge',
  'bank-reconciliation',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

@Injectable()
export class JobsService {
  private readonly logger = new Logger('JobsService');
  private readonly running = new Set<JobName>();

  constructor(
    private readonly jobsRepository: JobsRepository,
    private readonly podRepository: PodRepository,
    private readonly indentsRepository: IndentsRepository,
    private readonly telematicsService: TelematicsService,
    private readonly invoicingService: InvoicingService,
    private readonly pnlRepository: PnlRepository,
    private readonly attachmentsRepository: AttachmentsRepository,
    private readonly storageService: StorageService,
    private readonly configRepository: ConfigRepository,
    private readonly auditService: AuditService,
  ) {}

  run(name: JobName): Promise<unknown> {
    switch (name) {
      case 'pod-ageing':
        return this.podAgeing();
      case 'placement-failure':
        return this.placementFailure();
      case 'eway-expiry':
        return this.ewayExpiry();
      case 'telematics-alerts':
        return this.telematicsAlerts();
      case 'invoice-ageing':
        return this.invoiceAgeing();
      case 'charge-capture-exception':
        return this.chargeCaptureException();
      case 'forfeiture-report':
        return this.forfeitureReport();
      case 'notification-dispatch':
        return this.notificationDispatch();
      case 'attachment-retention':
        return this.attachmentRetention();
      case 'identity-image-purge':
        return this.identityImagePurge();
      case 'bank-reconciliation':
        return this.bankReconciliation();
    }
  }

  /** The only concurrency guard these jobs need — see the class docblock. */
  private async runOnce<T>(name: JobName, fn: () => Promise<T>): Promise<T | { skipped: true; reason: string }> {
    if (this.running.has(name)) {
      this.logger.warn(`${name}: skipped — a run is already in flight.`);
      return { skipped: true, reason: 'already running' };
    }
    this.running.add(name);
    try {
      return await fn();
    } finally {
      this.running.delete(name);
    }
  }

  // ---- pod-ageing — nightly, 00:30 --------------------------------------

  /**
   * The only writer of `trips.pod_penalty` anywhere in this codebase —
   * every reader (`payments`, `reports`, `invoicing`, `vendors`, the
   * transporter portal) already trusts the stored column; nothing until now
   * has actually put a number in it. Uses `effectivePenalty` from
   * `common/pod-penalty.ts` — the exact formula `PodService` shows on
   * screen, not a second copy of it.
   */
  @Cron('30 0 * * *', { name: 'pod-ageing' })
  async podAgeing() {
    return this.runOnce('pod-ageing', async () => {
      const config = await this.penaltyConfig();
      const candidates = await this.podRepository.dueForPenaltySweep();
      let penalised = 0;
      let forfeited = 0;

      for (const trip of candidates) {
        await this.podRepository.transaction().execute(async (trx) => {
          const locked = await this.podRepository.findTripForUpdate(trx, trip.id);
          if (!locked) return;

          const { penaltyPaise, forfeited: isForfeited } = effectivePenalty(
            { delivered_at: locked.delivered_at, pod_received_at: locked.pod_received_at, pod_closure_basis: locked.pod_closure_basis },
            config,
          );

          const patch: Record<string, unknown> = { pod_penalty: penaltyPaise };
          if (isForfeited && locked.pod_closure_basis !== 'WAIVED') {
            patch.pod_status = 'FORFEITED';
            patch.pod_closure_basis = 'FORFEITED';
            patch.stage = 'CLOSED';
            forfeited += 1;
          }
          if (penaltyPaise > 0) penalised += 1;

          await this.podRepository.updateTrip(trx, trip.id, patch);
          await this.auditService.recordSystemEvent(trx, 'POD_AGEING_JOB', {
            action: 'STATUS_CHANGE',
            entityType: 'trips',
            entityId: trip.id,
            after: patch,
          });
        });
      }

      this.logger.log(`pod-ageing: swept ${candidates.length}, penalised ${penalised}, forfeited ${forfeited}`);
      return { swept: candidates.length, penalised, forfeited };
    });
  }

  private async penaltyConfig(): Promise<PenaltyConfig> {
    const config = await this.configRepository.findAll();
    return {
      tatDays: Number(config.get('pod_tat_days') ?? 20),
      penaltyPerDayPaise: Number(config.get('pod_penalty_per_day_paise') ?? 10000),
      forfeitDays: Number(config.get('pod_forfeit_days') ?? 40),
    };
  }

  // ---- placement-failure — nightly, 01:00 -------------------------------

  /**
   * `CLIENT_CANCELLED` has no backing field anywhere in the schema (no
   * cancellation flag/table on indents) — this sweep can only ever produce
   * the other four causes. A row already carrying a `failure_cause` (e.g.
   * one set by hand) is excluded at the query level so this never clobbers
   * it — see `IndentsRepository.dueForPlacementFailure`.
   */
  @Cron('0 1 * * *', { name: 'placement-failure' })
  async placementFailure() {
    return this.runOnce('placement-failure', async () => {
      const candidates = await this.indentsRepository.dueForPlacementFailure();
      let updated = 0;

      for (const indent of candidates) {
        const cause = await this.determineFailureCause(indent);
        if (!cause) continue;

        await this.indentsRepository.transaction().execute(async (trx) => {
          await this.indentsRepository.update(trx, indent.id, { failure_cause: cause });
          await this.auditService.recordSystemEvent(trx, 'PLACEMENT_FAILURE_JOB', {
            action: 'STATUS_CHANGE',
            entityType: 'indents',
            entityId: indent.id,
            after: { failureCause: cause },
          });
        });
        updated += 1;
      }

      this.logger.log(`placement-failure: swept ${candidates.length}, tagged ${updated}`);
      return { swept: candidates.length, tagged: updated };
    });
  }

  private async determineFailureCause(indent: { id: string; stage: string; awarded_quote_id: string | null }) {
    if (indent.stage === 'VENDOR_ASSIGNED') return 'TRUCK_NEVER_REPORTED';

    const quotes = await this.indentsRepository.findQuotes(indent.id);
    if (quotes.length === 0) return 'NO_QUOTE_AT_ALL';
    if (quotes.every((q) => q.bandPosition === 'ABOVE_BAND')) return 'ONLY_ABOVE_BAND_QUOTES';
    const hasInBand = quotes.some((q) => q.bandPosition === 'IN_BAND');
    const hasAccepted = quotes.some((q) => q.status === 'ACCEPTED');
    if (hasInBand && !hasAccepted) return 'IN_BAND_NONE_AWARDED';
    return null; // doesn't fit a known cause — leave it for a human, don't guess
  }

  // ---- eway-expiry — hourly ----------------------------------------------

  /**
   * The e-way branch of `deriveAlerts` depends only on `now`/`ewayValidTill`/
   * the configured warning window — nothing ping-derived — so this converges
   * on the exact same reconciliation `telematics-alerts` calls rather than
   * re-deriving eway logic on its own (`TelematicsService.reconcileAllOpenTrips`).
   */
  @Cron('0 * * * *', { name: 'eway-expiry' })
  async ewayExpiry() {
    return this.runOnce('eway-expiry', async () => {
      await this.telematicsService.reconcileAllOpenTrips();
      return { ok: true };
    });
  }

  // ---- telematics-alerts — every 15 minutes -------------------------------

  @Cron('*/15 * * * *', { name: 'telematics-alerts' })
  async telematicsAlerts() {
    return this.runOnce('telematics-alerts', async () => {
      await this.telematicsService.reconcileAllOpenTrips();
      return { ok: true };
    });
  }

  // ---- invoice-ageing — nightly, 02:00 -----------------------------------

  /** The bucket computation is already live/stateless in `GET /receivables` — this just re-runs it for whatever `notification-dispatch` alerts on. */
  @Cron('0 2 * * *', { name: 'invoice-ageing' })
  async invoiceAgeing() {
    return this.runOnce('invoice-ageing', async () => {
      const { buckets } = await this.invoicingService.receivables({});
      this.logger.log(`invoice-ageing: ${JSON.stringify(buckets)}`);
      return { buckets };
    });
  }

  // ---- charge-capture-exception — weekly, Sunday 00:00 --------------------

  /** Same query `GET /pnl/exceptions` runs, called directly (not through `PnlService`, which enforces per-caller branch scoping that doesn't apply to a whole-book nightly sweep). */
  @Cron('0 0 * * 0', { name: 'charge-capture-exception' })
  async chargeCaptureException() {
    return this.runOnce('charge-capture-exception', async () => {
      const rows = await this.pnlRepository.closedTripsWithNoCharges(null);
      this.logger.log(`charge-capture-exception: ${rows.length} closed trip(s) with no captured charges`);
      return { count: rows.length };
    });
  }

  // ---- forfeiture-report — monthly, 1st at 00:00 ---------------------------

  @Cron('0 0 1 * *', { name: 'forfeiture-report' })
  async forfeitureReport() {
    return this.runOnce('forfeiture-report', async () => {
      const rows = await this.jobsRepository.forfeitedTripsPastMonth();
      const byVendor = new Map<string, { vendorName: string; trips: number; totalPaise: number }>();
      for (const r of rows) {
        const entry = byVendor.get(r.vendorId) ?? { vendorName: r.vendorName, trips: 0, totalPaise: 0 };
        entry.trips += 1;
        entry.totalPaise += r.buyRatePaise;
        byVendor.set(r.vendorId, entry);
      }

      return this.jobsRepository.transaction().execute(async (trx) => {
        for (const [vendorId, summary] of byVendor) {
          await this.jobsRepository.insertNotification(trx, {
            event: 'FORFEITURE_REPORT',
            channel: 'EMAIL',
            recipient: vendorId,
            template_id: 'forfeiture_report_monthly',
            payload: summary,
          });
        }
        await this.auditService.recordSystemEvent(trx, 'FORFEITURE_REPORT_JOB', {
          action: 'STATUS_CHANGE',
          entityType: 'notifications',
          after: { vendorsNotified: byVendor.size },
        });
        return { vendorsNotified: byVendor.size };
      });
    });
  }

  // ---- notification-dispatch — every minute --------------------------------

  /** Stub — no SMS/WhatsApp/push/email provider exists anywhere in this system yet (documented, human-gated). Flips the queue without calling anything. */
  @Cron('* * * * *', { name: 'notification-dispatch' })
  async notificationDispatch() {
    return this.runOnce('notification-dispatch', async () => {
      return this.jobsRepository.transaction().execute(async (trx) => {
        const sent = await this.jobsRepository.dispatchPending(trx);
        return { dispatched: sent.length };
      });
    });
  }

  // ---- attachment-retention — weekly, Sunday 00:00 -------------------------

  @Cron('0 0 * * 0', { name: 'attachment-retention' })
  async attachmentRetention() {
    return this.runOnce('attachment-retention', async () => {
      const expired = await this.attachmentsRepository.findExpired([...IDENTITY_KINDS]);
      let deleted = 0;
      for (const a of expired) {
        // Row first, storage bytes second: the DB delete is transactional
        // and safe to retry if it fails, but Supabase Storage's removal
        // isn't — reversing this order would risk deleting the file while
        // keeping a row that still points at it. If the storage call fails
        // after the row is gone, the result is an orphaned object (harmless,
        // cleanable later), never a dangling reference (a signed-url request
        // that can never succeed again).
        await this.attachmentsRepository.deleteById(a.id);
        try {
          await this.storageService.remove(a.storage_path);
        } catch (e) {
          this.logger.warn(`attachment-retention: row ${a.id} deleted but storage removal failed for ${a.storage_path}: ${(e as Error).message}`);
        }
        deleted += 1;
      }
      this.logger.log(`attachment-retention: deleted ${deleted} of ${expired.length} expired attachment(s)`);
      return { deleted };
    });
  }

  // ---- identity-image-purge — weekly, Sunday 00:00 -------------------------

  /**
   * Deliberately a no-op beyond this log line — `vendors.status` has no
   * "relationship closed" value to trigger on, so there is no signal yet
   * that says an identity image is safe to purge. Scheduled (per spec) so
   * the job exists to wire up the moment that signal does; building more
   * than this would mean inventing a rule nobody has actually specified.
   */
  @Cron('0 0 * * 0', { name: 'identity-image-purge' })
  async identityImagePurge() {
    return this.runOnce('identity-image-purge', async () => {
      this.logger.warn('identity-image-purge: no-op — vendors.status has no "relationship closed" state to trigger on yet.');
      return { purged: 0, note: 'Not implemented — needs a product decision on what marks a relationship closed.' };
    });
  }

  // ---- bank-reconciliation — daily, 03:00 ----------------------------------

  /** Stub — no bank feed table or service exists anywhere in this system (same category as `notification-dispatch`). */
  @Cron('0 3 * * *', { name: 'bank-reconciliation' })
  async bankReconciliation() {
    return this.runOnce('bank-reconciliation', async () => {
      this.logger.warn('bank-reconciliation: no-op — no bank feed integration exists in this system yet.');
      return { reconciled: 0 };
    });
  }
}
