/** Unit-тесты — без внешних зависимостей; integration — реальные PostgreSQL и Redis (см. docs/TESTING.md). */
module.exports = {
  testTimeout: 60000,
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.spec.ts'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.e2e.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      maxWorkers: 1,
    },
  ],
};
