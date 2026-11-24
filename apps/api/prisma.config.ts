import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` n'a pas besoin de la base : l'URL n'est exigée que par migrate/seed.
    url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5432/unset',
  },
});
