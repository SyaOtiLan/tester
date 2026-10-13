/**
 * Wallet — popup: 数据备份 (BackupSync) pushes a v2 multichain payload (task177).
 *
 * task177 upgraded sync-service to schema v2: a payload carries each account's
 * namespace/chainKey so non-EVM (Tron/Solana/Bitcoin) accounts are backed up
 * and re-derived on restore via the correct chain.
 *
 * This e2e drives the real push path end-to-end: configure BackupSync to a
 * stubbed WebDAV, add a Tron sub-account to an HD wallet, and sync. The pushed
 * ciphertext is then decrypted with the mnemonic-derived syncKey (the same way
 * the SW does) and asserted to be `version: 2` and to carry the Tron account
 * (namespace='tron', the T-address). The restore/re-derive direction is covered
 * by sync-service unit tests (`_applyRemotePayload v2`).
 *
 * Verified against `js/background/sync-service.js` (buildSyncPayload v2 + the
 * WebDAV push path) and `js/common/crypto` (hashHex / decryptObject).
 */
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw } from '../helpers/popup';
import { configureSync, createDavStore, decryptSyncPayload, pollUntil, stubWebDav } from '../helpers/sync';

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const PASSWORD = 'E2E-password-2026';
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{25,}$/;

interface ImportResult { success: boolean; account?: { address?: string }; error?: string }
interface SyncResult { success: boolean; error?: string }
interface WalletListResult { success: boolean; wallets?: Array<{ id: string; type: string }> }

interface SyncPayload {
  version: number;
  accounts: Array<{ index: number; address: string; namespace?: string; chainKey?: string }>;
}

test("【安全与备份恢复 / UI】 SYNC-V2：备份同步推送携带非 EVM (Tron) 帐户的 v2 有效负载", async ({ recorder }) => {
  const store = createDavStore();

  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await stubWebDav(ctx.context, store);
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });

    // Import the known HD mnemonic, add a Tron sub-account under it.
    const imported = await sendSw<ImportResult>(popup, 'IMPORT_HD_WALLET', {
      accountName: 'Multichain', mnemonic: TEST_MNEMONIC, password: PASSWORD,
    });
    expect(imported?.success, `hd import failed: ${imported?.error}`).toBe(true);

    const list = await sendSw<WalletListResult>(popup, 'GET_ALL_WALLETS');
    const walletId = (list.wallets ?? []).find((w) => w.type === 'hd')?.id;
    expect(walletId, 'HD wallet should exist').toBeTruthy();

    const sub = await sendSw<ImportResult>(popup, 'CREATE_TRON_SUB_ACCOUNT', { walletId, password: PASSWORD });
    expect(sub?.success, `tron sub-account failed: ${sub?.error}`).toBe(true);
    const tronAddress = sub.account!.address!;
    expect(tronAddress).toMatch(TRON_ADDRESS_RE);
    await recorder.step(popup, '导入 HD + 新增 Tron 子账户');

    // Configure sync + re-unlock so the onUnlocked hook prepares contexts, then
    // drive BACKUP_SYNC_NOW until the (encrypted) payload is PUT to WebDAV.
    await configureSync(popup);
    await sendSw(popup, 'LOCK_WALLET');
    await sendSw(popup, 'UNLOCK_WALLET', { password: PASSWORD });
    const pushed = await pollUntil(async () => {
      await sendSw<SyncResult>(popup, 'BACKUP_SYNC_NOW');
      return store.size >= 1;
    });
    expect(pushed, 'sync should PUT a payload to WebDAV').toBe(true);
    await recorder.step(popup, '推送 v2 备份到 WebDAV');

    // The PUT body is a JSON envelope { version, cipher, kdf, ciphertext };
    // decrypt the inner ciphertext with the mnemonic-derived syncKey.
    const firstEntry = [...store.values()][0];
    if (!firstEntry) throw new Error('WebDAV should have stored at least one payload');
    const envelope = JSON.parse(firstEntry.body) as { version: number; ciphertext: string };
    expect(envelope.version).toBe(2);
    const payload = (await decryptSyncPayload(popup, envelope.ciphertext, TEST_MNEMONIC)) as SyncPayload;

    // Schema is v2 and the payload carries the Tron account by namespace/chainKey.
    expect(payload.version).toBe(2);
    const tron = payload.accounts.find((a) => a.namespace === 'tron');
    expect(tron, 'pushed payload should carry the Tron account').toBeTruthy();
    expect(tron!.address).toBe(tronAddress);
    expect(tron!.chainKey).toBe('tron:mainnet');
    // The EVM main is still present (mixed-chain payload).
    expect(payload.accounts.some((a) => /^0x[\da-fA-F]{40}$/.test(String(a.address)))).toBe(true);
    await recorder.step(popup, '解密断言 payload v2 且含 Tron 账户');
  } finally {
    await teardownWalletContext(ctx);
  }
});
