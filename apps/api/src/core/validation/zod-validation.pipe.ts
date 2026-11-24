import { HttpStatus, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, output } from 'zod';
import { ERROR_CODES, type ValidationIssue } from '@lims/shared';
import { DomainException } from '../errors/domain.exception';

/**
 * Valide et transforme une entrée (body, query, param) avec un schéma Zod partagé.
 * Usage : `@Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput`
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): output<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
        'Les données envoyées sont invalides.',
        issues,
      );
    }
    return result.data;
  }
}
