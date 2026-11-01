/* eslint-disable playwright/no-skipped-test, playwright/no-conditional-expect -- One deterministic matrix test covers both capability branches and remains environment-gated. */
/**
 * node — email wallet-identity bootstrap Passkey capability selection.
 *
 * This stays in the shared tester because it verifies the rendered user flow,
 * not a Node unit. Chromium's platform-authenticator capability result is
 * overridden before the application loads so both branches are deterministic.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';

test(
  localizedTitle(
    '【无插件邮箱身份 / UI】 ND-UI-011 平台认证器可用时默认本机，不可用时要求选择备用方式',
    'ND-UI-011 email bootstrap defaults to the platform authenticator and requires a fallback when unavailable',
  ),
  async ({ browser }) => {
    const baseURL = baseURLFor('node');
    test.skip(!baseURL, 'NODE_BASE_URL not configured');

    for (const platformAuthenticatorAvailable of [true, false]) {
      const context = await browser.newContext();
      await context.addInitScript((available) => {
        Object.defineProperty(
          globalThis.PublicKeyCredential,
          'isUserVerifyingPlatformAuthenticatorAvailable',
          {
            configurable: true,
            value: async () => available,
          },
        );
      }, platformAuthenticatorAvailable);
      const page = await context.newPage();
      try {
        await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
        await page.locator('.email-mode-switch button').nth(1).click();

        const platform = page.locator('input[type="radio"][value="client-device"]');
        const hybrid = page.locator('input[type="radio"][value="hybrid"]');
        const securityKey = page.locator('input[type="radio"][value="security-key"]');
        if (platformAuthenticatorAvailable) {
          await expect(platform).toBeEnabled();
          await expect(platform).toBeChecked();
        } else {
          await expect(platform).toBeDisabled();
          await expect(platform).not.toBeChecked();
          await expect(hybrid).toBeEnabled();
          await expect(securityKey).toBeEnabled();
          await hybrid.check();
          await expect(hybrid).toBeChecked();
        }
      } finally {
        await context.close();
      }
    }
  },
);
