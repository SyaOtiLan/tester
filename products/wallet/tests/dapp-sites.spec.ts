/**
 * Wallet — dApp integration: connected-site management & revoke (WL-DAPP-015).
 *
 * After a dApp connects it becomes an authorized site. The popup's site
 * manager (walletHeaderMenu → 网站管理 → `#sitesPage`) lists it, and revoking
 * it (`.btn-revoke`) removes the authorization — after which the dApp's
 * `eth_accounts` returns `[]` again.
 *
 * Verified against `js/controller/setting/authorized-sites-controller.js`
 * (list renders `.authorized-site-item[data-origin]` + `.btn-revoke`;
 * `handleRevokeSite` guards with `confirm()` then `wallet.revokeSite`,
 * toast '授权已撤销') and `openSitesPage` in `js/controller/popup-controller.js`.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';
const DAPP_HOST = 'dapp.e2e.invalid';

async function serveBlankDapp(context: BrowserContext) {
  await context.route(`${DAPP_ORIGIN}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Wallet 协议测试 DApp</title></head><body><main><h1>YeYing Wallet 协议测试 DApp</h1><p>此页面用于验证 Wallet Provider 协议和审批流程。</p><p>当前测试通过 window.ethereum 发起请求，页面本身不包含业务逻辑。</p></main></body></html>',
    }),
  );
}

async function openDapp(context: BrowserContext): Promise<Page> {
  const dapp = await context.newPage();
  await dapp.goto(DAPP_ORIGIN, { waitUntil: 'domcontentloaded' });
  await dapp.waitForFunction(() => (globalThis as any).ethereum?.isYeYing === true, undefined, {
    timeout: 20_000,
  });
  return dapp;
}

async function connect(context: BrowserContext, extensionId: string, dapp: Page): Promise<string[]> {
  const p = dapp.evaluate(() =>
    (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
  );
  const approval = await waitForApproval(context, extensionId, { requestType: 'connect' });
  await approval.locator('#approveConnect').click({ timeout: 10_000 });
  return (await p) as string[];
}

async function openSitesPage(popup: Page) {
  await popup.locator('#walletHeaderMenuBtn').click();
  await popup.locator('#walletHeaderMenu').waitFor({ state: 'visible' });
  await popup.locator('#sitesManageBtn').click();
  await popup.locator('#sitesPage').waitFor({ state: 'visible' });
}

test(localizedTitle("【dApp 连接与 Provider / DAPP】 WL-DAPP-015 已连接站点管理:查看与撤销授权", "WL-DAPP-015: a connected site is listed and can be revoked"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await serveBlankDapp(ctx.context);

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const dapp = await openDapp(ctx.context);
    const accounts = await connect(ctx.context, ctx.extensionId, dapp);
    expect(accounts.length).toBeGreaterThan(0);
    await recorder.step(dapp, 'dApp 已连接授权');

    // -- Open site manager; the dApp origin should be listed ------------
    await popup.bringToFront();
    await openSitesPage(popup);
    const siteItem = popup.locator('#authorizedSitesList .authorized-site-item', {
      hasText: DAPP_HOST,
    });
    await expect(siteItem).toHaveCount(1, { timeout: 10_000 });
    await recorder.step(popup, '已连接站点出现在网站管理列表');

    // -- Revoke it (handleRevokeSite calls window.confirm) --------------
    popup.on('dialog', (d) => d.accept());
    await siteItem.locator('.btn-revoke').click();
    await expect(byId(popup, 'globalToast')).toContainText('授权已撤销', { timeout: 10_000 });
    await expect(
      popup.locator('#authorizedSitesList .authorized-site-item', { hasText: DAPP_HOST }),
    ).toHaveCount(0, { timeout: 10_000 });
    await recorder.step(popup, '撤销授权后站点从列表移除');

    // -- The dApp no longer sees any accounts --------------------------
    await expect
      .poll(() => dapp.evaluate(() => (globalThis as any).ethereum.request({ method: 'eth_accounts' })), {
        timeout: 10_000,
      })
      .toEqual([]);
    await recorder.step(dapp, 'dApp eth_accounts 归零');
  } finally {
    await teardownWalletContext(ctx);
  }
});
