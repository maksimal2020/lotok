/* Подготовка чистой БД для E2E (запускается перед стартом API в webServer, т.к. webServer стартует раньше globalSetup). */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');
const Redis = require('ioredis');

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

(async () => {
  const admin = new Client({ connectionString: databaseUrl.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  const dbName = databaseUrl.split('/').pop();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const c = new Client({ connectionString: databaseUrl });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await c.end();
  const r = new Redis(redisUrl);
  await r.flushdb();
  await r.quit();
  const apiDist = path.resolve(__dirname, '../apps/api/dist');
  execFileSync('node', [path.join(apiDist, 'database/migrate.js')], { stdio: 'inherit' });
  execFileSync('node', [path.join(apiDist, 'database/seed/seed.js')], { stdio: 'inherit' });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
