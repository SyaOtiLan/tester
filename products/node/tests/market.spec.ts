/**
 * node — app marketplace core read journeys.
 *
 * With a seeded wallet session (real SIWE JWT written to localStorage), the
 * marketplace routes are reachable: `ensureWalletSession` returns true on a
 * valid API token even without a live wallet provider. This spec exercises
 * the three read surfaces a user browses:
 *
 *   1. /market                → app grid renders (`.app-center`); if any app
 *      cards exist, open one's 详情 and land on the detail view.
 *   2. /market/dev/my-apps    → 我创建的 / 历史申请 tabs + 创建应用 button.
 *
 * Mutating flows (create/publish an app) live in `app-lifecycle.spec.ts`
 * because every write triggers a wallet `personal_sign`.
 *
 * Selectors verified against node `web/src/views/market/**` and the router
 * table in `web/src/router/index.ts`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';

import { seedWalletSession } from '../helpers/session';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

test(localizedTitle("【应用市场与应用生命周期 / UI】 市场网格呈现并且卡片打开其详细视图", "market grid renders and a card opens its detail view"), async ({ page, recorder }) => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const baseURL = baseURLFor('node')!;

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL, env['NODE_WALLET_PRIVATE_KEY']!);

  await page.goto(`${baseURL}/market`, { waitUntil: 'domcontentloaded' });

  // The grid container always renders; cards may be zero (no empty-state
  // component exists), so assert the container, not a card count.
  await expect(page.locator('.app-center')).toBeVisible({ timeout: 15_000 });
  await recorder.step(page, '应用市场网格');

  const cards = page.locator('.tab.tab-market-clickable');
  const cardCount = await cards.count();
  if (cardCount > 0) {
    // Open the first card's kebab menu → 详情. Element Plus keeps every
    // card's dropdown menu in the DOM (teleported to body); only the opened
    // one is visible, so filter to the visible menu item.
    await cards.first().locator('.card-menu-trigger').click();
    await page.locator('.el-dropdown-menu__item:visible', { hasText: '详情' }).first().click();
    await expect(page).toHaveURL(/\/market\/detail/, { timeout: 10_000 });
    await expect(page.locator('.detail')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('基本信息')).toBeVisible();
    await recorder.step(page, '应用详情页');
  } else {
    // No apps published on this instance — the grid still renders correctly.
    expect(cardCount).toBe(0);
  }
});

test(localizedTitle("【应用市场与应用生命周期 / UI】 我的应用程序视图显示创建者/历史申请选项卡和创建按钮", "my-apps view shows creator/request-history tabs and the create button"), async ({
  page,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const baseURL = baseURLFor('node')!;

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL, env['NODE_WALLET_PRIVATE_KEY']!);

  await page.goto(`${baseURL}/market/dev/my-apps`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('tab', { name: '我创建的' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('tab', { name: '历史申请' })).toBeVisible();
  // 创建应用 is shown while the default (我创建的) tab is active; the
  // history tab is read-only and does not expose a new usage-request action.
  await expect(page.getByRole('button', { name: '创建应用' })).toBeVisible();
  await recorder.step(page, '我的应用（我创建的 / 历史申请）');
});

test(localizedTitle("【应用市场浏览 / UI】 ND-UI-009 应用检索/筛选", "ND-UI-009 market keyword search drives the grid and shows an empty state"), async ({
  page,
  recorder,
}) => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const baseURL = baseURLFor('node')!;

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await seedWalletSession(page, baseURL, env['NODE_WALLET_PRIVATE_KEY']!);

  await page.goto(`${baseURL}/market`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-center')).toBeVisible({ timeout: 15_000 });

  const cards = page.locator('.tab.tab-market-clickable');
  const initialCount = await cards.count();
  await recorder.step(page, '市场默认列表');

  // Typing a keyword re-runs the search (POST /applications/search) with that
  // term and re-renders the grid from the filtered result — a nonsense term
  // that no app can match, so the grid must collapse to the empty state.
  const noMatch = `zzz-no-such-app-${Date.now()}`;
  const searchInput = page.locator('.market-search input');
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await searchInput.fill(noMatch);

  const [emptyRes] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/v1/public/applications/search' &&
        r.request().method() === 'POST' &&
        (r.request().postData() ?? '').includes(noMatch),
      { timeout: 30_000 },
    ),
    searchInput.press('Enter'),
  ]);
  expect(emptyRes.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`keyword=${noMatch}`));
  // Empty state: the grid container still renders, but no card matches.
  await expect(page.locator('.app-center')).toBeVisible();
  await expect(cards).toHaveCount(0);
  await recorder.step(page, '无匹配空态');

  // Clearing the keyword restores the unfiltered result set.
  await searchInput.fill('');
  const [restoreRes] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/v1/public/applications/search' &&
        r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    searchInput.press('Enter'),
  ]);
  expect(restoreRes.status()).toBe(200);
  await expect(page.locator('.app-center')).toBeVisible();
  await expect(cards).toHaveCount(initialCount);
  await recorder.step(page, '清空关键词恢复列表');
});
