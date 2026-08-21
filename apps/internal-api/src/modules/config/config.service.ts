import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { ConfigRepository } from './config.repository';
import type { PatchConfigDto } from './dto/patch-config.dto';
import type { PatchNumberSeriesDto } from './dto/patch-number-series.dto';

@Injectable()
export class ConfigService {
  constructor(
    private readonly configRepository: ConfigRepository,
    private readonly auditService: AuditService,
  ) {}

  // `docs/api/01-foundation.md` `GET /config` — wire key === `config.key` (§4 of
  // the 090400 migration), so no field-name translation is needed here.
  async getConfig(): Promise<Record<string, unknown>> {
    const rows = await this.configRepository.findAll();
    return Object.fromEntries(rows);
  }

  async patchConfig(
    patch: PatchConfigDto,
    actor: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const before = await this.getConfig();
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);

    await this.configRepository.transaction().execute(async (trx) => {
      for (const [key, value] of entries) {
        await this.configRepository.upsert(trx, key, value, actor.userId);
      }
      // NFR-03 / part 01 §8.1: config changes are audited, including the
      // advance document set — removing a member releases money previously held.
      await this.auditService.record(trx, actor, {
        action: 'CONFIG_UPDATED',
        entityType: 'config',
        before,
        after: patch,
      });
    });

    return this.getConfig();
  }

  async listNumberSeries() {
    const rows = await this.configRepository.listSeries();
    return rows.map((row) => ({
      key: row.key,
      prefix: row.prefix,
      nextValue: row.next_value,
      width: row.width,
      scope: row.scope,
      branchId: row.branch_id,
    }));
  }

  async patchNumberSeries(key: string, dto: PatchNumberSeriesDto, actor: AuthenticatedUser) {
    await this.configRepository.transaction().execute(async (trx) => {
      // Locked for the duration of this check-then-write so a concurrent
      // `issue()` (NumberingService) can't consume a value between the
      // SERIES_LOWERED check below and the UPDATE.
      const row = await this.configRepository.findSeries(trx, key);
      if (!row) {
        throw new DomainException(404, 'NOT_FOUND', `Unknown number series: ${key}`);
      }

      // part 01 §4.1: lowering a series below a consumed value is rejected.
      if (dto.nextValue < row.next_value) {
        throw new DomainException(
          409,
          'SERIES_LOWERED',
          `${key} is already at ${row.next_value}; cannot lower to ${dto.nextValue}.`,
        );
      }

      await this.configRepository.updateSeries(trx, row.id, dto.nextValue, dto.width);
      await this.auditService.record(trx, actor, {
        action: 'NUMBER_SERIES_UPDATED',
        entityType: 'number_series',
        entityId: row.id,
        before: { nextValue: row.next_value, width: row.width },
        after: { nextValue: dto.nextValue, width: dto.width },
      });
    });

    return this.listNumberSeries();
  }
}
