import { Client } from 'pg';
import Redis from 'ioredis';
import { TEST_ENV } from './env';

/** Чистая схема БД + миграции + справочники перед прогоном интеграционных тестов. */
export default async function globalSetup() {
  Object.assign(process.env, TEST_ENV);
  const client = new Client({ connectionString: TEST_ENV.DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await client.end();
  const { runMigrations } = await import('../src/database/migrate');
  await runMigrations(TEST_ENV.DATABASE_URL);
  const { createDb, createPool } = await import('../src/database/database.module');
  const pool = createPool(TEST_ENV.DATABASE_URL, 2);
  const db = createDb(pool);
  const { seedReference, seedStaff } = await import('../src/database/seed/seed');
  await seedReference(db);
  await seedStaff(db);
  await pool.end();
  const redis = new Redis(TEST_ENV.REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
