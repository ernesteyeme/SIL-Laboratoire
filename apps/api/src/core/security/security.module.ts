import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenService } from './access-token.service';
import { PasswordService } from './password.service';
import { SectionAccessService } from './section-access.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AccessTokenService, PasswordService, SectionAccessService],
  exports: [AccessTokenService, PasswordService, SectionAccessService],
})
export class SecurityModule {}
