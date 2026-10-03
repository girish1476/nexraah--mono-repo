import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailHookController } from './email-hook.controller';

@Module({
  controllers: [AuthController, EmailHookController],
  providers: [AuthService],
})
export class AuthModule {}
