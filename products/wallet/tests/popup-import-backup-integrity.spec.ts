/** File recovery must leave a fresh profile untouched when authentication or
 * AES-GCM integrity checks fail. */
import { localizedTitle } from '../../../shared/title';
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
  error?: string;
}
interface WalletListResult {
  wallets?: unknown[];
}
interface IdentityListResult {
  identities?: unknown[];
}

test(
  localizedTitle(
    '【钱包导入 / UI】错误密码和篡改文件不能创建钱包或身份',
    'wrong passwords and tampered backup files create no wallet or identity',
  ),
  async ({ recorder }) => {
    const fileDir = mkdtempSync(join(tmpdir(), 'yeying-wallet-backup-integrity-'));
    const backupPath = join(fileDir, 'valid-backup.json');
    const tamperedPath = join(fileDir, 'tampered-backup.json');
    const ctxA = await loadWalletContext();
    let file: NonNullable<ExportResult['file']>;
    try {
      await stubPublicEndpoints(ctxA.context);
      const popupA = await createAndUnlockWallet(ctxA.context, ctxA.extensionId);
      const exported = await sendSw<ExportResult>(popupA, 'EXPORT_ACCOUNTS_FILE', {
        password: TEST_PASSWORD,
      });
      expect(exported?.success, `backup export failed: ${exported?.error}`).toBe(true);
      file = exported.file!;
      writeFileSync(backupPath, JSON.stringify(file), 'utf8');
      const ciphertext = file.ciphertext;
      const index = Math.floor(ciphertext.length / 2);
      const replacement = ciphertext[index] === 'A' ? 'B' : 'A';
      writeFileSync(
        tamperedPath,
        JSON.stringify({
          ...file,
          ciphertext: `${ciphertext.slice(0, index)}${replacement}${ciphertext.slice(index + 1)}`,
        }),
        'utf8',
      );
    } finally {
      await teardownWalletContext(ctxA);
    }

    const ctxB = await loadWalletContext();
    try {
      await stubPublicEndpoints(ctxB.context);
      const popupB = await openPopup(ctxB.context, ctxB.extensionId);
      await byId(popupB, 'welcomePage').waitFor({ state: 'visible' });
      await byId(popupB, 'welcomeImportWalletBtn').click();
      await byId(popupB, 'importPage').waitFor({ state: 'visible' });
      await popupB.locator('.import-source-tab[data-source="file"]').click();
      await popupB.locator('#importAccountsFile').setInputFiles(backupPath);
      await byId(popupB, 'importWalletPassword').fill('Wrong-Backup-Password');
      await byId(popupB, 'importBtn').click();
      await expect(byId(popupB, 'globalToast')).toContainText(/失败|无效|密码/i, {
        timeout: 10_000,
      });
      await expect(byId(popupB, 'importPage')).toBeVisible();
      await expect(byId(popupB, 'walletPage')).toBeHidden();
      await recorder.step(popupB, '错误备份密码被拒绝，未进入钱包');

      await popupB.locator('#importAccountsFile').setInputFiles(tamperedPath);
      await byId(popupB, 'importWalletPassword').fill(TEST_PASSWORD);
      await byId(popupB, 'importBtn').click();
      await expect(byId(popupB, 'globalToast')).toContainText(/失败|无效|损坏/i, {
        timeout: 10_000,
      });
      await expect(byId(popupB, 'importPage')).toBeVisible();
      await expect(byId(popupB, 'walletPage')).toBeHidden();

      const wallets = await sendSw<WalletListResult>(popupB, 'GET_ALL_WALLETS');
      const identities = await sendSw<IdentityListResult>(popupB, 'IDENTITY_LIST');
      expect(wallets.wallets ?? [], 'failed recovery must not import any account').toHaveLength(0);
      expect(
        identities.identities ?? [],
        'failed recovery must not partially import an identity',
      ).toHaveLength(0);
      await recorder.step(popupB, 'AES-GCM 密文篡改被拒绝且无部分恢复数据');
    } finally {
      await teardownWalletContext(ctxB);
      rmSync(fileDir, { recursive: true, force: true });
    }
  },
);
