/**
 * Wallet — 云端密钥托管:恢复含非 EVM(Tron)账户的快照 (CUST-054, task189).
 *
 * Before task189 the custody snapshot dropped namespace/chainKey and the
 * restore pipeline assumed EVM (deriveSubAccount / ethers / hard-rejected Tron),
 * so a wallet containing any non-EVM account failed to recover as a whole.
 * Now `buildCustodyPayload` carries namespace/chainKey, `validateCustodySecret`
 * is family-aware, and `importOrReuseCustodyWallet` re-derives per namespace.
 *
 * This is a full round-trip over the recovery-token path (offline, stubbed
 * custody endpoint): Phase A derives the real EVM main + Tron sub-account
 * addresses from the known mnemonic and crafts a v2 snapshot; Phase B restores
 * it into a fresh context and asserts the Tron account is re-derived as Tron.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, openPopup, sendSw } from '../helpers/popup';
import {
  CUSTODY_ENDPOINT,
  CUSTODY_SECRET_PASSWORD,
  TEST_MNEMONIC,
  TEST_ADDRESS_0,
  DERIVATION_PATH_0,
  encryptSecret,
  stubCustody,
  type CustodyRecord,
} from '../helpers/custody';

const WALLET_ID = 'wallet-hd-mc-1';
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{25,}$/;

interface WalletListResult {
  success: boolean;
  wallets?: Array<{ id: string; type: string; accounts?: Array<{ address?: string; namespace?: string; index?: number }> }>;
}
interface ImportResult { success: boolean; account?: { address?: string }; error?: string }
interface RestoreResult { success: boolean; error?: string }

function recoveryStub(ciphertext: string): { recoverySecrets: Record<string, CustodyRecord>; recoveryRecords: CustodyRecord[] } {
  const record: CustodyRecord = {
    walletId: WALLET_ID,
    ciphertext,
    metadata: { version: 2, walletName: '多链钱包', accountCount: 2 },
  };
  return { recoverySecrets: { [WALLET_ID]: record }, recoveryRecords: [record] };
}

test(localizedTitle("【云端密钥托管与恢复 / E2E】 CUST-054：恢复包含 Tron 子账户的 HD 钱包", "CUST-054: recovery restores an HD wallet containing a Tron sub-account"), async ({ recorder }) => {
  // -- Phase A: derive the real Tron sub-account address + craft a v2 snapshot --
  let ciphertext = '';
  let tronAddress = '';
  const ctxA = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctxA.context);
    const popupA = await openPopup(ctxA.context, ctxA.extensionId);
    await byId(popupA, 'welcomePage').waitFor({ state: 'visible' });

    // Import the known-vector HD wallet, then add a Tron sub-account (global index 1).
    const importRes = await sendSw<ImportResult>(popupA, 'IMPORT_HD_WALLET', {
      accountName: '多链钱包',
      mnemonic: TEST_MNEMONIC,
      password: CUSTODY_SECRET_PASSWORD,
    });
    expect(importRes?.success, `hd import failed: ${importRes?.error}`).toBe(true);

    const list = await sendSw<WalletListResult>(popupA, 'GET_ALL_WALLETS');
    const walletId = (list.wallets ?? []).find((w) => w.type === 'hd')?.id;
    expect(walletId, 'HD wallet should exist').toBeTruthy();

    const sub = await sendSw<ImportResult>(popupA, 'CREATE_TRON_SUB_ACCOUNT', {
      walletId,
      password: CUSTODY_SECRET_PASSWORD,
    });
    expect(sub?.success, `tron sub-account failed: ${sub?.error}`).toBe(true);
    tronAddress = sub.account!.address!;
    expect(tronAddress).toMatch(TRON_ADDRESS_RE);
    await recorder.step(popupA, '派生 EVM 主账户 + Tron 子账户');

    // Craft a v2 snapshot carrying both the EVM main (index 0) and the Tron
    // sub-account (index 1) with its namespace/chainKey.
    const secret = {
      version: 2,
      wallet: { id: WALLET_ID, name: '多链钱包', type: 'hd', createdAt: '2026-01-01T00:00:00.000Z', accountCount: 2 },
      mnemonic: TEST_MNEMONIC,
      accounts: [
        { accountId: 'acc-0', index: 0, name: '日常账户', address: TEST_ADDRESS_0, namespace: 'eip155', chainKey: 'eip155:1', derivationPath: DERIVATION_PATH_0 },
        { accountId: 'acc-1', index: 1, name: 'Tron 账户', address: tronAddress, namespace: 'tron', chainKey: 'tron:mainnet' },
      ],
      identities: {},
      selectedIdentityId: '',
      exportedAt: '2026-01-01T00:00:00.000Z',
    };
    ciphertext = await encryptSecret(popupA, secret, CUSTODY_SECRET_PASSWORD);
  } finally {
    await teardownWalletContext(ctxA);
  }

  // -- Phase B: restore into a fresh context via the recovery-token path --
  const ctxB = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctxB.context);
    const popupB = await openPopup(ctxB.context, ctxB.extensionId);
    await byId(popupB, 'welcomePage').waitFor({ state: 'visible' });
    await stubCustody(ctxB.context, recoveryStub(ciphertext));

    const restore = await sendSw<RestoreResult>(popupB, 'CUSTODY_RESTORE_SECRET', {
      walletId: WALLET_ID,
      password: CUSTODY_SECRET_PASSWORD,
      endpoint: CUSTODY_ENDPOINT,
      recoveryToken: 'recovery-token-mc',
    });
    expect(restore?.success, `restore failed: ${restore?.error}`).toBe(true);
    await recorder.step(popupB, '恢复含 Tron 子账户的钱包');

    const list = await sendSw<WalletListResult>(popupB, 'GET_ALL_WALLETS');
    const accounts = (list.wallets ?? []).flatMap((w) => w.accounts ?? []);
    // EVM main restored.
    expect(accounts.some((a) => String(a.address).toLowerCase() === TEST_ADDRESS_0.toLowerCase())).toBe(true);
    // Tron sub-account re-derived as Tron (not EVM) with the same address.
    const tron = accounts.find((a) => a.namespace === 'tron');
    expect(tron, 'recovered wallet should contain the Tron sub-account').toBeTruthy();
    expect(tron!.address).toBe(tronAddress);
    expect(tron!.address).toMatch(TRON_ADDRESS_RE);
  } finally {
    await teardownWalletContext(ctxB);
  }
});
