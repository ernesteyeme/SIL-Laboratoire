/**
 * Catalogue de démarrage FACULTATIF (voir src/modules/setup/starter-catalog.ts).
 * Idempotent : un élément dont le code existe déjà n'est pas modifié.
 *
 * ⚠ Les tarifs et valeurs de référence sont INDICATIFS : à valider par le biologiste responsable.
 *
 * Lancement : pnpm --filter @lims/api db:seed:catalog
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { applyStarterCatalog } from '../src/modules/setup/starter-catalog';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL est manquant.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const created = await prisma.$transaction((tx) => applyStarterCatalog(tx), { timeout: 60_000 });
    console.log(created > 0 ? `Catalogue de démarrage : ${created} élément(s) créé(s).` : 'Catalogue déjà initialisé : rien à créer.');
    console.log('⚠ Tarifs et valeurs de référence INDICATIFS : à valider par le biologiste responsable.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
