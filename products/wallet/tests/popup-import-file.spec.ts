/**
 * Wallet — popup: import from an encrypted backup file (WL-UI-008).
 *
 * The 备份文件 (file) import tab restores accounts from a
 * `yeying-wallet-accounts` backup produced by the wallet's own export. We
 * exercise the full round-trip:
 *
 *   1. Create wallet A and a Wallet Identity; capture the account address and
 *      walletIdentityId.
 *   2. Export an encrypted backup via the SW `EXPORT_ACCOUNTS_FILE` bus and
 *      persist the returned `file` object to a temp JSON file.
 *   3. In a *fresh* extension context B, welcome → 导入钱包 → 备份文件 tab,
 *      pick the file, enter the same password, import.
 *   4. Land on `#walletPage`; the restored account address and
 *      walletIdentityId equal A's.
 *
 * Verified against `js/controller/wallet/import-wallet-controller.js`
 * (file branch → `JSON.parse(file.text())` → `importAccountsFile`) and
 * `js/background/operations/wallet.js` (`handleExportAccountsFile` returns
 * `{ file: { format, version, cipher, ciphertext } }`).
 */
import { localizedTitle } from '../../../shared/title';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, openPopup, sendSw, TEST_PASSWORD } from '../helpers/popup';
import {
  IDENTITY_LOGIN_ORIGIN,
  authorizeIdentityLogin,
  openIdentityLoginDapp,
  requestIdentityPresentation,
  serveIdentityLoginDapp,
  verifyIdentityPresentation,
  type IdentityPresentation,
  type PublicIdentity,
} from '../helpers/identity-login';

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

interface IdentityRecord {
  document?: { walletIdentityId?: string };
  publicJwk?: Record<string, unknown>;
}

interface IdentityListResult {
  identities?: Array<IdentityRecord & { document: { id: string; walletIdentityId: string } }>;
  selectedIdentityId?: string;
}

test(
  localizedTitle(
    '【钱包导入 / UI】 WL-UI-008 备份文件 / Keystore 导入',
    'WL-UI-008: export an encrypted backup and restore it in a fresh wallet',
  ),
  async ({ recorder }) => {
    const fileDir = mkdtempSync(join(tmpdir(), 'yeying-wallet-backup-'));
    const backupPath = join(fileDir, 'accounts-backup.json');

    // -- Phase A: create + export ----------------------------------------
    const ctxA = await loadWalletContext();
    let addressA = '';
    let identityIdA = '';
    try {
      await stubPublicEndpoints(ctxA.context);
      const popupA = await createAndUnlockWallet(ctxA.context, ctxA.extensionId);
      await recorder.step(popupA, '钱包 A 创建完成');

      const current = await sendSw<CurrentAccount>(popupA, 'GET_CURRENT_ACCOUNT');
      expect(
        current?.success && current.account?.address,
        'wallet A should expose an account',
      ).toBeTruthy();
      addressA = current.account!.address!.toLowerCase();
      expect(addressA).toMatch(/^0x[\da-f]{40}$/);

      const createdIdentity = await sendSw<IdentityRecord>(popupA, 'IDENTITY_CREATE', {
        password: TEST_PASSWORD,
      });
      identityIdA = createdIdentity.document?.walletIdentityId ?? '';
      expect(identityIdA).toMatch(/^wid_[A-Za-z0-9_-]{22,}$/);
      await recorder.step(popupA, '创建 Wallet Identity');

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
      await expect(popupB.locator('.import-source-tab.active')).toHaveAttribute(
        'data-source',
        'file',
      );
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

      const restoredIdentities = await sendSw<IdentityListResult>(popupB, 'IDENTITY_LIST');
      expect(restoredIdentities.selectedIdentityId).toBe(identityIdA);
      const restoredIdentity = restoredIdentities.identities?.find(
        (item) => item.document.walletIdentityId === identityIdA,
      );
      expect(restoredIdentity, 'the original Wallet Identity should be restored').toBeTruthy();
      expect(restoredIdentity!.document.id).toBe(`did:yeying:${identityIdA}`);
      expect(restoredIdentity!.publicJwk).toBeTruthy();

      // A DID string alone is not a successful recovery. Complete a real dApp
      // identity login so the restored controller key must sign both the DID
      // document and the audience/nonce-bound Presentation.
      await serveIdentityLoginDapp(ctxB.context);
      const dapp = await openIdentityLoginDapp(ctxB.context);
      const audience = `${IDENTITY_LOGIN_ORIGIN}login`;
      const nonce = `file-recovery-${crypto.randomUUID()}`;
      const authorization = await authorizeIdentityLogin(ctxB.context, ctxB.extensionId, dapp, {
        beforeApprove: async (approval) =>
          await expect(approval.locator('#connectPermissionItems')).toContainText('读取钱包身份'),
      });
      expect(
        authorization.result.success,
        `identity scope authorization failed: ${authorization.result.error}`,
      ).toBe(true);
      expect(
        authorization.result.permissions?.some(
          (item) => item.parentCapability === 'wallet_identity',
        ),
      ).toBe(true);
      // A restored identity must still be usable after the wallet is locked.
      // The next dApp login should unlock the recovered account and continue.
      await sendSw(popupB, 'LOCK_WALLET');
      const login = await requestIdentityPresentation(
        ctxB.context,
        ctxB.extensionId,
        dapp,
        { audience, nonce },
        { approve: false, unlockPassword: TEST_PASSWORD },
      );
      expect(login.result.success, `identity login failed: ${login.result.error}`).toBe(true);
      const presentation = login.result.presentation as IdentityPresentation;
      expect(presentation.holder).toBe(restoredIdentity!.document.id);
      expect(presentation.audience).toBe(audience);
      expect(presentation.nonce).toBe(nonce);
      expect(presentation.scopes).toEqual(['identity.basic']);
      expect(Date.parse(presentation.expiresAt)).toBeGreaterThan(Date.now());
      expect(JSON.stringify(presentation)).not.toContain('privateJwk');
      const signatures = await verifyIdentityPresentation(
        popupB,
        restoredIdentity as PublicIdentity,
        presentation,
      );
      expect(
        signatures.documentValid,
        'restored DID controller must sign the identity document',
      ).toBe(true);
      expect(
        signatures.presentationValid,
        'restored DID controller must sign the login challenge',
      ).toBe(true);
      await recorder.step(dapp, '使用恢复的 Wallet Identity 完成 dApp 登录并验证签名');
    } finally {
      await teardownWalletContext(ctxB);
      rmSync(fileDir, { recursive: true, force: true });
    }
  },
);
