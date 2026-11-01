import { defineConfig, devices } from '@playwright/test';
import { baseURLFor } from '../../shared/env';

/**
 * Per-product Playwright project overrides.
 *
 * Root `playwright.config.ts` already declares a project named "orchestrator" with the
 * right testDir and baseURL. This file is what gets loaded when you run
 * `pnpm test --config=products/orchestrator/playwright.config.ts` or when you target
 * just this product through `--project=orchestrator`.
 *
 * It only differs from the root by setting an explicit `metadata.product` tag
 * that specs can read.
 */
const HEADED = process.env.PWHEADLESS === '0';

export default defineConfig({
  testDir: __dirname + '/tests',
  testMatch: /.*\.spec\.ts$/,
  outputDir: 'results/orchestrator',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.PWWORKERS ? Number(process.env.PWWORKERS) : undefined,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: baseURLFor('orchestrator'),
    headless: !HEADED,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 20000,
  },
  metadata: { product: 'orchestrator' },
});
