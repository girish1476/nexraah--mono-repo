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
    return rows.map((row) => this.toJoinedDto(row));
  }

  async create(dto: CreateLeadDto, actor: AuthenticatedUser) {
    const row = await this.leadsRepository.transaction().execute(async (trx) => {
      // LD- is its own series (part 01 §4.1), never the indent series.
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
    // Joined re-fetch, not `toDto(row)` on the plain insert row — a new lead
    // is never itself converted, but the response shape must still match
    // `list()`/`update()` (see `update()`'s comment) rather than silently
    // omitting `convertedVendor*`.
    return this.joinedDto(row.id);
  }

  async update(id: string, dto: UpdateLeadDto) {
    const existing = await this.leadsRepository.findById(id);
    if (!existing) throw new DomainException(404, 'NOT_FOUND', `Unknown lead: ${id}`);

    if (dto.stage && !STAGES.includes(dto.stage)) {
      throw new DomainException(400, 'VALIDATION_ERROR', `Unknown lead stage: ${dto.stage}`);
    }

    const patch: Record<string, unknown> = {};
    if (dto.stage !== undefined) patch.stage = dto.stage;
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.city !== undefined) patch.city = dto.city;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.source !== undefined) patch.source = dto.source;
    if (dto.partyType !== undefined) patch.party_type = dto.partyType;
    if (dto.trucksClaimed !== undefined) patch.trucks_claimed = dto.trucksClaimed;

    // A lead onboarded from Transporters → New rather than from its own row
    // is linked afterwards; linking is what converts it.
    if (dto.convertedVendorId !== undefined) {
      if (existing.converted_vendor_id && existing.converted_vendor_id !== dto.convertedVendorId) {
        throw new DomainException(409, 'LEAD_ALREADY_CONVERTED', 'This lead is already linked to a different transporter.');
      }
      if (!(await this.leadsRepository.vendorExists(dto.convertedVendorId))) {
        throw new DomainException(404, 'NOT_FOUND', `Unknown transporter: ${dto.convertedVendorId}`);
      }
      const other = await this.leadsRepository.findByConvertedVendor(dto.convertedVendorId);
      if (other && other.id !== id) {
        throw new DomainException(409, 'VENDOR_ALREADY_LINKED', `That transporter already came from lead ${other.code}.`);
      }
      patch.converted_vendor_id = dto.convertedVendorId;
      patch.stage = 'CONVERTED';
    }

    // Converted means "is now a transporter on our books" — a stage picked by
    // hand with no transporter behind it left the lead with no onboarding
    // button and nothing to open.
    if (patch.stage === 'CONVERTED' && !patch.converted_vendor_id && !existing.converted_vendor_id) {
      throw new DomainException(
        400,
        'VALIDATION_ERROR',
        'A lead becomes Converted when it is onboarded, or linked to the transporter it became.',
      );
    }

    await this.leadsRepository.update(id, patch);
    // Joined re-fetch — `update()`'s plain `.returningAll()` row carries the
    // raw `converted_vendor_id` column but never `converted_vendor_code`/
    // `_name` (those need the `vendors` join `list()` does). Returning that
    // plain row here used to blank a converted lead's transporter link the
    // moment anything else about it was edited — the row the screen swaps in
    // has to be the same shape `list()` gave it, or the field this page reads
    // to show "Now a transporter" silently disappears.
    return this.joinedDto(id);
  }

  private async joinedDto(id: string) {
    const row = await this.leadsRepository.findByIdJoined(id);
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown lead: ${id}`);
    return this.toJoinedDto(row);
  }

  private toJoinedDto(row: {
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
    converted_vendor_id: string | null;
    converted_vendor_code: string | null;
    converted_vendor_name: string | null;
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
      convertedVendorId: row.converted_vendor_id,
      convertedVendorCode: row.converted_vendor_code,
      convertedVendorName: row.converted_vendor_name,
    };
  }
}
