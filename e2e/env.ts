export const E2E = {
  api: 'http://localhost:4000',
  web: 'http://localhost:3000',
  admin: 'http://localhost:3001',
  databaseUrl: process.env.E2E_DATABASE_URL ?? 'postgres://lotok:lotok@localhost:5432/lotok_e2e',
  redisUrl: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14',
};

/** Окружение API для E2E: тестовые драйверы, inline-очередь, отдельная БД. */
export const API_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: E2E.databaseUrl,
  REDIS_URL: E2E.redisUrl,
  QUEUE_MODE: 'inline',
  MAIL_DRIVER: 'memory',
  SMS_DRIVER: 'memory',
  PUSH_DRIVER: 'memory',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: '/tmp/lotok-e2e-storage',
  SEARCH_DRIVER: process.env.E2E_SEARCH_DRIVER ?? 'postgres',
  PAYMENT_PROVIDER: 'mock',
  ENABLE_TEST_ENDPOINTS: 'true',
  LOG_LEVEL: 'warn',
  API_PUBLIC_URL: 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  ADMIN_URL: 'http://localhost:3001',
  RATE_LIMIT_MULTIPLIER: '20',
};
