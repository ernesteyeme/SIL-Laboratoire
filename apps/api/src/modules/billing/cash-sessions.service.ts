import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  fromCents,
  secondaryCurrencyFor,
  toCents,
  type CashSessionDto,
  type CashSessionReportDto,
  type CloseCashSessionInput,
  type ListCashSessionsQuery,
  type OpenCashSessionInput,
  type Paginated,
} from '@lims/shared';
import type { CashSession } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, DomainException, NotFoundError } from '../../core/errors/domain.exception';
import { NumberingService } from '../../core/numbering/numbering.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BillingRepository } from './billing.repository';
import { expectedCash, toCashSessionDto, toPatientSummary, toPaymentDto } from './billing.mapper';

const money = (d: { toFixed(dp: number): string }) => d.toFixed(2);

const opt = (d: { toFixed(dp: number): string } | null) => (d ? money(d) : null);

function sessionAuditView(s: CashSession) {
  return {
    number: s.number,
    cashierId: s.cashierId,
    status: s.status,
    baseCurrency: s.baseCurrency,
    secondaryCurrency: s.secondaryCurrency,
    openingFloat: money(s.openingFloat),
    openingFloatSecondary: money(s.openingFloatSecondary),
    expectedCash: opt(s.expectedCash),
    countedCash: opt(s.countedCash),
    difference: opt(s.difference),
    expectedCashSecondary: opt(s.expectedCashSecondary),
    countedCashSecondary: opt(s.countedCashSecondary),
    differenceSecondary: opt(s.differenceSecondary),
    closingNote: s.closingNote,
  };
}

/** Voir toutes les sessions : administration et comptabilité. Un caissier ne voit que les siennes. */
const canSeeAllSessions = (actor: RequestUser) => actor.roles.includes('ADMIN') || actor.roles.includes('COMPTABLE');

@Injectable()
export class CashSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: BillingRepository,
    private readonly numbering: NumberingService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
  ) {}

  async current(actor: RequestUser): Promise<CashSessionDto | null> {
    const session = await this.repo.findOpenSession(actor.id);
    return session ? this.toDto(session) : null;
  }

  async open(input: OpenCashSessionInput, actor: RequestUser): Promise<CashSessionDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      if (await this.repo.findOpenSession(actor.id, tx)) {
        throw new BusinessRuleError('SESSION_ALREADY_OPEN', 'Vous avez déjà une session de caisse ouverte.');
      }
      const settings = await this.lab.settings(tx);
      const secondary = secondaryCurrencyFor(settings.currency, settings.secondaryCurrencyEnabled);
      if (!secondary && input.openingFloatSecondary && toCents(input.openingFloatSecondary) > 0) {
        throw new BusinessRuleError('NO_SECONDARY_CURRENCY', 'La caisse n’est pas bi-devise : pas de fond en devise secondaire.');
      }
      const session = await this.repo.createSession(
        {
          number: await this.numbering.cashSessionNumber(tx, settings.timezone),
          cashierId: actor.id,
          baseCurrency: settings.currency,
          secondaryCurrency: secondary,
          openingFloat: input.openingFloat,
          openingFloatSecondary: secondary ? (input.openingFloatSecondary ?? '0') : '0',
        },
        tx,
      );
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'CashSession',
        entityId: session.id,
        after: sessionAuditView(session),
        reason: `Ouverture de caisse, fond : ${money(session.openingFloat)} ${session.baseCurrency}${
          secondary ? ` + ${money(session.openingFloatSecondary)} ${secondary}` : ''
        }`,
      });
      return session;
    });
    return this.toDto(created);
  }

  /**
   * Clôture : espèces attendues = fond de caisse + encaissements en espèces non annulés.
   * Tout écart entre le comptage et l'attendu doit être justifié. Le récapitulatif est figé.
   */
  async close(input: CloseCashSessionInput, actor: RequestUser): Promise<CashSessionDto> {
    const closed = await this.prisma.$transaction(async (tx) => {
      const open = await this.repo.findOpenSession(actor.id, tx);
      if (!open) throw new BusinessRuleError('NO_OPEN_CASH_SESSION', 'Aucune session de caisse ouverte.');
      await this.repo.lock('cash_sessions', open.id, tx);
      const totals = await this.repo.sessionTotals(open.id, tx);
      const expected = expectedCash(open, totals);
      const countedCents = toCents(input.countedCash);
      const differenceCents = countedCents - expected.baseCents;

      let secondary: { expected: number; counted: number; difference: number } | null = null;
      if (open.secondaryCurrency) {
        if (input.countedCashSecondary === undefined) {
          throw new BusinessRuleError(
            'SECONDARY_COUNT_REQUIRED',
            `Comptez aussi les espèces en ${open.secondaryCurrency} (session bi-devise).`,
          );
        }
        const counted = toCents(input.countedCashSecondary);
        secondary = { expected: expected.secondaryCents ?? 0, counted, difference: counted - (expected.secondaryCents ?? 0) };
      }

      const gaps = [
        differenceCents !== 0 ? `${fromCents(differenceCents)} ${open.baseCurrency}` : null,
        secondary && secondary.difference !== 0 ? `${fromCents(secondary.difference)} ${open.secondaryCurrency}` : null,
      ].filter(Boolean);
      if (gaps.length > 0 && !input.note) {
        throw new BusinessRuleError('CLOSING_NOTE_REQUIRED', `Écart de caisse (${gaps.join(' ; ')}) : une justification est obligatoire.`);
      }
      const session = await this.repo.updateSession(
        open.id,
        {
          status: 'CLOSED',
          closedAt: new Date(),
          expectedCash: fromCents(expected.baseCents),
          countedCash: fromCents(countedCents),
          difference: fromCents(differenceCents),
          expectedCashSecondary: secondary ? fromCents(secondary.expected) : null,
          countedCashSecondary: secondary ? fromCents(secondary.counted) : null,
          differenceSecondary: secondary ? fromCents(secondary.difference) : null,
          closingNote: input.note ?? null,
          summary: { totals: totals.byMethod, cancelledCount: totals.cancelledCount, change: fromCents(totals.changeCents) },
        },
        tx,
      );
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'CashSession',
        entityId: session.id,
        before: sessionAuditView(open),
        after: sessionAuditView(session),
        reason: gaps.length === 0 ? 'Clôture de caisse sans écart' : `Clôture de caisse avec écart (${gaps.join(' ; ')}) : ${input.note}`,
      });
      return session;
    });
    return this.toDto(closed);
  }

  async list(query: ListCashSessionsQuery, actor: RequestUser): Promise<Paginated<CashSessionDto>> {
    const [rows, total] = await this.repo.listSessions(query, canSeeAllSessions(actor) ? undefined : actor.id);
    const items = await Promise.all(rows.map((s) => this.toDto(s)));
    return toPage(items, total, query);
  }

  async report(id: string, actor: RequestUser): Promise<CashSessionReportDto> {
    const session = await this.repo.findSession(id);
    if (!session) throw new NotFoundError('Session de caisse', id);
    if (!canSeeAllSessions(actor) && session.cashierId !== actor.id) {
      throw new DomainException(HttpStatus.FORBIDDEN, ERROR_CODES.ACCESS_DENIED, 'Vous ne pouvez consulter que vos propres sessions de caisse.');
    }
    const [dto, payments] = await Promise.all([this.toDto(session), this.repo.sessionPayments(id)]);
    const names = await this.lab.userNames(payments.map((p) => p.receivedById));
    return {
      ...dto,
      payments: payments.map((p) => ({
        ...toPaymentDto(p, names),
        invoiceNumber: p.invoice.number,
        orderNumber: p.invoice.order.number,
        patientName: toPatientSummary(p.invoice.patient).fullName,
      })),
    };
  }

  private async toDto(session: CashSession): Promise<CashSessionDto> {
    const [totals, names] = await Promise.all([this.repo.sessionTotals(session.id), this.lab.userNames([session.cashierId])]);
    return toCashSessionDto(session, names.get(session.cashierId) ?? '—', totals);
  }
}
