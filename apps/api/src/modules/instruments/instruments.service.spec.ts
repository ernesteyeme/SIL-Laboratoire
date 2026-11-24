import type { AuditService } from '../../core/audit/audit.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { PasswordService } from '../../core/security/password.service';
import type { InstrumentsRepository } from './instruments.repository';
import { hashApiKey, InstrumentsService } from './instruments.service';

describe('Clé du connecteur', () => {
  const updates: { apiKeyHash: string; apiKeyPrefix: string }[] = [];
  const tx = {
    instrument: {
      findUnique: jest.fn().mockResolvedValue({ id: 'i1', code: 'XN-1000_HEMATO', apiKeyHash: null, apiKeyPrefix: null }),
      update: jest.fn(({ data }) => {
        updates.push(data);
        return Promise.resolve({});
      }),
    },
  };
  const prisma = { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
  const service = new InstrumentsService(prisma, {} as InstrumentsRepository, {} as PasswordService, { record: jest.fn() } as unknown as AuditService);

  it('le préfixe affiché ne révèle que 4 caractères du secret, même quand le secret contient « _ »', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 300; i++) {
      const { apiKey, prefix } = await service.rotateApiKey('i1');
      keys.push(apiKey);
      expect(apiKey).toMatch(/^sil_xn1000hemato_[A-Za-z0-9_-]{32}$/);
      expect(prefix).toBe(`${apiKey.slice(0, 'sil_xn1000hemato_'.length + 4)}…`);
      expect(prefix.length).toBeLessThanOrEqual(48);
    }
    // Seule l'empreinte est stockée, jamais la clé elle-même
    const stored = JSON.stringify(updates);
    expect(keys.some((k) => stored.includes(k))).toBe(false);
    expect(updates.every((u, i) => u.apiKeyHash === hashApiKey(keys[i]))).toBe(true);
  });

  it('empreinte SHA-256 déterministe', () => {
    expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
