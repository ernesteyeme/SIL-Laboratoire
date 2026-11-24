import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@lims/shared';

export interface DomainErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** Exception applicative avec un code stable exploitable par le frontend. */
export class DomainException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details } satisfies DomainErrorBody, status);
  }
}

export class NotFoundError extends DomainException {
  constructor(entityLabel: string, id?: string) {
    super(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
      id ? `${entityLabel} introuvable (${id}).` : `${entityLabel} introuvable.`,
    );
  }
}

export class ConflictError extends DomainException {
  constructor(message: string, details?: unknown) {
    super(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, message, details);
  }
}

/** Violation d'une règle métier (HTTP 422). `rule` identifie précisément la règle. */
export class BusinessRuleError extends DomainException {
  constructor(rule: string, message: string) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, ERROR_CODES.BUSINESS_RULE, message, { rule });
  }
}
