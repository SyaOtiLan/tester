/**
 * Router log time-range filter labels and validation (RT-UI-033).
 * Requires a local/test Router with ROUTER_WALLET_PRIVATE_KEY configured.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { seedWalletSession } from '../helpers/session';

test(
  localizedTitle(
    '【管理后台与工作台 / UI】 日志起止时间筛选标注清晰并拒绝倒置范围',
    'log time range filter labels fields and rejects a reversed range',
  ),
  async ({ page, baseURL, recorder }) => {
    test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
    const env = envFor('router');
    test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');

    await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
    await seedWalletSession(page, baseURL!, env['ROUTER_WALLET_PRIVATE_KEY']!);
    await page.route('**/api/v1/public/log**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, page: 1, page_size: 10 },
        }),
      });
    });

    await page.goto(`${baseURL}/workspace/log`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.router-log-table').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /添加条件|Add Filter/ }).click();
    await page.getByRole('button', { name: /起止时间|Time Range/ }).click();

    const startInput = page.getByLabel(/开始时间|Start time/);
    const endInput = page.getByLabel(/截止时间|End time/);
    await expect(startInput).toBeVisible();
    await expect(endInput).toBeVisible();
    await expect(page.locator('.router-log-filter-editor-range-separator')).toHaveText('-');

    const desktopStartBox = await startInput.boundingBox();
    const desktopEndBox = await endInput.boundingBox();
    const desktopEditor = page.locator('.router-log-filter-editor-time-range');
    expect(desktopStartBox).not.toBeNull();
    expect(desktopEndBox).not.toBeNull();
    expect(Math.abs(desktopStartBox!.y - desktopEndBox!.y)).toBeLessThan(2);
    await expect
      .poll(() => desktopEditor.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(startInput).toBeVisible();
    await expect(endInput).toBeVisible();
    const mobileStartBox = await startInput.boundingBox();
    const mobileEndBox = await endInput.boundingBox();
    expect(mobileStartBox).not.toBeNull();
    expect(mobileEndBox).not.toBeNull();
    expect(mobileEndBox!.y).toBeGreaterThan(mobileStartBox!.y);
    await expect
      .poll(() => desktopEditor.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 900 });

    await startInput.fill('2026-11-02T12:00');
    await endInput.fill('2026-11-02T09:52');
    await page.getByRole('button', { name: /确认|Confirm/ }).click();

    await expect(
      page.getByText(
        /开始时间不能晚于截止时间|Start time must be earlier than or equal to end time/,
      ),
    ).toBeVisible();
    await expect(startInput).toHaveValue('2026-11-02T12:00');
    await expect(endInput).toHaveValue('2026-11-02T09:52');
    expect(new URL(page.url()).searchParams.has('start_timestamp')).toBe(false);

    await endInput.fill('2026-11-02T13:00');
    await page.getByRole('button', { name: /确认|Confirm/ }).click();
    await expect(page.locator('.router-log-filter-chip-value')).toContainText(
      /2026-11-02 12:00.*2026-11-02 13:00/,
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get('start_timestamp'))
      .toBe('2026-11-02T12:00');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('end_timestamp'))
      .toBe('2026-11-02T13:00');
    await recorder.step(page, '日志起止时间清晰标注并校验倒置范围');
  },
);
