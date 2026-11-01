/** Cloud custody round-trip: upload encrypted wallet + Identity, recover on a
 * new extension profile through the recovery authorization UI, then log in to
 * a dApp with a cryptographically verified Presentation from the restored DID.
 */
import { localizedTitle } from '../../../shared/title';

import { test, expect } from '../fixtures';
import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import {
  CUSTODY_ENDPOINT,
  CUSTODY_SECRET_PASSWORD,
  TEST_ADDRESS_0,
  TEST_MNEMONIC,
  stubCustody,
} from '../helpers/custody';
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
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw } from '../helpers/popup';

interface OperationResult {
  success: boolean;
  error?: string;
  account?: { address?: string };
}
interface IdentityResult {
  document?: { id: string; walletIdentityId: string };
}
interface IdentityListResult {
  identities?: Array<IdentityResult & PublicIdentity>;
  selectedIdentityId?: string;
}
interface CurrentAccountResult {
  account?: { address?: string };
}

test(
  localizedTitle(
    '【云端密钥托管与恢复 / E2E】恢复后使用原 Wallet Identity 登录',
    'cloud recovery restores the same Wallet Identity and completes dApp login',
  ),
  async ({ recorder }) => {
    const ctxA = await loadWalletContext();
    let walletId = '';
    let ciphertext = '';
    let identityDid = '';
    try {
      await stubPublicEndpoints(ctxA.context);
      const sourceStub = await stubCustody(ctxA.context, {
        status: { passkeyBound: true, recordCount: 0 },
      });
      const popupA = await openPopup(ctxA.context, ctxA.extensionId);
      await byId(popupA, 'welcomePage').waitFor({ state: 'visible' });

      const imported = await sendSw<OperationResult>(popupA, 'IMPORT_HD_WALLET', {
        accountName: '云端恢复 E2E',
        mnemonic: TEST_MNEMONIC,
        password: CUSTODY_SECRET_PASSWORD,
      });
      expect(imported?.success, `source wallet import failed: ${imported?.error}`).toBe(true);
      expect(imported.account?.address?.toLowerCase()).toBe(TEST_ADDRESS_0.toLowerCase());

      const created = await sendSw<IdentityResult>(popupA, 'IDENTITY_CREATE', {
        password: CUSTODY_SECRET_PASSWORD,
      });
      identityDid = created.document?.id || '';
      expect(identityDid).toMatch(/^did:yeying:wid_[A-Za-z0-9_-]{22,}$/);

      const backedUp = await sendSw<OperationResult>(popupA, 'CUSTODY_ENABLE', {
        password: CUSTODY_SECRET_PASSWORD,
        endpoint: CUSTODY_ENDPOINT,
      });
      expect(backedUp?.success, `cloud backup failed: ${backedUp?.error}`).toBe(true);
      const upload = sourceStub.requests.find(
        (request) => request.method === 'POST' && request.path.endsWith('/custody/secrets'),
      );
      expect(upload?.postData, 'cloud custody must receive one encrypted snapshot').toBeTruthy();
      const remoteRecord = JSON.parse(upload!.postData!) as {
        walletId: string;
        ciphertext: string;
        address: string;
        metadata: { walletName: string; accountCount: number };
      };
      walletId = remoteRecord.walletId;
      ciphertext = remoteRecord.ciphertext;
      expect(walletId).toBeTruthy();
      expect(ciphertext).toBeTruthy();
      expect(remoteRecord.address.toLowerCase()).toBe(TEST_ADDRESS_0.toLowerCase());
      expect(remoteRecord.metadata.accountCount).toBe(1);
      expect(upload!.postData).not.toContain(TEST_MNEMONIC);
      expect(upload!.postData).not.toContain(identityDid);
      await recorder.step(popupA, '上传包含钱包身份的加密云端恢复资料');
    } finally {
      await teardownWalletContext(ctxA);
    }

    const ctxB = await loadWalletContext();
    try {
      await stubPublicEndpoints(ctxB.context);
      const record = {
        walletId,
        address: TEST_ADDRESS_0,
        ciphertext,
        metadata: { version: 2, walletName: '云端恢复 E2E', accountCount: 1 },
      };
      const recoveryStub = await stubCustody(ctxB.context, {
        recoveryRecords: [record],
        recoverySecrets: { [walletId]: record },
        identityDid,
        authorizationDid: identityDid,
        recoveryToken: 'custody-recovery-e2e-token',
      });

      const popupB = await openPopup(ctxB.context, ctxB.extensionId);
      await byId(popupB, 'welcomePage').waitFor({ state: 'visible' });
      const authorizationPagePromise = ctxB.context.waitForEvent('page', { timeout: 15_000 });
      await popupB.locator('#welcomeRecoverWalletBtn').click();
      await popupB.locator('#custodyRecoveryEndpointModal').waitFor({ state: 'visible' });
      await popupB.locator('#custodyRecoveryEndpointInput').fill(CUSTODY_ENDPOINT);
      await popupB.locator('#confirmCustodyRecoveryEndpointBtn').click();
      await expect
        .poll(
          () =>
            recoveryStub.requests.some(
              (item) => item.method === 'POST' && item.path.endsWith('/identity/authorize/request'),
            ),
          { message: 'Wallet should request identity.basic + custody.recovery authorization' },
        )
        .toBe(true);

      const authorizationPage = await authorizationPagePromise;
      await authorizationPage.waitForURL(
        (url) => url.href.startsWith(`${CUSTODY_ENDPOINT}/identity/authorize`),
        { timeout: 15_000 },
      );
      await authorizationPage.locator('#approveRecovery').click();
      await authorizationPage.waitForURL(/recovery-callback\.html\?/, { timeout: 15_000 });

      // The extension callback persists the code/state. Reopening the popup
      // resumes PKCE exchange, lists the remote record, and reaches the actual
      // custody selection/password screen.
      await popupB.reload();
      await popupB.locator('#importPage').waitFor({ state: 'visible', timeout: 20_000 });
      await expect(popupB.locator('.import-source-tab.active')).toHaveAttribute(
        'data-source',
        'custody',
      );
      await expect(popupB.locator('#custodyRecoveryCount')).toHaveText('共 1 个云端托管钱包');
      await expect(popupB.locator('#custodyRecoveryList')).toContainText('云端恢复 E2E');
      await expect(popupB.locator('#custodyRecoveryList')).toContainText(identityDid);
      const request = recoveryStub.requests.find(
        (item) => item.method === 'POST' && item.path.endsWith('/identity/authorize/request'),
      );
      const exchange = recoveryStub.requests.find(
        (item) => item.method === 'POST' && item.path.endsWith('/identity/authorize/exchange'),
      );
      expect(request?.postData).toContain('custody.recovery');
      expect(exchange?.postData).toContain('codeVerifier');
      await recorder.step(popupB, '通行证恢复授权完成并列出云端钱包');

      await popupB.locator('#custodyRecoveryPassword').fill(CUSTODY_SECRET_PASSWORD);
      await byId(popupB, 'importBtn').click();
      await byId(popupB, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
      await expect(byId(popupB, 'globalToast')).toContainText(/钱包已恢复|钱包恢复成功/);

      const restoredAccount = await sendSw<CurrentAccountResult>(popupB, 'GET_CURRENT_ACCOUNT');
      expect(restoredAccount.account?.address?.toLowerCase()).toBe(TEST_ADDRESS_0.toLowerCase());
      const restoredIdentities = await sendSw<IdentityListResult>(popupB, 'IDENTITY_LIST');
      expect(restoredIdentities.selectedIdentityId).toBe(identityDid.replace('did:yeying:', ''));
      const restoredIdentity = restoredIdentities.identities?.find(
        (identity) => identity.document.id === identityDid,
      );
      expect(
        restoredIdentity,
        'cloud restore must retain the original DID and its public controller key',
      ).toBeTruthy();
      expect(restoredIdentity!.document.walletIdentityId).toBe(
        identityDid.replace('did:yeying:', ''),
      );
      await recorder.step(popupB, '恢复原钱包账户和 Wallet Identity');

      await serveIdentityLoginDapp(ctxB.context);
      const dapp = await openIdentityLoginDapp(ctxB.context);
      const audience = `${IDENTITY_LOGIN_ORIGIN}login`;
      const nonce = `cloud-recovery-${crypto.randomUUID()}`;
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
      const login = await requestIdentityPresentation(
        ctxB.context,
        ctxB.extensionId,
        dapp,
        { audience, nonce },
        { approve: false },
      );
      expect(login.result.success, `identity login failed: ${login.result.error}`).toBe(true);
      const presentation = login.result.presentation as IdentityPresentation;
      expect(presentation.holder).toBe(identityDid);
      expect(presentation.audience).toBe(audience);
      expect(presentation.nonce).toBe(nonce);
      expect(presentation.scopes).toEqual(['identity.basic']);
      expect(presentation.credentials).toEqual([]);
      const signatures = await verifyIdentityPresentation(
        popupB,
        restoredIdentity as PublicIdentity,
        presentation,
      );
      expect(signatures.documentValid).toBe(true);
      expect(signatures.presentationValid).toBe(true);
      expect(JSON.stringify(presentation)).not.toContain('privateJwk');
      expect(JSON.stringify(presentation)).not.toContain(TEST_MNEMONIC);
      await recorder.step(dapp, '云端恢复后以原 DID 完成身份登录并验证 Ed25519 签名');
    } finally {
      await teardownWalletContext(ctxB);
    }
  },
);
