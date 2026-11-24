import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { ERROR_CODES, type ApiErrorBody } from '@lims/shared';
import { Prisma } from '../../generated/prisma/client';

const DEFAULT_CODES: Record<number, string> = {
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.AUTH_REQUIRED,
  403: ERROR_CODES.ACCESS_DENIED,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  422: ERROR_CODES.BUSINESS_RULE,
  429: ERROR_CODES.RATE_LIMITED,
};

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Requête invalide.',
  401: 'Authentification requise.',
  403: 'Accès refusé.',
  404: 'Ressource introuvable.',
  409: 'Conflit avec des données existantes.',
  422: 'Règle métier non respectée.',
  429: 'Trop de requêtes. Veuillez patienter avant de réessayer.',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, code, message, details } = this.normalize(exception);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorBody = {
      statusCode: status,
      code,
      message,
      details,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    };

    if (!res.headersSent) {
      res.status(status).json(body);
    }
  }

  private normalize(exception: unknown): { status: number; code: string; message: string; details?: unknown } {
    if (exception instanceof ThrottlerException) {
      return { status: 429, code: ERROR_CODES.RATE_LIMITED, message: DEFAULT_MESSAGES[429] };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null) {
        const r = response as { code?: unknown; message?: unknown; details?: unknown };
        const rawMessage = Array.isArray(r.message) ? r.message.join(' ') : r.message;
        return {
          status,
          code: typeof r.code === 'string' ? r.code : (DEFAULT_CODES[status] ?? `HTTP_${status}`),
          message:
            typeof r.code === 'string' && typeof rawMessage === 'string'
              ? rawMessage
              : (DEFAULT_MESSAGES[status] ?? (typeof rawMessage === 'string' ? rawMessage : exception.message)),
          details: r.details,
        };
      }
      return {
        status,
        code: DEFAULT_CODES[status] ?? `HTTP_${status}`,
        message: DEFAULT_MESSAGES[status] ?? String(response),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            code: ERROR_CODES.CONFLICT,
            message: 'Une donnée identique existe déjà (contrainte d’unicité).',
            details: { fields: exception.meta?.target },
          };
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, code: ERROR_CODES.NOT_FOUND, message: DEFAULT_MESSAGES[404] };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            code: ERROR_CODES.CONFLICT,
            message: 'Opération impossible : la donnée est référencée par d’autres enregistrements.',
          };
        default:
          break;
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Une erreur interne est survenue. Communiquez l’identifiant de requête au support.',
    };
  }
}
