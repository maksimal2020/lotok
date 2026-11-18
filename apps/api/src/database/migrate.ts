import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './database.module';

/**
 * Применение миграций. Запускается отдельным шагом деплоя (job/initContainer),
 * под advisory-lock, чтобы параллельные реплики не применяли миграции одновременно.
 */
export async function runMigrations(url = process.env.DATABASE_URL ?? 'postgres://lotok:lotok@localhost:5432/lotok') {
  const pool = createPool(url, 2);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    const db = createDb(pool);
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
    await client.query('SELECT pg_advisory_unlock(727274)');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
