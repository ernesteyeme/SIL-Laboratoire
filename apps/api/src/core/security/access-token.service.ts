import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  /** Version de jeton de l'utilisateur au moment de l'émission. */
  ver: number;
}

const ISSUER = 'lims-api';
const AUDIENCE = 'lims-web';

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  get ttlSeconds(): number {
    return this.config.jwtAccessTtlSeconds;
  }

  sign(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(
      { username: payload.username, ver: payload.ver },
      {
        subject: payload.sub,
        secret: this.config.jwtAccessSecret,
        expiresIn: this.config.jwtAccessTtlSeconds,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  /** Lève une exception si le jeton est invalide, expiré ou mal formé. */
  async verify(token: string): Promise<AccessTokenPayload> {
    const decoded = await this.jwt.verifyAsync<{ sub?: unknown; username?: unknown; ver?: unknown }>(token, {
      secret: this.config.jwtAccessSecret,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof decoded.sub !== 'string' || typeof decoded.username !== 'string' || typeof decoded.ver !== 'number') {
      throw new Error('Charge utile du jeton invalide.');
    }
    return { sub: decoded.sub, username: decoded.username, ver: decoded.ver };
  }
}
