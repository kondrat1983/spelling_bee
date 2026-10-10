import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'node scripts/serve.mjs', env: { PORT: '4173' }, url: 'http://localhost:4173', reuseExistingServer: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-se', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
  ],
});
