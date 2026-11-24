import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  type AuthResponse,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
} from '@lims/shared';
import { AppConfig } from '../../core/config/app-config';
import type { RequestUser } from '../../core/context/request-context';
import { AllowPendingPasswordChange, AnyRole, CurrentUser, Public } from '../../core/security/decorators';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { AuthService } from './auth.service';
import type { ClientInfo, IssuedSession } from './session-tokens.service';

export const REFRESH_COOKIE = 'lims_rt';
const REFRESH_COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.login(body, clientInfo(req));
    return this.sendSession(res, session);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    // En cas d'échec, le cookie n'est volontairement pas effacé : lors d'une rotation
    // concurrente (deux onglets), la réponse perdante écraserait le nouveau cookie valide.
    const session = await this.auth.refresh(readRefreshCookie(req), clientInfo(req));
    return this.sendSession(res, session);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @AnyRole()
  @AllowPendingPasswordChange()
  @Get('me')
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.me(user);
  }

  @AnyRole()
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.changePassword(user, body, clientInfo(req));
    return this.sendSession(res, session);
  }

  private sendSession(res: Response, session: IssuedSession): AuthResponse {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.config.refreshTokenTtlMs,
    });
    res.setHeader('Cache-Control', 'no-store');
    return session.response;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

function clientInfo(req: Request): ClientInfo {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}
