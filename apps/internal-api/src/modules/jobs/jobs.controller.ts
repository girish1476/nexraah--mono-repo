import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DomainException } from '../../common/domain-exception';
import { JobsService, JOB_NAMES, type JobName } from './jobs.service';

/**
 * Dev/ops manual trigger — calls the exact method a `@Cron()` on
 * `JobsService` would, without waiting on real cron timing (several of
 * these run monthly). Real operation still runs on the schedule; this is
 * only for testing it.
 */
@Controller('admin/jobs')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post(':name/run')
  @RequirePermission('config.manage')
  run(@Param('name') name: string) {
    if (!(JOB_NAMES as readonly string[]).includes(name)) {
      throw new DomainException(404, 'NOT_FOUND', `Unknown job: ${name}. Known jobs: ${JOB_NAMES.join(', ')}.`);
    }
    return this.jobsService.run(name as JobName);
  }
}
