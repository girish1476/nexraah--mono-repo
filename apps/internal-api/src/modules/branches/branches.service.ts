import { Injectable } from '@nestjs/common';
import { BranchesRepository } from './branches.repository';

@Injectable()
export class BranchesService {
  constructor(private readonly branchesRepository: BranchesRepository) {}

  // docs/api/01-foundation.md `GET /branches`
  async list() {
    const rows = await this.branchesRepository.findAll();
    return rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      city: b.city,
      catchmentKm: b.catchment_km,
    }));
  }
}
