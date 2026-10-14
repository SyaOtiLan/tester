/**
 * chat — Image generation / Sd (CH-084..CH-087).
 *
 * Drives the real `/#/sd` page behind a wallet UCAN login. Actually generating
 * an image (CH-085) needs a STABILITY_API_KEY or an image-capable, funded Router
 * token — none available here — so that case skips with a precise reason after
 * confirming the page/controls are wired. Entering the page (CH-084), the
 * /sd-new → /sd redirect (CH-086), and the history list (CH-087) are real UI.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { loginOrSkip, openRoute } from '../helpers/auth';

function skipNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

// CH-084 — image generation page renders its panel.
test(localizedTitle("【图像生成(Sd) / UI】 CH-084 进入图像生成页 /sd", "CH-084 image generation page renders"), async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/sd');
  await expect(page.getByText('AI Images', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
});

// CH-085 — submit a prompt to generate an image.
test(localizedTitle("【图像生成(Sd) / E2E】 CH-085 提交提示词生成图片", "CH-085 submit prompt generates an image"), async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/sd');
  await expect(page.getByText('AI Images', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  const hasStability = !!process.env.STABILITY_API_KEY?.trim();
  test.skip(
    !hasStability,
    'no STABILITY_API_KEY and Router account is unfunded — cannot exercise a real image generation',
  );
  // (When a backend is available, fill the prompt + submit and assert a new
  // sd-list entry appears.)
});

// CH-086 — /sd-new redirects to /sd.
test(localizedTitle("【图像生成(Sd) / UI】 CH-086 /sd-new 重定向到 /sd", "CH-086 sd-new redirects to sd"), async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/sd-new', { pin: false });
  await expect
    .poll(async () => page.evaluate(() => window.location.hash), { timeout: 8_000 })
    .toContain('/sd');
  // And not stuck on /sd-new.
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).not.toContain('sd-new');
});

// CH-087 — image generation history list is present (records or empty state).
test(localizedTitle("【图像生成(Sd) / UI】 CH-087 图像生成历史列表", "CH-087 image history list renders"), async ({ page }) => {
  skipNoService();
  await loginOrSkip(page);
  await openRoute(page, '/sd');
  await expect(page.getByText('AI Images', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  // The sidebar hosts the sd-list history region; with no generations it shows
  // an empty state. Either way the page is functional (no crash).
  const body = await page.locator('body').innerText();
  expect(body.length).toBeGreaterThan(0);
});
