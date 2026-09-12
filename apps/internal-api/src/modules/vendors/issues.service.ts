import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { NumberingService } from '../numbering/numbering.service';
import { IssuesRepository } from './issues.repository';
import type { CreateIssueDto } from './dto/create-issue.dto';
import type { UpdateIssueDto } from './dto/update-issue.dto';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

@Injectable()
export class IssuesService {
  constructor(
    private readonly issuesRepository: IssuesRepository,
    private readonly numberingService: NumberingService,
  ) {}

  async list(status?: string) {
    if (status && !STATUSES.includes(status)) {
      throw new DomainException(400, 'VALIDATION_ERROR', `Unknown issue status: ${status}`);
    }
    return this.issuesRepository.list(status);
  }

  /**
   * Every write answers with the same row shape `list()` returns. The screen
   * swaps the returned object in for the row it has, so a bare `{ id, status }`
   * here blanked the vendor, category and code the moment somebody changed a
   * status — only against the real API, since the mock returned the full row.
   */
  private async row(id: string) {
    const row = await this.issuesRepository.findRow(id);
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown issue: ${id}`);
    return row;
  }

  async create(dto: CreateIssueDto, actor: AuthenticatedUser) {
    let tripId: string | null = null;
    if (dto.tripCode) {
      const trip = await this.issuesRepository.findTripIdByCode(dto.tripCode);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${dto.tripCode}`);
      tripId = trip.id;
    }

    const row = await this.issuesRepository.transaction().execute(async (trx) => {
      const code = await this.numberingService.issue(trx, 'ISSUE');
      return this.issuesRepository.insert(trx, {
        code,
        vendorId: dto.vendorId,
        category: dto.category,
        severity: dto.severity,
        raisedBy: actor.userId,
        tripId,
        note: dto.note ?? null,
      });
    });
    return this.row(row.id);
  }

  async update(id: string, dto: UpdateIssueDto) {
    const existing = await this.issuesRepository.findById(id);
    if (!existing) throw new DomainException(404, 'NOT_FOUND', `Unknown issue: ${id}`);
    if (dto.status && !STATUSES.includes(dto.status)) {
      throw new DomainException(400, 'VALIDATION_ERROR', `Unknown issue status: ${dto.status}`);
    }

    const patch: Record<string, unknown> = {};
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.note !== undefined) patch.note = dto.note;

    await this.issuesRepository.update(id, patch);
    return this.row(id);
  }
}
