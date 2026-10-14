/**
 * Wallet — dApp integration: SIWE (EIP-4361) structured display + sign
 * (WL-DAPP-004).
 *
 * A dApp sends a standard Sign-In-With-Ethereum message via personal_sign.
 * The wallet's approval app detects the SIWE shape (js/app/approval.js →
 * parseSiweMessage) and reveals `#siweSection`, breaking the message into
 * domain / address / nonce / uri / chainId fields rather than showing a raw
 * blob. After review the user approves (#approveSign) and gets a valid
 * 65-byte signature.
 *
 * The SIWE message below matches the exact grammar parseSiweMessage expects:
 *   "<domain> wants you to sign in with your Ethereum account:" as the first
 *   line, the address on the next non-empty line, then the labelled fields.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';
const SIWE_DOMAIN = 'dapp.e2e.invalid';
const SIWE_NONCE = 'e2e0nce12345678';
const SIWE_URI = 'https://dapp.e2e.invalid';

test(localizedTitle("【消息签名与授权 / DAPP】 WL-DAPP-004 SIWE(EIP-4361)消息结构化展示并签名", "WL-DAPP-004: SIWE message is parsed into structured fields and signed"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await ctx.context.route(`${DAPP_ORIGIN}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><meta charset="utf-8"><title>Wallet 协议测试 DApp</title></head><body><main><h1>YeYing Wallet 协议测试 DApp</h1><p>此页面用于验证 Wallet Provider 协议和审批流程。</p><p>当前测试通过 window.ethereum 发起请求，页面本身不包含业务逻辑。</p></main></body></html>',
      });
    });
    await createAndUnlockWallet(ctx.context, ctx.extensionId);

    const dapp = await ctx.context.newPage();
    await dapp.goto(DAPP_ORIGIN, { waitUntil: 'domcontentloaded' });
    await dapp.waitForFunction(
      () => (globalThis as any).ethereum?.isYeYing === true,
      undefined,
      { timeout: 20_000 },
    );

    // Connect first.
    const connectPromise = dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
    );
    const connectApproval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'connect' });
    await connectApproval.locator('#approveConnect').click({ timeout: 10_000 });
    const accounts = (await connectPromise) as string[];
    const account = accounts[0];
    expect(account).toMatch(/^0x[\da-fA-F]{40}$/);

    // Build a standard SIWE message for the connected account.
    const issuedAt = new Date().toISOString();
    const siweMessage = [
      `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
      account,
      '',
      'Sign in to the YeYing e2e suite.',
      '',
      `URI: ${SIWE_URI}`,
      'Version: 1',
      'Chain ID: 1',
      `Nonce: ${SIWE_NONCE}`,
      `Issued At: ${issuedAt}`,
    ].join('\n');

    const signPromise = dapp.evaluate(
      async ({ msg, account }) => {
        try {
          const sig = await (globalThis as any).ethereum.request({
            method: 'personal_sign',
            params: [msg, account],
          });
          return { ok: true, sig };
        } catch (err: any) {
          return { ok: false, code: err?.code, message: err?.message };
        }
      },
      { msg: siweMessage, account },
    );

    const signApproval = await waitForApproval(ctx.context, ctx.extensionId, { requestType: 'sign_message' });
    await expect(signApproval.locator('#signRequest')).toBeVisible({ timeout: 10_000 });

    // The SIWE section must be revealed and populated with the parsed fields.
    await expect(signApproval.locator('#siweSection')).toBeVisible({ timeout: 10_000 });
    await expect(signApproval.locator('#siweDomain')).toHaveText(SIWE_DOMAIN);
    await expect(signApproval.locator('#siweNonce')).toHaveText(SIWE_NONCE);
    await expect(signApproval.locator('#siweUri')).toHaveText(SIWE_URI);
    await expect(signApproval.locator('#siweChainId')).toContainText('1');
    await recorder.step(signApproval, 'SIWE 结构化展示(域名/地址/nonce/uri…)');

    await signApproval.locator('#approveSign').click({ timeout: 10_000 });

    const result = (await signPromise) as { ok: boolean; sig?: string; message?: string };
    expect(result.ok, result.message).toBe(true);
    expect(result.sig!).toMatch(/^0x[0-9a-fA-F]{130}$/);
  } finally {
    await teardownWalletContext(ctx);
  }
});
