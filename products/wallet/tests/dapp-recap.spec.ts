/**
 * Wallet — dApp integration: ReCap (EIP-5573) capability display (WL-DAPP-005).
 *
 * A dApp requests a SIWE sign-in whose `Resources:` block carries an
 * `urn:recap:<base64url(JSON)>` capability object. The wallet's approval app
 * decodes it (js/app/approval.js → parseRecapFromSiwe → renderRecapRequest)
 * and reveals `#recapSection`, listing each granted resource + action under
 * `#recapList` rather than showing an opaque blob. After review the user
 * approves and gets a valid signature.
 *
 * The ReCap object follows EIP-5573: `{ att: { <resource>: { <action>: [ …constraints ] } } }`.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { createAndUnlockWallet, waitForApproval } from '../helpers/popup';

const DAPP_ORIGIN = 'https://dapp.e2e.invalid/';
const SIWE_DOMAIN = 'dapp.e2e.invalid';
const SIWE_URI = 'https://dapp.e2e.invalid';
const RECAP_RESOURCE = 'https://notify.e2e.invalid';
const RECAP_ACTIONS = ['notifications/receive', 'messages/send'];

test("【消息签名与授权 / DAPP】 WL-DAPP-005 ReCap(EIP-5573)能力结构化展示", async ({
  recorder,
}) => {
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
    await dapp.waitForFunction(() => (globalThis as any).ethereum?.isYeYing === true, undefined, {
      timeout: 20_000,
    });

    // Connect first.
    const connectPromise = dapp.evaluate(() =>
      (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
    );
    const connectApproval = await waitForApproval(ctx.context, ctx.extensionId, {
      requestType: 'connect',
    });
    await connectApproval.locator('#approveConnect').click({ timeout: 10_000 });
    const accounts = (await connectPromise) as string[];
    const account = accounts[0];
    expect(account).toMatch(/^0x[\da-fA-F]{40}$/);

    // Encode a ReCap capability object as an `urn:recap:` resource URI.
    const recap = {
      att: {
        [RECAP_RESOURCE]: {
          [RECAP_ACTIONS[0]]: [],
          [RECAP_ACTIONS[1]]: [{ maxCount: 10 }],
        },
      },
    };
    const recapUri = `urn:recap:${Buffer.from(JSON.stringify(recap)).toString('base64url')}`;

    const issuedAt = new Date().toISOString();
    const siweMessage = [
      `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
      account,
      '',
      'I authorize the requested capabilities.',
      '',
      `URI: ${SIWE_URI}`,
      'Version: 1',
      'Chain ID: 1',
      'Nonce: recap0nce123456',
      `Issued At: ${issuedAt}`,
      'Resources:',
      `- ${recapUri}`,
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

    const signApproval = await waitForApproval(ctx.context, ctx.extensionId, {
      requestType: 'sign_message',
    });

    // The ReCap section is revealed with the domain + a structured capability list.
    await expect(signApproval.locator('#recapSection')).toBeVisible({ timeout: 10_000 });
    await expect(signApproval.locator('#recapDomain')).toHaveText(SIWE_DOMAIN);
    const recapList = signApproval.locator('#recapList');
    await expect(recapList).toContainText(RECAP_RESOURCE, { timeout: 10_000 });
    // Each granted action is rendered as its own row.
    for (const action of RECAP_ACTIONS) {
      await expect(recapList.locator('.recap-action-name', { hasText: action })).toBeVisible();
    }
    await recorder.step(signApproval, 'ReCap 能力结构化展示(资源 + 动作列表)');

    await signApproval.locator('#approveSign').click({ timeout: 10_000 });

    const result = (await signPromise) as { ok: boolean; sig?: string; message?: string };
    expect(result.ok, result.message).toBe(true);
    expect(result.sig!).toMatch(/^0x[0-9a-fA-F]{130}$/);
  } finally {
    await teardownWalletContext(ctx);
  }
});
