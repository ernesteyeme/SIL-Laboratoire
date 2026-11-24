import { formatPatientName, type PatientDto } from '@lims/shared';
import type { Patient } from '../../generated/prisma/client';
import { dateToIso } from '../../core/common/values';

export function toPatientDto(p: Patient): PatientDto {
  return {
    id: p.id,
    code: p.code,
    lastName: p.lastName,
    middleName: p.middleName,
    firstName: p.firstName,
    fullName: formatPatientName(p),
    sex: p.sex,
    birthDate: dateToIso(p.birthDate),
    birthDateEstimated: p.birthDateEstimated,
    phone: p.phone,
    email: p.email,
    address: p.address,
    city: p.city,
    externalId: p.externalId,
    notes: p.notes,
    isActive: p.isActive,
    deactivationReason: p.deactivationReason,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Vue d'audit : données d'identification, sans champs techniques. */
export function toPatientAuditView(p: Patient) {
  const { searchName: _s, phoneKey: _p, createdAt: _c, updatedAt: _u, updatedById: _ub, ...rest } = p;
  return { ...rest, birthDate: dateToIso(p.birthDate) };
}
