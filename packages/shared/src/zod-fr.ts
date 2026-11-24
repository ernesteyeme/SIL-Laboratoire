import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

/** Messages de validation par défaut en français (utilisés si un schéma ne précise pas le sien). */
export const frenchErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Champ obligatoire.' };
      }
      return { message: `Type invalide : ${issue.expected} attendu.` };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return { message: `Doit contenir au moins ${issue.minimum} caractère(s).` };
      }
      if (issue.type === 'array') {
        return { message: `Doit contenir au moins ${issue.minimum} élément(s).` };
      }
      return { message: `Doit être supérieur ou égal à ${issue.minimum}.` };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') {
        return { message: `Doit contenir au plus ${issue.maximum} caractère(s).` };
      }
      if (issue.type === 'array') {
        return { message: `Doit contenir au plus ${issue.maximum} élément(s).` };
      }
      return { message: `Doit être inférieur ou égal à ${issue.maximum}.` };
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Adresse e-mail invalide.' };
      if (issue.validation === 'uuid') return { message: 'Identifiant invalide.' };
      return { message: 'Format invalide.' };
    case ZodIssueCode.invalid_enum_value:
      return { message: `Valeur non autorisée. Valeurs possibles : ${issue.options.join(', ')}.` };
    case ZodIssueCode.invalid_date:
      return { message: 'Date invalide.' };
    case ZodIssueCode.unrecognized_keys:
      return { message: `Champ(s) non autorisé(s) : ${issue.keys.join(', ')}.` };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(frenchErrorMap);
