import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuthService } from './auth.service';

@Controller('auth')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // No @RequirePermission: any authenticated internal principal. This is the
  // first call every page makes — part 01 §1, docs/api/01-foundation.md.
  @Get('session')
  getSession(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.toSession(user);
  }
}
