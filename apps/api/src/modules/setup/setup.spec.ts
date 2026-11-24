import { passwordPolicySchema } from '@lims/shared';
import type { AppConfig } from '../../core/config/app-config';
import { DomainException } from '../../core/errors/domain.exception';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { PasswordService } from '../../core/security/password.service';
import { temporaryPassword } from '../../cli';
import type { SetupRepository } from './setup.repository';
import { SetupService } from './setup.service';

const rule = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return ((e as DomainException).getResponse() as { details?: { rule?: string } }).details?.rule;
  }
  return undefined;
};

function service(opts: { token: string | null; users?: number; production?: boolean; interopKey?: boolean }) {
  const repo = {
    countHumanUsers: jest.fn().mockResolvedValue(opts.users ?? 0),
    migrations: jest.fn().mockResolvedValue({ count: 9, last: '20261122700000_interop' }),
  } as unknown as SetupRepository;
  const config = {
    setupToken: opts.token,
    isProduction: opts.production ?? true,
    nodeEnv: opts.production === false ? 'development' : 'production',
    interopSecretKey: opts.interopKey === false ? null : Buffer.alloc(32),
  } as unknown as AppConfig;
  return new SetupService({} as PrismaService, repo, config, {} as PasswordService);
}

describe('Assistant du premier démarrage', () => {
  it('exige le code d’installation exact (comparaison à temps constant, espaces tolérés)', async () => {
    const s = service({ token: 'Kx7#mPq2vR9tLw4z' });
    await expect(s.verifyToken('  Kx7#mPq2vR9tLw4z ')).resolves.toBeUndefined();
    expect(rule(() => (s as unknown as { assertToken(t: string): void }).assertToken('mauvais'))).toBe('SETUP_TOKEN_INVALID');
  });

  it('refuse si le serveur n’a pas de code, et une fois un compte créé', async () => {
    expect(rule(() => (service({ token: null }) as unknown as { assertToken(t: string): void }).assertToken('x'))).toBe('SETUP_TOKEN_NOT_CONFIGURED');
    await expect(service({ token: 'abc', users: 1 }).verifyToken('abc')).rejects.toBeInstanceOf(DomainException);
  });

  it('état : contrôles PASS / WARN / FAIL affichés par l’assistant', async () => {
    const ok = await service({ token: 'abc' }).status();
    expect(ok.needsSetup).toBe(true);
    expect(ok.checks.every((c) => c.status === 'PASS')).toBe(true);
    const bad = await service({ token: null, production: false, interopKey: false }).status();
    expect(bad.checks.find((c) => c.label === 'Code d’installation')?.status).toBe('FAIL');
    expect(bad.checks.filter((c) => c.status === 'WARN').map((c) => c.label)).toEqual(['Clé de chiffrement', 'Mode']);
    const done = await service({ token: 'abc', users: 2 }).status();
    expect(done.needsSetup).toBe(false);
    expect(done.checks.some((c) => c.label === 'Code d’installation')).toBe(false);
  });
});

describe('Mot de passe provisoire (lims reset-password)', () => {
  it('respecte la politique et ne se répète pas', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pw = temporaryPassword();
      expect(pw).toHaveLength(16);
      expect(passwordPolicySchema.safeParse(pw).success).toBe(true);
      seen.add(pw);
    }
    expect(seen.size).toBe(200);
  });
});
