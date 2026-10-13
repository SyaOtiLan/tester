/**
 * Wallet — 云端密钥托管:恢复读取与解密完整性(CUST-030 / CUST-050..053)。
 *
 * These exercise the *recovery-token* custody path
 * (`CUSTODY_LIST_SECRETS` / `CUSTODY_RESTORE_SECRET` with `recoveryToken`),
 * which uses an unauthenticated `CustodyClient` and therefore needs no UCAN,
 * no passkey and no live identity service — only a stubbed custody endpoint
 * (`helpers/custody.ts`) and locally-crafted, product-encrypted ciphertext.
 *
 * The decrypt/validate pipeline runs entirely in the service worker
 * (`handleRestoreCustodySecret` → `decryptObject` → `validateCustodySecret`),
 * so these are deterministic and offline. Restore failures must return
 * `{ success: false }` and import nothing.
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw } from '../helpers/popup';
import {
  CUSTODY_ENDPOINT,
  CUSTODY_SECRET_PASSWORD,
  TEST_ADDRESS_1,
  encryptSecret,
  hdSecret,
  stubCustody,
  type CustodyRecord,
} from '../helpers/custody';

interface RestoreResult {
  success: boolean;
  account?: { address?: string };
  error?: string;
}
interface ListResult {
  success: boolean;
  secrets?: { records?: Array<{ walletId: string }>; identityDid?: string };
  error?: string;
}
interface CurrentAccount {
  success: boolean;
  account?: { address?: string };
}

const WALLET_ID = 'wallet-hd-1';

/** Assert no wallet was imported into the fresh context. */
async function expectNoWallet(popup: import('@playwright/test').Page) {
  const current = await sendSw<CurrentAccount>(popup, 'GET_CURRENT_ACCOUNT');
  expect(current?.account?.address, 'no wallet should be imported on failure').toBeFalsy();
}

/** Build a recovery-secrets stub whose sole record has the given ciphertext. */
function recoveryStub(ciphertext: string, address = ''): { recoverySecrets: Record<string, CustodyRecord>; recoveryRecords: CustodyRecord[] } {
  const record: CustodyRecord = { walletId: WALLET_ID, address, ciphertext, metadata: { version: 2, walletName: '工作钱包', accountCount: 1 } };
  return { recoverySecrets: { [WALLET_ID]: record }, recoveryRecords: [record] };
}

test("【云端密钥托管与恢复 / API】 CUST-030 读取托管记录(恢复令牌)", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });

    const ciphertext = await encryptSecret(popup, hdSecret(), CUSTODY_SECRET_PASSWORD);
    await stubCustody(ctx.context, { ...recoveryStub(ciphertext), identityDid: 'did:yeying:wid_testrecovery01' });

    const list = await sendSw<ListResult>(popup, 'CUSTODY_LIST_SECRETS', {
      endpoint: CUSTODY_ENDPOINT,
      recoveryToken: 'recovery-token-abc',
    });
    expect(list?.success, `list failed: ${list?.error}`).toBe(true);
    expect(list.secrets?.records?.length).toBe(1);
    expect(list.secrets?.records?.[0]?.walletId).toBe(WALLET_ID);
    expect(list.secrets?.identityDid).toBe('did:yeying:wid_testrecovery01');
    await recorder.step(popup, 'CUST-030 读取云端托管记录');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【云端密钥托管与恢复 / API】 CUST-050 密码错误恢复被拒", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });

    const ciphertext = await encryptSecret(popup, hdSecret(), CUSTODY_SECRET_PASSWORD);
    await stubCustody(ctx.context, recoveryStub(ciphertext));

    const restore = await sendSw<RestoreResult>(popup, 'CUSTODY_RESTORE_SECRET', {
      walletId: WALLET_ID,
      password: 'Wrong-Password-9999',
      endpoint: CUSTODY_ENDPOINT,
      recoveryToken: 'recovery-token-abc',
    });
    expect(restore?.success).toBe(false);
    // Must be the crypto integrity error, not a stub-miss/network error — this
    // proves the ciphertext was fetched and decryption actually ran and failed.
    expect(restore.error).toMatch(/Invalid password or corrupted data/);
    await expectNoWallet(popup);
    await recorder.step(popup, 'CUST-050 错误密码被拒绝');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【云端密钥托管与恢复 / API】 CUST-051 密文篡改被拒", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });

    const ciphertext = await encryptSecret(popup, hdSecret(), CUSTODY_SECRET_PASSWORD);
    // Flip a character in the middle of the base64 blob (AES-GCM auth must fail).
    const mid = Math.floor(ciphertext.length / 2);
    const flipped = ciphertext[mid] === 'A' ? 'B' : 'A';
    const tampered = ciphertext.slice(0, mid) + flipped + ciphertext.slice(mid + 1);

    await stubCustody(ctx.context, recoveryStub(tampered));

    const restore = await sendSw<RestoreResult>(popup, 'CUSTODY_RESTORE_SECRET', {
      walletId: WALLET_ID,
      password: CUSTODY_SECRET_PASSWORD,
      endpoint: CUSTODY_ENDPOINT,
      recoveryToken: 'recovery-token-abc',
    });
    expect(restore?.success).toBe(false);
    // AES-GCM authentication failure surfaces as the same integrity error.
    expect(restore.error).toMatch(/Invalid password or corrupted data/);
    await expectNoWallet(popup);
    await recorder.step(popup, 'CUST-051 密文篡改被拒绝');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【云端密钥托管与恢复 / API】 CUST-052 未知版本 / 字段缺失被拒", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });

    // Each defective secret encrypts cleanly (correct password) but must fail
    // structural validation in validateCustodySecret — asserting the exact
    // message proves validation ran (not a stub-miss).
    const cases: Array<{ label: string; secret: unknown; error: RegExp }> = [
      { label: 'wrong version', secret: hdSecret({ version: 99 }), error: /托管记录格式不受支持/ },
      { label: 'missing wallet', secret: hdSecret({ wallet: undefined }), error: /托管记录格式不受支持/ },
      { label: 'missing accounts', secret: hdSecret({ accounts: [] }), error: /托管记录格式不受支持/ },
      { label: 'missing identities', secret: hdSecret({ identities: undefined }), error: /托管记录格式不受支持/ },
      { label: 'missing mnemonic', secret: hdSecret({ mnemonic: undefined }), error: /托管记录缺少助记词/ },
    ];

    for (const { label, secret, error } of cases) {
      const ciphertext = await encryptSecret(popup, secret, CUSTODY_SECRET_PASSWORD);
      await ctx.context.unroute(`${CUSTODY_ENDPOINT}/**`).catch(() => {});
      await stubCustody(ctx.context, recoveryStub(ciphertext));
      const restore = await sendSw<RestoreResult>(popup, 'CUSTODY_RESTORE_SECRET', {
        walletId: WALLET_ID,
        password: CUSTODY_SECRET_PASSWORD,
        endpoint: CUSTODY_ENDPOINT,
        recoveryToken: 'recovery-token-abc',
      });
      expect(restore?.success, `${label} should be rejected`).toBe(false);
      expect(restore.error, `${label} should surface the validation error`).toMatch(error);
    }
    await expectNoWallet(popup);
    await recorder.step(popup, 'CUST-052 版本/字段缺失被拒绝');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test("【云端密钥托管与恢复 / API】 CUST-053 地址不匹配被拒", async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });

    // Valid mnemonic, but the stored first-account address is a different one,
    // so HD derivation will not match → 地址校验失败.
    const secret = hdSecret({
      accounts: [
        {
          accountId: 'acc-0',
          index: 0,
          name: '工作钱包',
          address: TEST_ADDRESS_1, // mismatched (derivation index 0 is ADDRESS_0)
          derivationPath: "m/44'/60'/0'/0/0",
        },
      ],
    });
    const ciphertext = await encryptSecret(popup, secret, CUSTODY_SECRET_PASSWORD);
    await stubCustody(ctx.context, recoveryStub(ciphertext));

    const restore = await sendSw<RestoreResult>(popup, 'CUSTODY_RESTORE_SECRET', {
      walletId: WALLET_ID,
      password: CUSTODY_SECRET_PASSWORD,
      endpoint: CUSTODY_ENDPOINT,
      recoveryToken: 'recovery-token-abc',
    });
    expect(restore?.success).toBe(false);
    expect(restore.error).toContain('地址校验失败');
    await expectNoWallet(popup);
    await recorder.step(popup, 'CUST-053 地址不匹配被拒绝');
  } finally {
    await teardownWalletContext(ctx);
  }
});
