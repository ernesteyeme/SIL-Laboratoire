import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionTokensService } from './session-tokens.service';
import { SessionsModule } from './sessions.module';

@Module({
  imports: [UsersModule, SessionsModule],
  controllers: [AuthController],
  providers: [AuthService, SessionTokensService],
})
export class AuthModule {}
