import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { BranchesRepository } from './branches.repository';
import { SUPPLY_SOURCE_LABEL, type SupplySourceCode } from './branches.constants';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

interface BranchRow {
  id: string;
  code: string;
  name: string;
  city: string;
  catchment_km: number;
  supply_source: SupplySourceCode | null;
  supply_remarks: string | null;
}

/** "Visakhapatnam (HO)" → "VIS". Falls back to padding a short name. */
function codeSeedFrom(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  return (letters.slice(0, 3) || 'BRN').padEnd(3, 'X');
}

@Injectable()
export class BranchesService {
  constructor(
    private readonly branchesRepository: BranchesRepository,
    private readonly auditService: AuditService,
  ) {}

  // docs/api/01-foundation.md `GET /branches`
  async list() {
    const rows = await this.branchesRepository.findAll();
    return rows.map((b) => this.toDto(b as BranchRow));
  }

  async create(dto: CreateBranchDto, actor: AuthenticatedUser) {
    const row = await this.branchesRepository.transaction().execute(async (trx) => {
      const code = await this.resolveCode(dto.code, dto.name);
      const inserted = await this.branchesRepository.insert(trx, {
        code,
        name: dto.name,
        city: dto.city,
        catchment_km: dto.catchmentKm ?? 150,
        supply_source: dto.supplySource ?? null,
        supply_remarks: dto.supplyRemarks ?? null,
      });
      await this.auditService.record(trx, actor, {
        action: 'BRANCH_CREATED',
        entityType: 'branches',
        entityId: inserted.id,
        after: { code: inserted.code, name: inserted.name, city: inserted.city },
      });
      return inserted;
    });
    return this.toDto(row as BranchRow);
  }

  async update(id: string, dto: UpdateBranchDto, actor: AuthenticatedUser) {
    const before = (await this.branchesRepository.findById(id)) as BranchRow | undefined;
    if (!before) throw new NotFoundException('Branch not found');

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.city !== undefined) patch.city = dto.city;
    if (dto.catchmentKm !== undefined) patch.catchment_km = dto.catchmentKm;
    if (dto.supplySource !== undefined) patch.supply_source = dto.supplySource;
    if (dto.supplyRemarks !== undefined) patch.supply_remarks = dto.supplyRemarks;
    if (Object.keys(patch).length === 0) return this.toDto(before);
    patch.updated_at = new Date().toISOString();

    const row = await this.branchesRepository.transaction().execute(async (trx) => {
      const updated = await this.branchesRepository.update(trx, id, patch);
      await this.auditService.record(trx, actor, {
        action: 'BRANCH_UPDATED',
        entityType: 'branches',
        entityId: id,
        before: { supplySource: before.supply_source, supplyRemarks: before.supply_remarks },
        after: { supplySource: updated.supply_source, supplyRemarks: updated.supply_remarks },
      });
      return updated;
    });
    return this.toDto(row as BranchRow);
  }

  /**
   * Branch codes are not a gap-free legal series, so they don't go through
   * `numbering` — a readable three-letter stem off the name is what operators
   * actually recognise in a selector.
   */
  private async resolveCode(supplied: string | undefined, name: string): Promise<string> {
    if (supplied) {
      const clash = await this.branchesRepository.findByCode(supplied);
      if (clash) throw new ConflictException(`Branch code ${supplied} is already in use`);
      return supplied;
    }
    const seed = codeSeedFrom(name);
    for (let n = 0; n < 100; n += 1) {
      const candidate = n === 0 ? seed : `${seed}${n}`;
      if (!(await this.branchesRepository.findByCode(candidate))) return candidate;
    }
    throw new ConflictException(`Could not derive a free branch code from "${name}" — supply one`);
  }

  private toDto(b: BranchRow) {
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      city: b.city,
      catchmentKm: b.catchment_km,
      supplySource: b.supply_source,
      supplySourceLabel: b.supply_source ? SUPPLY_SOURCE_LABEL[b.supply_source] : null,
      supplyRemarks: b.supply_remarks,
    };
  }
}
