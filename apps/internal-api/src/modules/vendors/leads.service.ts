import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { NumberingService } from '../numbering/numbering.service';
import { LeadsRepository } from './leads.repository';
import type { CreateLeadDto } from './dto/create-lead.dto';
import type { UpdateLeadDto } from './dto/update-lead.dto';

const STAGES = ['NEW', 'CONTACTED', 'DOCUMENTS_REQUESTED', 'QUALIFIED', 'CONVERTED', 'DROPPED'];

@Injectable()
export class LeadsService {
  constructor(
    private readonly leadsRepository: LeadsRepository,
    private readonly numberingService: NumberingService,
  ) {}

  async list() {
    const rows = await this.leadsRepository.list();
    return rows.map((row) => ({
      ...this.toDto(row),
      convertedVendorId: row.converted_vendor_id,
      convertedVendorCode: row.converted_vendor_code,
      convertedVendorName: row.converted_vendor_name,
    }));
  }

  async create(dto: CreateLeadDto, actor: AuthenticatedUser) {
    const row = await this.leadsRepository.transaction().execute(async (trx) => {
      // LD- is its own series (part 01 §4.1), never the indent IND- series.
      const code = await this.numberingService.issue(trx, 'LEAD');
      return this.leadsRepository.insert(trx, {
        code,
        name: dto.name,
        city: dto.city ?? null,
        source: dto.source ?? null,
        partyType: dto.partyType ?? null,
        trucksClaimed: dto.trucksClaimed ?? null,
        phone: dto.phone ?? null,
        ownerId: actor.userId,
        notes: dto.notes ?? null,
      });
    });
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateLeadDto) {
    const existing = await this.leadsRepository.findById(id);
    if (!existing) throw new DomainException(404, 'NOT_FOUND', `Unknown lead: ${id}`);

    if (dto.stage && !STAGES.includes(dto.stage)) {
      throw new DomainException(400, 'VALIDATION_ERROR', `Unknown lead stage: ${dto.stage}`);
    }

    const patch: Record<string, unknown> = {};
    if (dto.stage !== undefined) patch.stage = dto.stage;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.city !== undefined) patch.city = dto.city;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.trucksClaimed !== undefined) patch.trucks_claimed = dto.trucksClaimed;

    const row = await this.leadsRepository.update(id, patch);
    return this.toDto(row);
  }

  private toDto(row: {
    id: string;
    code: string;
    name: string;
    city: string | null;
    source: string | null;
    party_type: string | null;
    trucks_claimed: number | null;
    phone: string | null;
    stage: string;
    notes: string | null;
  }) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      city: row.city,
      source: row.source,
      partyType: row.party_type,
      trucksClaimed: row.trucks_claimed,
      phone: row.phone,
      stage: row.stage,
      notes: row.notes,
    };
  }
}
