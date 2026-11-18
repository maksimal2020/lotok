import 'reflect-metadata';
import { createApp } from './bootstrap';
import { loadConfig } from './config/config';
import { JobsService } from './infra/jobs.service';
import { SearchService } from './modules/search/search.service';

async function main() {
  const config = loadConfig();
  const app = await createApp(config);
  if (config.SEARCH_DRIVER === 'opensearch') {
    await app.get(SearchService).engine.ensureIndex().catch((e) => console.error('OpenSearch index init failed', e));
  }
  if (config.QUEUE_MODE === 'inline') app.get(JobsService);
  await app.listen(config.PORT, '0.0.0.0');
  console.log(`API listening on :${config.PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
