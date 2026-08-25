import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { SUPPLY_SOURCE_LABEL } from '../branches/branches.constants';
import { ClientsRepository } from './clients.repository';
import type { CreateClientDto } from './dto/create-client.dto';
import type { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
  ) {}

  async list(q?: string) {
    const rows = await this.clientsRepository.list(q);
    const withOutstanding = await Promise.all(
      rows.map(async (r) => ({ ...r, outstandingPaise: await this.clientsRepository.outstandingPaise(r.id) })),
    );
    return withOutstanding.map(this.toDto);
  }

  async getById(id: string) {
    const row = await this.clientsRepository.findById(id);
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown client: ${id}`);
    const outstandingPaise = await this.clientsRepository.outstandingPaise(id);
    return this.toDto({ ...row, outstandingPaise });
  }

  async create(dto: CreateClientDto, actor: AuthenticatedUser) {
    const row = await this.clientsRepository.transaction().execute(async (trx) => {
      const code = await this.numberingService.issue(trx, 'CLIENT');
      const inserted = await this.clientsRepository.insert(trx, code, {
        name: dto.name,
        billing_city: dto.billingCity,
        engagement: dto.engagement,
        gstin: dto.gstin ?? null,
        contact: dto.contact ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        agreement_no: dto.agreementNo ?? null,
        valid_from: dto.validFrom ?? null,
        valid_to: dto.validTo ?? null,
        agreement_attachment_id: dto.agreementAttachmentId ?? null,
        credit_days: dto.creditDays ?? 0,
        service_level: dto.serviceLevel ?? null,
      });
      await this.auditService.record(trx, actor, {
        action: 'CLIENT_CREATED',
        entityType: 'clients',
        entityId: inserted.id,
        after: { name: inserted.name, engagement: inserted.engagement },
      });
      return inserted;
    });
    return this.toDto({ ...row, outstandingPaise: 0 });
  }

  async update(id: string, dto: UpdateClientDto, actor: AuthenticatedUser) {
    const row = await this.clientsRepository.transaction().execute(async (trx) => {
      const patch: Record<string, unknown> = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.billingCity !== undefined) patch.billing_city = dto.billingCity;
      if (dto.engagement !== undefined) patch.engagement = dto.engagement;
      if (dto.gstin !== undefined) patch.gstin = dto.gstin;
      if (dto.contact !== undefined) patch.contact = dto.contact;
      if (dto.phone !== undefined) patch.phone = dto.phone;
      if (dto.email !== undefined) patch.email = dto.email;
      if (dto.agreementNo !== undefined) patch.agreement_no = dto.agreementNo;
      if (dto.validFrom !== undefined) patch.valid_from = dto.validFrom;
      if (dto.validTo !== undefined) patch.valid_to = dto.validTo;
      if (dto.agreementAttachmentId !== undefined) patch.agreement_attachment_id = dto.agreementAttachmentId;
      if (dto.creditDays !== undefined) patch.credit_days = dto.creditDays;
      if (dto.serviceLevel !== undefined) patch.service_level = dto.serviceLevel;
      if (dto.status !== undefined) patch.status = dto.status;

      const updated = await this.clientsRepository.update(trx, id, patch);
      await this.auditService.record(trx, actor, {
        action: 'CLIENT_UPDATED',
        entityType: 'clients',
        entityId: id,
        after: patch,
      });
      return updated;
    });
    const outstandingPaise = await this.clientsRepository.outstandingPaise(id);
    return this.toDto({ ...row, outstandingPaise });
  }

  // Part 03 §1: read-only here — these rows are what RFQ award wrote (BR-37).
  // A SPOT client has none; the frontend renders the fixed copy for that case.
  //
  // `supplySource` is carried over from the winning RFQ lane at award, so the
  // sheet shows the supply basis the rate was actually built on. A null is a
  // real state (nobody recorded it during sourcing) and is returned as null
  // with a null label rather than being defaulted — the console renders it as
  // "Not recorded" so an operator can see the gap.
  async rateCard(id: string) {
    const client = await this.clientsRepository.findById(id);
    if (!client) throw new DomainException(404, 'NOT_FOUND', `Unknown client: ${id}`);
    const rows = await this.clientsRepository.rateCard(id);
    return rows.map((r) => ({
      id: r.id,
      rfqLaneId: r.rfq_lane_id,
      origin: r.origin,
      destination: r.destination,
      truckType: r.truck_type,
      ratePaise: r.rate,
      transitDays: r.transit_days,
      reportingRule: r.reporting_rule,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      supplySource: r.supply_source,
      supplySourceLabel: r.supply_source ? SUPPLY_SOURCE_LABEL[r.supply_source] : null,
      supplyRemarks: r.supply_remarks,
    }));
  }

  private toDto(row: {
    id: string;
    code: string;
    name: string;
    billing_city: string;
    gstin: string | null;
    contact: string | null;
    phone: string | null;
    email: string | null;
    engagement: string;
    agreement_no: string | null;
    valid_from: string | null;
    valid_to: string | null;
    agreement_attachment_id: string | null;
    credit_days: number;
    service_level: string | null;
    status: string;
    outstandingPaise: number;
  }) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      billingCity: row.billing_city,
      gstin: row.gstin,
      contact: row.contact,
      phone: row.phone,
      email: row.email,
      engagement: row.engagement,
      agreementNo: row.agreement_no,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      agreementAttachmentId: row.agreement_attachment_id,
      creditDays: row.credit_days,
      serviceLevel: row.service_level,
      status: row.status,
      outstandingPaise: row.outstandingPaise,
    };
  }
}
