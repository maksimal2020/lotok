import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './app.module';
import { loadConfig } from './config/config';
import { JobsService } from './infra/jobs.service';
import { SearchService } from './modules/search/search.service';

/**
 * Процесс фоновых заданий: обработка изображений, индексация, уведомления, периодические операции.
 * Масштабируется горизонтально (BullMQ распределяет задания между репликами).
 */
async function main() {
  const config = loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const jobs = app.get(JobsService);
  if (config.SEARCH_DRIVER === 'opensearch') await app.get(SearchService).engine.ensureIndex();
  jobs.startWorkers({ media: 2, search: 4, notifications: 8, payments: 2, maintenance: 1 });

  await jobs.schedule('listings.expire', '*/10 * * * *');
  await jobs.schedule('promotions.daily-bump', '*/30 * * * *');
  await jobs.schedule('promotions.expire', '5 * * * *');
  await jobs.schedule('orders.auto-complete', '15 * * * *');
  await jobs.schedule('orders.cancel-unpaid', '*/5 * * * *');
  await jobs.schedule('payments.reconcile', '*/5 * * * *');
  await jobs.schedule('notify.saved-searches', '*/15 * * * *');
  await jobs.schedule('search.reindex-stale', '*/10 * * * *');
  await jobs.schedule('stats.decay-interests', '30 3 * * *');
  console.log('Worker started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
