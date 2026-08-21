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

  async list() {
    const rows = await this.issuesRepository.list();
    return rows;
  }

  async create(dto: CreateIssueDto, actor: AuthenticatedUser) {
    const row = await this.issuesRepository.transaction().execute(async (trx) => {
      const code = await this.numberingService.issue(trx, 'ISSUE');
      return this.issuesRepository.insert(trx, {
        code,
        vendorId: dto.vendorId,
        category: dto.category,
        severity: dto.severity,
        raisedBy: actor.userId,
        tripId: dto.tripId ?? null,
        note: dto.note ?? null,
      });
    });
    return { id: row.id, code: row.code, status: row.status };
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

    const row = await this.issuesRepository.update(id, patch);
    return { id: row.id, status: row.status };
  }
}
