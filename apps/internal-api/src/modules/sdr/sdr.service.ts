import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { SdrRepository } from './sdr.repository';
import type { ResolveSdrDto } from './dto/sdr.dto';
import type { WaiveSdrDto } from './dto/waive-sdr.dto';

/**
 * Shortage / damage records. One is raised by the check of a proof of
 * delivery (pod.service.ts) and never by hand, and it puts the trip's balance
 * on hold; resolving one fixes what is deducted from the transporter, and the
 * balance release (payments.service.ts) is what actually takes it, carrying
 * any excess forward to the transporter's later payments.
 */
@Injectable()
export class SdrService {
  constructor(
    private readonly sdrRepository: SdrRepository,
    private readonly auditService: AuditService,
  ) {}

  /** Each record carries where it was recovered from, so the trail runs both ways. */
  private async withRecoveries<T extends { id: string }>(rows: T[]) {
    const recoveries = await this.sdrRepository.recoveriesFor(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...r,
      recoveries: recoveries
        .filter((x) => x.sdrId === r.id)
        .map((x) => ({ tripId: x.tripId, tripCode: x.tripCode, amountPaise: Number(x.amountPaise), at: x.at })),
    }));
  }

  async list(filters: { status?: string; vendorId?: string; tripId?: string }) {
    return this.withRecoveries(await this.sdrRepository.list(filters));
  }

  summary() {
    return this.sdrRepository.summary();
  }

  async get(id: string) {
    const row = await this.sdrRepository.get(id);
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown record: ${id}`);
    return (await this.withRecoveries([row]))[0];
  }

  /**
   * Writes off what is still owed on a resolved record — the transporter's
   * negative balance. Leadership agrees it by mail; Compliance records it, with
   * the mail's subject as the evidence.
   */
  async waive(id: string, dto: WaiveSdrDto, actor: AuthenticatedUser) {
    await this.sdrRepository.transaction().execute(async (trx) => {
      const existing = await this.sdrRepository.findByIdForUpdate(trx, id);
      if (!existing) throw new DomainException(404, 'NOT_FOUND', `Unknown record: ${id}`);
      if (existing.status !== 'RESOLVED' || Number(existing.outstanding) <= 0) {
        throw new DomainException(409, 'NOTHING_TO_WAIVE', `${existing.code} has nothing left to waive.`);
      }
      const amount = await this.sdrRepository.waiveOutstanding(trx, id);
      await this.sdrRepository.insertWaiver(trx, {
        tripId: existing.trip_id,
        sdrId: id,
        amount,
        mailSubject: dto.mailSubject.trim(),
        mailAttachmentId: dto.mailAttachmentId ?? null,
        note: dto.note?.trim() || null,
        waivedBy: actor.userId,
      });
      await this.auditService.record(trx, actor, {
        action: 'SDR_WAIVED',
        entityType: 'trips',
        entityId: existing.trip_id,
        after: { sdr: existing.code, waivedPaise: amount, mail: dto.mailSubject.trim() },
      });
    });
    return this.get(id);
  }

  async resolve(id: string, dto: ResolveSdrDto, actor: AuthenticatedUser) {
    await this.sdrRepository.transaction().execute(async (trx) => {
      const existing = await this.sdrRepository.findByIdForUpdate(trx, id);
      if (!existing) throw new DomainException(404, 'NOT_FOUND', `Unknown record: ${id}`);
      if (existing.status !== 'OPEN') {
        throw new DomainException(409, 'ALREADY_RESOLVED', `${existing.code} is already resolved.`);
      }
      await this.sdrRepository.resolve(trx, id, {
        deductionPaise: dto.deductionPaise,
        note: dto.note?.trim() || null,
        resolvedBy: actor.userId,
      });
      await this.auditService.record(trx, actor, {
        action: 'SDR_RESOLVED',
        entityType: 'trips',
        entityId: existing.trip_id,
        after: { sdr: existing.code, deductionPaise: dto.deductionPaise },
      });
    });
    return this.get(id);
  }
}
