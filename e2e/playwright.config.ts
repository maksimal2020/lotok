import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { API_ENV, E2E } from './env';

const root = path.resolve(__dirname, '..');

/**
 * E2E: реальные API (PostgreSQL + Redis), веб и админка в production-сборке.
 * Перед запуском: pnpm build (api, web, admin). См. docs/TESTING.md.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL: E2E.web, locale: 'ru-RU', timezoneId: 'Europe/Moscow', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    { command: 'node ../../e2e/prepare-db.js && node dist/main.js', cwd: path.join(root, 'apps/api'), url: `${E2E.api}/health/ready`, env: API_ENV, reuseExistingServer: false, timeout: 60_000, stdout: 'pipe', stderr: 'pipe' },
    { command: 'npx next start -p 3000', cwd: path.join(root, 'apps/web'), url: E2E.web, env: { API_INTERNAL_URL: E2E.api }, reuseExistingServer: false, timeout: 60_000 },
    { command: 'npx next start -p 3001', cwd: path.join(root, 'apps/admin'), url: E2E.admin, env: { API_INTERNAL_URL: E2E.api }, reuseExistingServer: false, timeout: 60_000 },
  ],
});
