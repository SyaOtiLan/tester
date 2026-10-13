/**
 * Wallet — 云端密钥托管:启用/停用在线回路(CUST-011 / CUST-012 / CUST-070 / CUST-071)。
 *
 * CUST-011 — enable is gated by the custody service's `passkeyBound` flag; with
 * it false the SW throws `打开托管服务前，请先绑定通行证` BEFORE any upload.
 *
 * CUST-012 — with the wallet LOCKED (keyring + cached password cleared), an
 * `enable` call carrying the WRONG password cannot re-derive the coordinator
 * signing key: `createWalletInstance` fails to decrypt and throws the
 * canonical `Invalid password` / `密码错误` inside `ensureTargetUcanToken`,
 * before any custody HTTP. We assert that error and that nothing hit the
 * custody host — proof the local UCAN/decrypt gate (not a stub-miss) rejected it.
 *
 * CUST-070 — disable with a healthy DELETE 200 flips `enabled` to false and
 * issues exactly one DELETE `/secrets/{walletId}`.
 *
 * CUST-071 — disable with DELETE 500 fails as `success:false` and leaves
 * `enabled:true` (the rollback semantic: server is the source of truth, so
 * on failure we keep the user enabled until the next successful delete).
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, openPopup, sendSw } from '../helpers/popup';
import { CUSTODY_ENDPOINT, stubCustody } from '../helpers/custody';

interface CustodyOpResult {
  success: boolean;
  error?: string;
  settings?: { enabled: boolean };
  result?: unknown;
  status?: unknown;
}
interface SettingsResult {
  success: boolean;
  settings?: { enabled: boolean; endpoint: string };
}

async function settings(popup: import('@playwright/test').Page) {
  const res = await sendSw<SettingsResult>(popup, 'CUSTODY_GET_SETTINGS');
  return res.settings!;
}

test("【云端密钥托管与恢复 / API】 CUST-011 未绑定通行证开启被拒", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const stub = await stubCustody(ctx.context, { status: { passkeyBound: false, recordCount: 0 } });

    const res = await sendSw<CustodyOpResult>(popup, 'CUSTODY_ENABLE', {
      password: 'E2E-password-2026',
      endpoint: CUSTODY_ENDPOINT,
    });
    expect(res?.success, `enable should fail: ${res?.error}`).toBe(false);
    expect(res.error).toContain('打开托管服务前，请先绑定通行证');
    // No payload upload should have been attempted.
    const upserts = stub.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/secrets'));
    expect(upserts, 'no POST /secrets when passkey unbound').toHaveLength(0);
    expect((await settings(popup)).enabled).toBe(false);
    await recorder.step(popup, 'CUST-011 未绑定通行证开启被拒');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【云端密钥托管与恢复 / API】 CUST-012 锁定 + 错误密码开启被拒", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const stub = await stubCustody(ctx.context, { status: { passkeyBound: true, recordCount: 0 } });

    // Force the lock — the coordinator signing key (selected HD account) is
    // only held while the wallet is unlocked. Locking clears the keyring and
    // the cached password, so a wrong password can no longer re-derive it.
    await sendSw(popup, 'LOCK_WALLET');

    const res = await sendSw<CustodyOpResult>(popup, 'CUSTODY_ENABLE', {
      password: 'Wrong-Password-9999',
      endpoint: CUSTODY_ENDPOINT,
    });
    expect(res?.success, `enable should fail: ${res?.error}`).toBe(false);
    expect(res.error).toMatch(/Invalid password|密码错误/);
    // The decrypt/UCAN gate must fail before any custody HTTP is attempted.
    expect(stub.requests, 'no custody HTTP on a wrong-password enable').toHaveLength(0);
    expect((await settings(popup)).enabled).toBe(false);
    await recorder.step(popup, 'CUST-012 锁定+错误密码开启被拒');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【云端密钥托管与恢复 / API】 CUST-070 正常关闭托管", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const stub = await stubCustody(ctx.context, { status: { passkeyBound: true, recordCount: 1 } });

    // Flip the toggle on directly through the SW (the UI path is CUST-002).
    await sendSw(popup, 'CUSTODY_UPDATE_SETTINGS', { updates: { enabled: true } });
    expect((await settings(popup)).enabled).toBe(true);

    const res = await sendSw<CustodyOpResult>(popup, 'CUSTODY_DISABLE', { endpoint: CUSTODY_ENDPOINT });
    expect(res?.success, `disable should succeed: ${res?.error}`).toBe(true);
    expect((await settings(popup)).enabled).toBe(false);
    const deletes = stub.requests.filter((r) => r.method === 'DELETE' && /\/secrets\/[^/]+$/.test(r.path));
    expect(deletes, 'exactly one DELETE /secrets/{walletId}').toHaveLength(1);
    await recorder.step(popup, 'CUST-070 关闭托管成功');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【云端密钥托管与恢复 / API】 CUST-071 删除失败保留开启", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const stub = await stubCustody(ctx.context, {
      status: { passkeyBound: true, recordCount: 1 },
      deleteStatus: 500,
    });

    await sendSw(popup, 'CUSTODY_UPDATE_SETTINGS', { updates: { enabled: true } });

    const res = await sendSw<CustodyOpResult>(popup, 'CUSTODY_DISABLE', { endpoint: CUSTODY_ENDPOINT });
    expect(res?.success, `disable should fail when DELETE errors: ${res?.error}`).toBe(false);
    expect((await settings(popup)).enabled, 'enabled must remain true when the server delete fails').toBe(true);
    const deletes = stub.requests.filter((r) => r.method === 'DELETE' && /\/secrets\/[^/]+$/.test(r.path));
    expect(deletes, 'the failing DELETE was issued').toHaveLength(1);
    await recorder.step(popup, 'CUST-071 关闭失败保留开启');
  } finally {
    await teardownWalletContext(ctx);
  }
});
