import type { CsvConfig, InstrumentProtocol } from '@lims/shared';
import { zonedDateTime } from '../../../core/common/time';
import { parseAstm } from './astm';
import { parseCsv } from './csv';
import { parseHl7 } from './hl7';
import { MessageParseError, type ParsedMessage } from './types';

export { MessageParseError } from './types';
export type { ParsedMessage, ParsedResult } from './types';

/** Point d'entrée unique : choisit l'analyseur selon le protocole de l'automate. */
export function parseInstrumentMessage(raw: string, protocol: InstrumentProtocol, csvConfig: CsvConfig | null, timeZone: string): ParsedMessage {
  const toDate = (p: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null) => (p ? zonedDateTime(p, timeZone) : null);
  switch (protocol) {
    case 'ASTM':
      return parseAstm(raw, toDate);
    case 'HL7':
      return parseHl7(raw, toDate);
    case 'CSV':
      if (!csvConfig) throw new MessageParseError('Configuration CSV absente pour cet automate.');
      return parseCsv(raw, csvConfig, toDate);
  }
}
