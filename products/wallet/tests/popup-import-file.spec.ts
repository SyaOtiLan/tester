/**
 * Wallet — popup: import from an encrypted backup file (WL-UI-008).
 *
 * The 备份文件 (file) import tab restores accounts from a
 * `yeying-wallet-accounts` backup produced by the wallet's own export. We
 * exercise the full round-trip:
 *
 *   1. Create wallet A; capture its account address.
 *   2. Export an encrypted backup via the SW `EXPORT_ACCOUNTS_FILE` bus and
 *      persist the returned `file` object to a temp JSON file.
 *   3. In a *fresh* extension context B, welcome → 导入钱包 → 备份文件 tab,
 *      pick the file, enter the same password, import.
 *   4. Land on `#walletPage`; the restored account address equals A's.
 *
 * Verified against `js/controller/wallet/import-wallet-controller.js`
 * (file branch → `JSON.parse(file.text())` → `importAccountsFile`) and
 * `js/background/operations/wallet.js` (`handleExportAccountsFile` returns
 * `{ file: { format, version, cipher, ciphertext } }`).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, openPopup, sendSw, TEST_PASSWORD } from '../helpers/popup';

interface ExportResult {
  success: boolean;
  file?: { format: string; version: number; cipher: string; ciphertext: string };
  accountCount?: number;
  error?: string;
}

interface CurrentAccount {
  success: boolean;
  account?: { address?: string };
}

test("【钱包导入 / UI】 WL-UI-008 备份文件 / Keystore 导入", async ({
  recorder,
}) => {
  const fileDir = mkdtempSync(join(tmpdir(), 'yeying-wallet-backup-'));
  const backupPath = join(fileDir, 'accounts-backup.json');

  // -- Phase A: create + export ----------------------------------------
  const ctxA = await loadWalletContext();
  let addressA = '';
  try {
    await stubPublicEndpoints(ctxA.context);
    const popupA = await createAndUnlockWallet(ctxA.context, ctxA.extensionId);
    await recorder.step(popupA, '钱包 A 创建完成');

    const current = await sendSw<CurrentAccount>(popupA, 'GET_CURRENT_ACCOUNT');
    expect(current?.success && current.account?.address, 'wallet A should expose an account').toBeTruthy();
    addressA = current.account!.address!.toLowerCase();
    expect(addressA).toMatch(/^0x[\da-f]{40}$/);

    const exported = await sendSw<ExportResult>(popupA, 'EXPORT_ACCOUNTS_FILE', {
      password: TEST_PASSWORD,
    });
    expect(exported?.success, `export failed: ${exported?.error}`).toBe(true);
    expect(exported.file?.format).toBe('yeying-wallet-accounts');
    expect(exported.file?.ciphertext).toBeTruthy();
    writeFileSync(backupPath, JSON.stringify(exported.file), 'utf8');
    await recorder.step(popupA, '导出加密备份文件');
  } finally {
    await teardownWalletContext(ctxA);
  }

  // -- Phase B: import into a fresh context -----------------------------
  const ctxB = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctxB.context);
    const popupB = await openPopup(ctxB.context, ctxB.extensionId);

    await byId(popupB, 'welcomePage').waitFor({ state: 'visible' });
    await byId(popupB, 'welcomeImportWalletBtn').click();
    await byId(popupB, 'importPage').waitFor({ state: 'visible' });

    // Switch to the file source tab; its section becomes visible.
    // The import page now has two tab levels: an outer *source* tab
    // (`.import-source-tab[data-source=wallet|file|custody]`) that chooses
    // 助记词/私钥 vs 备份文件 vs 云端恢复, and an inner *method* tab
    // (`.import-tab[data-type=mnemonic|privateKey]`) inside the wallet source.
    // 备份文件 moved from an inner method tab to an outer source tab.
    await popupB.locator('.import-source-tab[data-source=file]').click();
    await expect(popupB.locator('.import-source-tab.active')).toHaveAttribute('data-source', 'file');
    await expect(popupB.locator('#fileImportSection')).toBeVisible();

    await popupB.locator('#importAccountsFile').setInputFiles(backupPath);
    await byId(popupB, 'importWalletPassword').fill(TEST_PASSWORD);
    await recorder.step(popupB, '选择备份文件并输入密码');
    await byId(popupB, 'importBtn').click();

    await byId(popupB, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popupB, '备份还原成功，进入主页');

    // The restored account address must equal wallet A's.
    const restored = await sendSw<CurrentAccount>(popupB, 'GET_CURRENT_ACCOUNT');
    expect(restored?.account?.address?.toLowerCase()).toBe(addressA);
  } finally {
    await teardownWalletContext(ctxB);
    rmSync(fileDir, { recursive: true, force: true });
  }
});
