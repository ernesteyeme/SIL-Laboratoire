import { Injectable } from '@nestjs/common';
import type { Dhis2MappingDto, Dhis2MappingInput, VlsmMappingDto, VlsmMappingInput } from '@lims/shared';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { InteropEndpointsService } from './endpoints.service';
import { toDhis2MappingDto, toVlsmMappingDto } from './interop.mapper';
import { InteropRepository } from './interop.repository';

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

@Injectable()
export class InteropMappingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InteropRepository,
    private readonly endpoints: InteropEndpointsService,
    private readonly audit: AuditService,
  ) {}

  // --- DHIS2 -----------------------------------------------------------------

  async listDhis2(endpointId: string): Promise<Dhis2MappingDto[]> {
    await this.endpoints.require(endpointId, { system: 'DHIS2' });
    return (await this.repo.listDhis2Mappings(endpointId)).map(toDhis2MappingDto);
  }

  async createDhis2(endpointId: string, input: Dhis2MappingInput): Promise<Dhis2MappingDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.endpoints.require(endpointId, { system: 'DHIS2' }, tx);
      await this.assertDhis2(tx, endpointId, input);
      const created = await this.uniqueCell(() => tx.dhis2Mapping.create({ data: { endpointId, ...this.dhis2Data(input) } }));
      await this.audit.record(tx, { action: 'CREATE', entity: 'Dhis2Mapping', entityId: created.id, after: created });
      return created.id;
    });
    return toDhis2MappingDto((await this.repo.findDhis2Mapping(id))!);
  }

  async updateDhis2(id: string, input: Dhis2MappingInput): Promise<Dhis2MappingDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.dhis2Mapping.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Correspondance DHIS2', id);
      await this.assertDhis2(tx, before.endpointId, input, id);
      const after = await this.uniqueCell(() => tx.dhis2Mapping.update({ where: { id }, data: this.dhis2Data(input) }));
      await this.audit.record(tx, { action: 'UPDATE', entity: 'Dhis2Mapping', entityId: id, before, after });
    });
    return toDhis2MappingDto((await this.repo.findDhis2Mapping(id))!);
  }

  async deleteDhis2(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.dhis2Mapping.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Correspondance DHIS2', id);
      await tx.dhis2Mapping.delete({ where: { id } });
      await this.audit.record(tx, { action: 'DELETE', entity: 'Dhis2Mapping', entityId: id, before });
    });
  }

  private dhis2Data(input: Dhis2MappingInput) {
    const numeric = input.measure === 'NUMERIC_BELOW' || input.measure === 'NUMERIC_AT_OR_ABOVE';
    return {
      label: input.label,
      parameterId: input.parameterId,
      measure: input.measure,
      threshold: numeric && input.threshold !== null ? new Prisma.Decimal(input.threshold) : null,
      textMatch: input.measure === 'TEXT_EQUALS' ? input.textMatch : null,
      sex: input.sex,
      ageMinYears: input.ageMinYears,
      ageMaxYears: input.ageMaxYears,
      dataElement: input.dataElement,
      categoryOptionCombo: input.categoryOptionCombo,
      displayOrder: input.displayOrder,
      isActive: input.isActive,
    };
  }

  private async assertDhis2(tx: Db, endpointId: string, input: Dhis2MappingInput, exceptId?: string): Promise<void> {
    const parameter = await this.repo.findParameter(tx, input.parameterId);
    if (!parameter) throw new NotFoundError('Paramètre', input.parameterId);
    if ((input.measure === 'NUMERIC_BELOW' || input.measure === 'NUMERIC_AT_OR_ABOVE') && parameter.resultType !== 'NUMERIC') {
      throw new BusinessRuleError('DHIS2_MEASURE_NEEDS_NUMERIC', `Un seuil ne s’applique qu’à un paramètre numérique (${parameter.code} est ${parameter.resultType}).`);
    }
    if (input.measure === 'TEXT_EQUALS') {
      if (parameter.resultType === 'NUMERIC') {
        throw new BusinessRuleError('DHIS2_MEASURE_NEEDS_TEXT', `Une comparaison de texte ne s’applique pas au paramètre numérique ${parameter.code}.`);
      }
      if (parameter.resultType === 'CHOICE' && !parameter.choices.some((c) => normalize(c) === normalize(input.textMatch!))) {
        throw new BusinessRuleError('DHIS2_TEXT_NOT_A_CHOICE', `« ${input.textMatch} » ne fait pas partie des choix du paramètre ${parameter.code} (${parameter.choices.join(', ')}).`);
      }
    }
    const cell = await this.repo.findDhis2Cell(tx, endpointId, input.dataElement, input.categoryOptionCombo, exceptId);
    if (cell) throw new ConflictError(`La cellule DHIS2 ${input.dataElement}${input.categoryOptionCombo ? `.${input.categoryOptionCombo}` : ''} est déjà alimentée par « ${cell.label} ».`);
  }

  private async uniqueCell<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('Cette cellule DHIS2 (élément × combinaison) est déjà alimentée par une autre règle.');
      throw e;
    }
  }

  // --- VLSM ------------------------------------------------------------------

  async listVlsm(endpointId: string): Promise<VlsmMappingDto[]> {
    await this.endpoints.require(endpointId, { system: 'VLSM' });
    return (await this.repo.listVlsmMappings(endpointId)).map(toVlsmMappingDto);
  }

  async createVlsm(endpointId: string, input: VlsmMappingInput): Promise<VlsmMappingDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.endpoints.require(endpointId, { system: 'VLSM' }, tx);
      await this.assertVlsm(tx, input);
      const created = await this.uniqueParameter(() => tx.vlsmMapping.create({ data: { endpointId, ...this.vlsmData(input) } }));
      await this.audit.record(tx, { action: 'CREATE', entity: 'VlsmMapping', entityId: created.id, after: created });
      return created.id;
    });
    return toVlsmMappingDto((await this.repo.findVlsmMapping(id))!);
  }

  async updateVlsm(id: string, input: VlsmMappingInput): Promise<VlsmMappingDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.vlsmMapping.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Correspondance VLSM', id);
      await this.assertVlsm(tx, input);
      const after = await this.uniqueParameter(() => tx.vlsmMapping.update({ where: { id }, data: this.vlsmData(input) }));
      await this.audit.record(tx, { action: 'UPDATE', entity: 'VlsmMapping', entityId: id, before, after });
    });
    return toVlsmMappingDto((await this.repo.findVlsmMapping(id))!);
  }

  async deleteVlsm(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.vlsmMapping.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Correspondance VLSM', id);
      await tx.vlsmMapping.delete({ where: { id } });
      await this.audit.record(tx, { action: 'DELETE', entity: 'VlsmMapping', entityId: id, before });
    });
  }

  private vlsmData(input: VlsmMappingInput) {
    const eid = input.testType === 'EID';
    return {
      parameterId: input.parameterId,
      testType: input.testType,
      eidPositive: eid ? input.eidPositive : null,
      eidNegative: eid ? input.eidNegative : null,
      eidIndeterminate: eid ? input.eidIndeterminate : null,
      isActive: input.isActive,
    };
  }

  private async assertVlsm(tx: Db, input: VlsmMappingInput): Promise<void> {
    const parameter = await this.repo.findParameter(tx, input.parameterId);
    if (!parameter) throw new NotFoundError('Paramètre', input.parameterId);
    if (input.testType === 'VL' && parameter.resultType === 'CHOICE') {
      throw new BusinessRuleError('VLSM_VL_NEEDS_VALUE', `La charge virale se transmet depuis un paramètre numérique ou texte (${parameter.code} est un choix).`);
    }
    if (input.testType === 'EID') {
      if (parameter.resultType === 'NUMERIC') throw new BusinessRuleError('VLSM_EID_NEEDS_TEXT', `L’EID se transmet depuis un paramètre qualitatif (${parameter.code} est numérique).`);
      const values = [input.eidPositive, input.eidNegative, input.eidIndeterminate].filter((v): v is string => !!v);
      if (new Set(values.map(normalize)).size !== values.length) throw new BusinessRuleError('VLSM_EID_DUPLICATE', 'Les valeurs positif / négatif / indéterminé doivent être distinctes.');
      if (parameter.resultType === 'CHOICE') {
        const missing = values.filter((v) => !parameter.choices.some((c) => normalize(c) === normalize(v)));
        if (missing.length) throw new BusinessRuleError('VLSM_EID_NOT_A_CHOICE', `Valeur(s) absente(s) des choix de ${parameter.code} : ${missing.join(', ')} (choix : ${parameter.choices.join(', ')}).`);
      }
    }
  }

  private async uniqueParameter<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('Ce paramètre est déjà transmis par cette connexion VLSM.');
      throw e;
    }
  }
}
