import { defineConfig } from '@playwright/test';

const storageState = process.env.NOTEBOOKLM_STORAGE_STATE;
const liveUrl = process.env.NOTEBOOKLM_E2E_URL;

export default defineConfig({
  testDir: './playwright',
  testMatch: /.*\.e2e\.js/,
  timeout: 10 * 60 * 1000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: liveUrl || undefined,
    storageState: storageState || undefined,
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        channel: 'chrome',
      },
    },
  ],
});
