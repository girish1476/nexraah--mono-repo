import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AssistantChatDto } from './assistant.dto';
import { AssistantService } from './assistant.service';

@Controller('assistant')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  // No @RequirePermission: every signed-in desk may ask. What it can be told
  // is decided lookup by lookup, by the permissions of the person asking.
  // Each question is a paid call to an outside service, hence the limit.
  @Post('chat')
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  chat(@Body() dto: AssistantChatDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assistantService.chat(dto, user);
  }
}
