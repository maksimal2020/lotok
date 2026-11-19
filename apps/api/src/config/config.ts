import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    WEB_URL: z.string().url().default('http://localhost:3000'),
    ADMIN_URL: z.string().url().default('http://localhost:3001'),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001,http://localhost:8081'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),

    DATABASE_URL: z.string().default('postgres://lotok:lotok@localhost:5432/lotok'),
    DATABASE_POOL_MAX: z.coerce.number().int().default(20),
    REDIS_URL: z.string().default('redis://localhost:6379/0'),

    JWT_ACCESS_SECRET: z.string().min(32).default('dev-only-access-secret-change-me-please-32+'),
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().default(30),
    COOKIE_SECURE: bool.default(false),
    COOKIE_DOMAIN: z.string().optional(),
    /** Секрет для подписи ссылок на приватные файлы и прочих HMAC. */
    APP_SIGNING_SECRET: z.string().min(32).default('dev-only-signing-secret-change-me-please-32+'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./var/storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('ru-central1'),
    S3_BUCKET: z.string().default('lotok-media'),
    S3_PRIVATE_BUCKET: z.string().default('lotok-private'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_PUBLIC_URL: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(true),
    UPLOAD_MAX_IMAGE_MB: z.coerce.number().default(15),
    UPLOAD_MAX_DOCUMENT_MB: z.coerce.number().default(10),
    AV_DRIVER: z.enum(['none', 'clamav']).default('none'),
    CLAMAV_HOST: z.string().default('localhost'),
    CLAMAV_PORT: z.coerce.number().default(3310),

    SEARCH_DRIVER: z.enum(['postgres', 'opensearch']).default('postgres'),
    OPENSEARCH_URL: z.string().default('http://localhost:9200'),
    OPENSEARCH_INDEX: z.string().default('lotok-listings'),
    OPENSEARCH_USERNAME: z.string().optional(),
    OPENSEARCH_PASSWORD: z.string().optional(),
    /** false — максимальная скорость индексации; wait_for — документ виден в поиске сразу (тесты, малые стенды). */
    OPENSEARCH_REFRESH: z.enum(['false', 'wait_for']).default('false'),

    QUEUE_MODE: z.enum(['bullmq', 'inline']).default('bullmq'),

    MAIL_DRIVER: z.enum(['smtp', 'log', 'memory']).default('log'),
    SMTP_URL: z.string().default('smtp://localhost:1025'),
    MAIL_FROM: z.string().default('Лоток <no-reply@lotok.local>'),

    SMS_DRIVER: z.enum(['log', 'memory', 'smsru']).default('log'),
    SMSRU_API_ID: z.string().optional(),

    PUSH_DRIVER: z.enum(['log', 'memory', 'expo']).default('log'),
    EXPO_ACCESS_TOKEN: z.string().optional(),

    PAYMENT_PROVIDER: z.enum(['mock', 'yookassa']).default('mock'),
    MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('dev-only-mock-webhook-secret'),
    YOOKASSA_SHOP_ID: z.string().optional(),
    YOOKASSA_SECRET_KEY: z.string().optional(),
    YOOKASSA_API_URL: z.string().default('https://api.yookassa.ru/v3'),
    YOOKASSA_CHECK_WEBHOOK_IP: bool.default(true),

    DELIVERY_PROVIDER: z.enum(['mock']).default('mock'),

    METRICS_TOKEN: z.string().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SWAGGER_ENABLED: bool.default(true),
    /** Только для E2E-стендов: /api/v1/_test/* (чтение писем и SMS). В production запрещено. */
    ENABLE_TEST_ENDPOINTS: bool.default(false),
    /** Множитель лимитов запросов (для нагрузочных стендов). */
    RATE_LIMIT_MULTIPLIER: z.coerce.number().positive().default(1),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const devDefaults: Array<keyof typeof env> = ['JWT_ACCESS_SECRET', 'APP_SIGNING_SECRET'];
    for (const k of devDefaults) {
      if (String(env[k]).startsWith('dev-only')) ctx.addIssue({ code: 'custom', path: [k], message: 'Production требует собственного секрета' });
    }
    if (env.PAYMENT_PROVIDER === 'yookassa' && (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['YOOKASSA_SHOP_ID'], message: 'Нужны YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY' });
    }
    if (env.ENABLE_TEST_ENDPOINTS) ctx.addIssue({ code: 'custom', path: ['ENABLE_TEST_ENDPOINTS'], message: 'Тестовые эндпоинты запрещены в production' });
    if (env.QUEUE_MODE === 'inline') ctx.addIssue({ code: 'custom', path: ['QUEUE_MODE'], message: 'inline-очередь недопустима в production' });
    if (!env.COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'В production cookie должны быть Secure' });
  });

export type AppConfig = z.infer<typeof envSchema> & { isProd: boolean; isTest: boolean; corsOrigins: string[] };

let cached: AppConfig | null = null;

export function loadConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const env = parsed.data;
  return {
    ...env,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function resetConfigCache() {
  cached = null;
}

export const CONFIG = Symbol('CONFIG');
