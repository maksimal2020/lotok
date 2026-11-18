import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createAdapter } from '@socket.io/redis-adapter';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import Redis from 'ioredis';
import { Logger } from 'nestjs-pino';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import type { AppConfig } from './config/config';
import { StorageService } from './infra/storage.service';

class RedisIoAdapter extends IoAdapter {
  private adapter?: ReturnType<typeof createAdapter>;
  constructor(
    app: INestApplication,
    private readonly redisUrl: string,
    private readonly origins: string[],
  ) {
    super(app);
  }
  connect() {
    const pub = new Redis(this.redisUrl);
    const sub = pub.duplicate();
    this.adapter = createAdapter(pub, sub);
  }
  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, { ...options, cors: { origin: this.origins, credentials: true } });
    server.adapter(this.adapter!);
    return server;
  }
}

export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.TRUST_PROXY);
  app.set('query parser', 'simple');
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({ origin: config.corsOrigins, credentials: true, exposedHeaders: ['Retry-After'] });
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  if (config.STORAGE_DRIVER === 'local') {
    const storage = app.get(StorageService);
    app.use(
      '/files',
      express.static(storage.localRoot(), {
        immutable: true,
        maxAge: '365d',
        setHeaders: (res) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'");
        },
      }),
    );
  }

  if (config.SWAGGER_ENABLED) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Лоток API')
        .setDescription('REST API платформы объявлений «Лоток». Версия v1. Авторизация — Bearer access-токен.')
        .setVersion('1.0.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });
  }

  const io = new RedisIoAdapter(app, config.REDIS_URL, config.corsOrigins);
  io.connect();
  app.useWebSocketAdapter(io);
  app.enableShutdownHooks();
  return app;
}
