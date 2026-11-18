/** Окружение интеграционных тестов. Можно переопределить переменными TEST_DATABASE_URL / TEST_REDIS_URL. */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://lotok:lotok@localhost:5432/lotok_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  QUEUE_MODE: 'inline',
  MAIL_DRIVER: 'memory',
  SMS_DRIVER: 'memory',
  PUSH_DRIVER: 'memory',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: '/tmp/lotok-test-storage',
  SEARCH_DRIVER: process.env.TEST_SEARCH_DRIVER ?? 'postgres',
  OPENSEARCH_INDEX: 'lotok-test-listings',
  PAYMENT_PROVIDER: 'mock',
  LOG_LEVEL: 'error',
  SWAGGER_ENABLED: 'false',
  API_PUBLIC_URL: 'http://localhost:4999',
  WEB_URL: 'http://localhost:3999',
};
