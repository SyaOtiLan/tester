/**
 * Wallet — popup: account-backup FILE round-trips non-EVM accounts.
 *
 * Covers the multichain fixes to the `yeying-wallet-accounts` backup file:
 *   - task186: HD sub-accounts are re-derived by namespace on import (a Tron
 *     sub-account of an HD wallet restores as Tron, not EVM).
 *   - task188: IMPORTED single-key wallets are re-imported by namespace (a Tron
 *     private-key wallet restores as Tron, not EVM).
 *
 * The export now writes schema `version: 2` carrying each account's
 * namespace/chainKey; import dispatches derivation/import per namespace.
 *
 * Mirrors popup-import-file.spec.ts: export via the SW `EXPORT_ACCOUNTS_FILE`
 * bus, persist the `file` object, then import it in a fresh extension context
 * through the 备份文件 source tab. Assertions read `GET_ALL_WALLETS` to find the
 * restored non-EVM account by namespace.
 *
 * Verified against `js/background/operations/wallet.js`
 * (`deriveSubAccountByNamespace`, `importPrivateKeyWalletByNamespace`,
 * export `version: 2`).
 */
import { localizedTitle } from '../../../shared/title';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, openPopup, sendSw, TEST_PASSWORD } from '../helpers/popup';

// Hardhat/Anvil account #2 key — secp256k1, reused by other Tron specs. Never funded.
const TRON_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{25,}$/;

interface ExportResult {
  success: boolean;
  file?: { format: string; version: number; cipher: string; ciphertext: string };
  error?: string;
}
interface WalletListResult {
  success: boolean;
  wallets?: Array<{ id: string; type: string; accounts?: Array<{ address?: string; namespace?: string; chainKey?: string }> }>;
}
interface ImportResult { success: boolean; account?: { address?: string; namespace?: string }; error?: string }

/** Flatten GET_ALL_WALLETS into a single accounts array. */
function allAccounts(list: WalletListResult) {
  return (list.wallets ?? []).flatMap((w) => w.accounts ?? []);
}

async function exportBackupToFile(popup: import('@playwright/test').Page, path: string): Promise<void> {
  const exported = await sendSw<ExportResult>(popup, 'EXPORT_ACCOUNTS_FILE', { password: TEST_PASSWORD });
  expect(exported?.success, `export failed: ${exported?.error}`).toBe(true);
  expect(exported.file?.format).toBe('yeying-wallet-accounts');
  // Multichain backup bumped the schema to v2.
  expect(exported.file?.version).toBe(2);
  writeFileSync(path, JSON.stringify(exported.file), 'utf8');
}

async function importBackupFromFile(context: import('@playwright/test').BrowserContext, extensionId: string, path: string): Promise<import('@playwright/test').Page> {
  const popup = await openPopup(context, extensionId);
  await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
  await byId(popup, 'welcomeImportWalletBtn').click();
  await byId(popup, 'importPage').waitFor({ state: 'visible' });
  await popup.locator('.import-source-tab[data-source=file]').click();
  await expect(popup.locator('#fileImportSection')).toBeVisible();
  await popup.locator('#importAccountsFile').setInputFiles(path);
  await byId(popup, 'importWalletPassword').fill(TEST_PASSWORD);
  await byId(popup, 'importBtn').click();
  await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
  return popup;
}

test(localizedTitle("【钱包导入 / UI】 帐户备份文件将 IMPORTED Tron 私钥钱包恢复为 Tron (task188)", "account backup file restores an IMPORTED Tron private-key wallet as Tron (task188)"), async ({ recorder }) => {
  const fileDir = mkdtempSync(join(tmpdir(), 'yeying-wallet-backup-mc-'));
  const backupPath = join(fileDir, 'accounts-backup.json');
  let tronAddress = '';

  const ctxA = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctxA.context);
    const popupA = await createAndUnlockWallet(ctxA.context, ctxA.extensionId);

    const imported = await sendSw<ImportResult>(popupA, 'IMPORT_TRON_PRIVATE_KEY_WALLET', {
      accountName: 'E2E Tron Key',
      privateKey: TRON_PRIVATE_KEY,
      password: TEST_PASSWORD,
      options: { tronReference: 'mainnet' },
    });
    expect(imported?.success, `tron import failed: ${imported?.error}`).toBe(true);
    tronAddress = imported.account!.address!;
    expect(tronAddress).toMatch(TRON_ADDRESS_RE);
    await recorder.step(popupA, '导入 Tron 私钥钱包');

    await exportBackupToFile(popupA, backupPath);
    await recorder.step(popupA, '导出 v2 多链备份文件');
  } finally {
    await teardownWalletContext(ctxA);
  }

  const ctxB = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctxB.context);
    const popupB = await importBackupFromFile(ctxB.context, ctxB.extensionId, backupPath);
    await recorder.step(popupB, '全新钱包还原备份');

    const list = await sendSw<WalletListResult>(popupB, 'GET_ALL_WALLETS');
    const tron = allAccounts(list).find((a) => a.namespace === 'tron');
    expect(tron, 'restored wallet should contain a Tron account').toBeTruthy();
    // Key assertion: restored as the original Tron address (not re-derived EVM 0x…).
    expect(tron!.address).toBe(tronAddress);
    expect(tron!.address).toMatch(TRON_ADDRESS_RE);
  } finally {
    await teardownWalletContext(ctxB);
    rmSync(fileDir, { recursive: true, force: true });
  }
});

test(localizedTitle("【钱包导入 / UI】 账户备份文件将 HD Tron 子账户恢复为 Tron (task186)", "account backup file restores an HD Tron sub-account as Tron (task186)"), async ({ recorder }) => {
  const fileDir = mkdtempSync(join(tmpdir(), 'yeying-wallet-backup-hd-'));
  const backupPath = join(fileDir, 'accounts-backup.json');
  let tronAddress = '';

  const ctxA = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctxA.context);
    const popupA = await createAndUnlockWallet(ctxA.context, ctxA.extensionId);

    // The base HD (EVM) wallet; add a Tron sub-account under it.
    const before = await sendSw<WalletListResult>(popupA, 'GET_ALL_WALLETS');
    const hdWallet = (before.wallets ?? []).find((w) => w.type === 'hd');
    expect(hdWallet?.id, 'an HD wallet should exist after create').toBeTruthy();

    const sub = await sendSw<ImportResult>(popupA, 'CREATE_TRON_SUB_ACCOUNT', {
      walletId: hdWallet!.id,
      password: TEST_PASSWORD,
    });
    expect(sub?.success, `tron sub-account failed: ${sub?.error}`).toBe(true);
    tronAddress = sub.account!.address!;
    expect(tronAddress).toMatch(TRON_ADDRESS_RE);
    await recorder.step(popupA, 'HD 钱包下新增 Tron 子账户');

    await exportBackupToFile(popupA, backupPath);
    await recorder.step(popupA, '导出 v2 多链备份文件');
  } finally {
    await teardownWalletContext(ctxA);
  }

  const ctxB = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctxB.context);
    const popupB = await importBackupFromFile(ctxB.context, ctxB.extensionId, backupPath);
    await recorder.step(popupB, '全新钱包还原备份');

    const list = await sendSw<WalletListResult>(popupB, 'GET_ALL_WALLETS');
    const accounts = allAccounts(list);
    // EVM main survived.
    expect(accounts.some((a) => /^0x[\da-fA-F]{40}$/.test(String(a.address)))).toBe(true);
    // Tron sub-account restored as Tron with the same address (not EVM).
    const tron = accounts.find((a) => a.namespace === 'tron');
    expect(tron, 'restored HD wallet should contain the Tron sub-account').toBeTruthy();
    expect(tron!.address).toBe(tronAddress);
    expect(tron!.address).toMatch(TRON_ADDRESS_RE);
  } finally {
    await teardownWalletContext(ctxB);
    rmSync(fileDir, { recursive: true, force: true });
  }
});
