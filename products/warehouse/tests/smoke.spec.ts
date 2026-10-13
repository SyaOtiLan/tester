/**
 * warehouse — frontend smoke.
 *
 * Env vars consumed:
 *   - WAREHOUSE_BASE_URL (Vite frontend, default http://localhost:5173)
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';

test("【文件管理与导航界面 / UI】 主页呈现可识别的标题", async ({ page }) => {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
  const env = envFor('warehouse');
  await page.goto(env.baseURL!);
  // Pick the first heading; the exact wording depends on the build mode.
  const heading = page.locator('h1, h2').first();
  await expect(heading).toBeVisible();
});
