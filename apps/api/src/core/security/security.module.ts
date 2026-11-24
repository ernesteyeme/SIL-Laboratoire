import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenService } from './access-token.service';
import { PasswordService } from './password.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AccessTokenService, PasswordService],
  exports: [AccessTokenService, PasswordService],
})
export class SecurityModule {}
