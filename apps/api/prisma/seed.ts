/**
 * Initialisation : crée le premier administrateur et la ligne de paramètres du laboratoire.
 * Idempotent : ne modifie rien si les données existent déjà.
 * Lancement : pnpm db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { passwordPolicySchema, usernameSchema } from '@lims/shared';
import { PrismaClient } from '../src/generated/prisma/client';
import { PasswordService } from '../src/core/security/password.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL est manquant.');

  const username = usernameSchema.parse(process.env.SEED_ADMIN_USERNAME ?? 'admin');
  const fullName = (process.env.SEED_ADMIN_FULLNAME ?? 'Administrateur système').trim();
  const passwordCheck = passwordPolicySchema.safeParse(process.env.SEED_ADMIN_PASSWORD ?? '');
  if (!passwordCheck.success) {
    throw new Error(
      `SEED_ADMIN_PASSWORD ne respecte pas la politique : ${passwordCheck.error.issues.map((i) => i.message).join(' ')}`,
    );
  }
  const labName = (process.env.SEED_LAB_NAME ?? "Laboratoire d'Analyses Médicales").trim();

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    await prisma.$transaction(async (tx) => {
      const existingAdmin = await tx.user.findFirst({ where: { roles: { has: 'ADMIN' } } });
      if (existingAdmin) {
        console.log(`Administrateur existant (« ${existingAdmin.username} ») : aucun compte créé.`);
      } else {
        const admin = await tx.user.create({
          data: {
            username,
            fullName,
            roles: ['ADMIN'],
            passwordHash: await new PasswordService().hash(passwordCheck.data),
            mustChangePassword: true,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUsername: 'system',
            action: 'CREATE',
            entity: 'User',
            entityId: admin.id,
            after: { id: admin.id, username: admin.username, fullName: admin.fullName, roles: admin.roles },
            reason: 'Initialisation du système (seed)',
          },
        });
        console.log(`Administrateur « ${username} » créé. Changement de mot de passe exigé à la première connexion.`);
      }

      const settings = await tx.labSettings.findUnique({ where: { id: 1 } });
      if (!settings) {
        const created = await tx.labSettings.create({ data: { id: 1, name: labName } });
        await tx.auditLog.create({
          data: {
            actorUsername: 'system',
            action: 'CREATE',
            entity: 'LabSettings',
            entityId: '1',
            after: { name: created.name, currency: created.currency, timezone: created.timezone },
            reason: 'Initialisation du système (seed)',
          },
        });
        console.log(`Paramètres du laboratoire initialisés (« ${labName} »).`);
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
