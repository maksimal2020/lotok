import { MiddlewareConsumer, Module, NestModule, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import Redis from 'ioredis';
import { CONFIG, loadConfig, type AppConfig } from './config/config';
import { DatabaseModule, DB, type Db } from './database/database.module';
import { RedisModule, REDIS } from './infra/redis.module';
import { InfraModule } from './infra/infra.module';
import { MetricsMiddleware } from './infra/metrics';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { JwtAuthGuard, PermissionsGuard, RateLimitGuard } from './common/guards';
import { AuthStateService } from './modules/auth/auth-state.service';
import { AuthService } from './modules/auth/auth.service';
import { AuthController } from './modules/auth/auth.controller';
import { UsersService } from './modules/users/users.service';
import { UsersController } from './modules/users/users.controller';
import { CategoriesService } from './modules/catalog/categories.service';
import { RegionsService } from './modules/catalog/regions.service';
import { CatalogController } from './modules/catalog/catalog.controller';
import { MediaService } from './modules/media/media.service';
import { MediaController } from './modules/media/media.controller';
import { ListingPresenter } from './modules/listings/listing.presenter';
import { ListingsService } from './modules/listings/listings.service';
import { AutoModerationService } from './modules/listings/auto-moderation.service';
import { BillingQueries } from './modules/listings/billing-queries.service';
import { ListingsController } from './modules/listings/listings.controller';
import { NotificationsService } from './modules/notifications/notifications.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { SearchService } from './modules/search/search.service';
import { SearchController } from './modules/search/search.controller';
import { SEARCH_ENGINE } from './modules/search/search.types';
import { PostgresSearchEngine } from './modules/search/postgres.engine';
import { OpenSearchEngine } from './modules/search/opensearch.engine';
import { EngagementService } from './modules/engagement/engagement.service';
import { EngagementController } from './modules/engagement/engagement.controller';
import { ChatService } from './modules/chat/chat.service';
import { ChatController } from './modules/chat/chat.controller';
import { ChatGateway } from './modules/chat/chat.gateway';
import { PaymentsService } from './modules/payments/payments.service';
import { PaymentsController } from './modules/payments/payments.controller';
import { LedgerService } from './modules/payments/ledger.service';
import { PAYMENT_PROVIDER } from './modules/payments/providers/payment-provider';
import { MockPaymentProvider } from './modules/payments/providers/mock.provider';
import { YooKassaProvider } from './modules/payments/providers/yookassa.provider';
import { OrdersService } from './modules/orders/orders.service';
import { OrdersController } from './modules/orders/orders.controller';
import { DELIVERY_PROVIDERS, MockDeliveryProvider } from './modules/orders/delivery';
import { BillingService } from './modules/billing/billing.service';
import { AdsService } from './modules/billing/ads.service';
import { BillingController } from './modules/billing/billing.controller';
import { CommunityService } from './modules/community/community.service';
import { CommunityController } from './modules/community/community.controller';
import { OrganizationsService } from './modules/organizations/organizations.service';
import { OrganizationsController } from './modules/organizations/organizations.controller';
import { AdminService } from './modules/admin/admin.service';
import { AdminController } from './modules/admin/admin.controller';
import { HealthController } from './modules/health/health.controller';

/**
 * Модульный монолит: доменные сервисы разнесены по папкам modules/*, но собраны в один DI-контейнер,
 * что исключает циклические зависимости Nest-модулей. HTTP (main.ts) и worker (worker.ts)
 * используют одни и те же сервисы.
 */
export const DOMAIN_PROVIDERS: Provider[] = [
  AuthStateService,
  AuthService,
  UsersService,
  CategoriesService,
  RegionsService,
  MediaService,
  ListingPresenter,
  ListingsService,
  AutoModerationService,
  BillingQueries,
  NotificationsService,
  SearchService,
  EngagementService,
  ChatService,
  PaymentsService,
  LedgerService,
  OrdersService,
  BillingService,
  AdsService,
  CommunityService,
  OrganizationsService,
  AdminService,
  {
    provide: SEARCH_ENGINE,
    inject: [CONFIG, DB],
    useFactory: (c: AppConfig, db: Db) => (c.SEARCH_DRIVER === 'opensearch' ? new OpenSearchEngine(c) : new PostgresSearchEngine(db)),
  },
  {
    provide: PAYMENT_PROVIDER,
    inject: [CONFIG, REDIS],
    useFactory: (c: AppConfig, redis: Redis) => (c.PAYMENT_PROVIDER === 'yookassa' ? new YooKassaProvider(c) : new MockPaymentProvider(redis, c)),
  },
  { provide: DELIVERY_PROVIDERS, useFactory: () => [new MockDeliveryProvider()] },
];

function coreImports(config: AppConfig) {
  return [
    { module: class ConfigHolder {}, global: true, providers: [{ provide: CONFIG, useValue: config }], exports: [CONFIG] } as DynamicModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.LOG_LEVEL,
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    DatabaseModule,
    RedisModule,
    InfraModule,
    JwtModule.register({}),
  ];
}

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      imports: coreImports(config),
      controllers: [
        AuthController,
        UsersController,
        CatalogController,
        MediaController,
        ListingsController,
        NotificationsController,
        SearchController,
        EngagementController,
        ChatController,
        PaymentsController,
        OrdersController,
        BillingController,
        CommunityController,
        OrganizationsController,
        AdminController,
        HealthController,
      ],
      providers: [
        ...DOMAIN_PROVIDERS,
        ChatGateway,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('{*path}');
  }
}

@Module({})
export class WorkerModule {
  static forRoot(config: AppConfig = loadConfig()): DynamicModule {
    return { module: WorkerModule, imports: coreImports(config), providers: DOMAIN_PROVIDERS };
  }
}
