import { defineConfig, devices, type Project } from '@playwright/test';
import { baseURLFor } from './shared/env';
import { defaultReporters } from './shared/reporters';

const HEADED = process.env.PWHEADLESS === '0';
// Slow-motion: delay (ms) inserted between each action so a headed run is
// watchable by eye. `PWSLOWMO=500` ≈ half a second per step. 0 = off.
// Only meaningful together with a headed run (PWHEADLESS=0, or wallet which
// is always headed).
const SLOW_MO = process.env.PWSLOWMO ? Number(process.env.PWSLOWMO) : 0;

const products = [
  'warehouse',
  'node',
  'router',
  'chat',
  'social',
  'project',
  'knowledge',
  'marketplace',
  'books',
  'orchestrator',
  'wallet',
] as const;

type ProductName = (typeof products)[number];

const chatOverrides = { navigationTimeout: 60_000, actionTimeout: 15_000 };

/**
 * Wallet is a Chromium MV3 extension loaded from disk via `--load-extension`.
 * The path is resolved from `WALLET_EXTENSION_PATH` (preferred) or
 * `WALLET_REPO_PATH` (matches marketplace/books convention).
 *
 * MV3 service workers don't fully load in headless Chromium, so wallet tests
 * run headed by default. The `PWHEADLESS=0` env still works for any
 * already-headed session.
 */
const walletExtensionPath =
  process.env['WALLET_EXTENSION_PATH']?.trim() || process.env['WALLET_REPO_PATH']?.trim() || '';

const walletOverrides: NonNullable<Project['use']> = {
  // Persistent context with the extension loaded; the persistent context is
  // what gives us a real `chrome.runtime.id` and lets the SW keep state.
  launchOptions: walletExtensionPath
    ? {
        channel: 'chromium',
        headless: false,
        slowMo: SLOW_MO,
        args: [
          `--disable-extensions-except=${walletExtensionPath}`,
          `--load-extension=${walletExtensionPath}`,
        ],
      }
    : { channel: 'chromium', headless: false, slowMo: SLOW_MO },
  // Extension service workers can take several seconds to register on first
  // launch; give some headroom for the initial UI assertions.
  actionTimeout: 20_000,
  navigationTimeout: 60_000,
};

const projects: Project[] = products.map((product: ProductName) => ({
  name: product,
  testDir: `products/${product}/tests`,
  testMatch: /.*\.spec\.ts$/,
  outputDir: `results/${product}`,
  // Project (DooTask) is the only suite that writes to a single shared MySQL
  // instance behind Swoole. Under the default per-CPU worker count (~5) the
  // backend saturates and individual write/UI-heavy requests can take well over
  // the default 10s actionTimeout — the requests still succeed, just slowly. The
  // budgets below (60s test / 30s action / 45s nav + one retry) absorb a
  // slow-but-correct response instead of timing it out.
  //
  // NOTE ON PARALLELISM: as the suite grew (now ~128 cases) the default 5-worker
  // run tips into non-deterministic client-side TimeoutErrors on a rotating set
  // of write-heavy specs — pure contention, not a defect (backend stays 200, no
  // OOM/500). Playwright has no per-project worker cap, and we don't want to
  // throttle the fast independent suites globally, so run THIS suite at reduced
  // parallelism for a deterministic 0-fail:
  //     PWWORKERS=2 npx playwright test --project=project
  // Verified: 136 passed / 8 skipped / 0 failed at --workers=2 (0 flaky), vs
  // ~6 failed + ~10 flaky at the 5-worker default. Assertions are identical
  // either way; only the achievable parallelism differs.
  ...(product === 'project' ? { retries: process.env.CI ? 2 : 1, timeout: 60_000 } : {}),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: baseURLFor(product),
    headless: !HEADED,
    launchOptions: { slowMo: SLOW_MO },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    ...(product === 'chat' ? chatOverrides : {}),
    ...(product === 'project' ? { actionTimeout: 30_000, navigationTimeout: 45_000 } : {}),
    ...(product === 'wallet' ? walletOverrides : {}),
  },
}));

export default defineConfig({
  testDir: '.',
  // testDir is overridden per-project; this keeps the root happy when run with --list.
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.PWWORKERS ? Number(process.env.PWWORKERS) : undefined,
  reporter: defaultReporters(),
  // Snapshot env once so each spec sees a consistent view.
  globalSetup: './scripts/global-setup.ts',
  use: {
    headless: !HEADED,
    launchOptions: { slowMo: SLOW_MO },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects,
});
