/**
 * Commandes d'exploitation appelées par `lims` (scripts/lims) sur le serveur, hors de l'API HTTP.
 *
 *   node dist/cli.js status                    état de l'installation (JSON)
 *   node dist/cli.js reset-password <login>    mot de passe provisoire pour un compte (perte du mot de passe administrateur)
 *
 * DATABASE_URL est lue dans l'environnement (fichier .env chargé par `lims`).
 */
import { randomInt } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { passwordPolicySchema } from '@lims/shared';
import { PrismaClient } from './generated/prisma/client';
import { APP_INFO } from './core/common/app-info';
import { PasswordService } from './core/security/password.service';

const ALPHABETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '#@%+=!?'];

/** Mot de passe provisoire conforme à la politique (16 caractères, toutes les classes). */
export function temporaryPassword(length = 16): string {
  const all = ALPHABETS.join('');
  const chars = ALPHABETS.map((a) => a[randomInt(a.length)]!);
  while (chars.length < length) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  const pw = chars.join('');
  return passwordPolicySchema.safeParse(pw).success ? pw : temporaryPassword(length);
}

async function main(argv: string[]): Promise<number> {
  const [command, arg] = argv;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL est manquant (lancez la commande par « lims », qui charge le fichier .env).');
    return 2;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (command === 'status') {
      const [users, admins, settings] = await Promise.all([
        prisma.user.count({ where: { isServiceAccount: false } }),
        prisma.user.count({ where: { isServiceAccount: false, isActive: true, roles: { has: 'ADMIN' } } }),
        prisma.labSettings.findUnique({ where: { id: 1 }, select: { name: true, timezone: true } }),
      ]);
      console.log(JSON.stringify({ version: APP_INFO.version, commit: APP_INFO.commit, needsSetup: users === 0, users, activeAdmins: admins, lab: settings?.name ?? null, timezone: settings?.timezone ?? null }));
      return 0;
    }
    if (command === 'reset-password') {
      const username = (arg ?? '').trim().toLowerCase();
      if (!username) {
        console.error('Usage : lims reset-password <identifiant>');
        return 2;
      }
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user || user.isServiceAccount) {
        console.error(`Aucun compte « ${username} ».`);
        return 1;
      }
      if (!user.isActive) {
        console.error(`Le compte « ${username} » est désactivé : un administrateur doit le réactiver depuis l’écran Utilisateurs.`);
        return 1;
      }
      const password = temporaryPassword();
      const hash = await new PasswordService().hash(password);
      await prisma.$transaction(async (tx) => {
        const next = await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: hash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, tokenVersion: { increment: 1 }, passwordChangedAt: new Date() },
        });
        await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' } });
        const view = (u: typeof user) => ({ id: u.id, username: u.username, isActive: u.isActive, mustChangePassword: u.mustChangePassword, lockedUntil: u.lockedUntil?.toISOString() ?? null, tokenVersion: u.tokenVersion });
        await tx.auditLog.create({
          data: {
            actorUsername: 'system',
            action: 'PASSWORD_RESET',
            entity: 'User',
            entityId: user.id,
            before: view(user),
            after: view(next),
            reason: 'Réinitialisation sur le serveur (lims reset-password)',
          },
        });
      });
      console.log(`Mot de passe provisoire de « ${username} » : ${password}`);
      console.log('Il devra être changé à la première connexion. Sessions ouvertes fermées, compte déverrouillé.');
      return 0;
    }
    console.error('Commandes : status | reset-password <identifiant>');
    return 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
