/**
 * Wallet — popup: ERC-20 token add + transfer (WL-UI-031, WL-UI-032).
 *
 * Both cases run against a stubbed custom network (see `helpers/rpc.ts`),
 * which answers `eth_call` (balanceOf) and echoes `keccak256(rawTx)` for the
 * broadcast so a token transfer really goes through the sign path without a
 * live chain.
 *
 *   WL-UI-031  Add an ERC-20 token via `#tokenAddPage`; it appears in
 *              `#tokenList` with its symbol and the stubbed balance.
 *   WL-UI-032  Transfer that token; the broadcast raw tx is an ERC-20
 *              `transfer(address,uint256)` call (`to` = contract,
 *              calldata selector `0xa9059cbb`).
 *
 * Verified against `js/controller/token/add-token-controller.js`,
 * `js/controller/token/token-controller.js`,
 * `js/controller/token/transfer-token-controller.js`, and
 * `js/background/operations/tokens.js`.
 */
import { localizedTitle } from '../../../shared/title';
import { ethers } from 'ethers';

import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { routeRpcNode } from '../helpers/rpc';
import {
  addCustomNetwork,
  byId,
  createAndUnlockWallet,
  openTransferPage,
  pickTransferNetwork,
  TEST_PASSWORD,
  type CustomNetworkSpec,
} from '../helpers/popup';
import type { Page } from '@playwright/test';

const NET: CustomNetworkSpec = {
  chainName: 'Token E2E',
  chainId: '0x539', // 1337
  rpcUrl: 'https://token.e2e.invalid/rpc',
  symbol: 'ETH',
};
const TOKEN_ADDRESS = '0x1111111111111111111111111111111111111111';
const TOKEN_SYMBOL = 'E2ET';
// 5 * 10^18, left-padded to 32 bytes — balanceOf() return value.
const TOKEN_BALANCE_HEX = '0x' + (5n * 10n ** 18n).toString(16).padStart(64, '0');
const RECIPIENT = '0x0000000000000000000000000000000000000002';

/** Switch the active network to our stub via the transfer page, then return
 * to the wallet page. */
async function activateStubNetwork(popup: Page) {
  await openTransferPage(popup);
  const selector = await pickTransferNetwork(popup, NET.rpcUrl);
  await expect(selector.locator('.network-label')).toHaveText(NET.chainName, { timeout: 5_000 });
  await popup.locator('#transferPage .back-btn:visible').first().click();
  await byId(popup, 'walletPage').waitFor({ state: 'visible' });
}

/** Add the ERC-20 token through the token-add page. */
async function addErc20Token(popup: Page) {
  await popup.locator('#tokenAddBtn').click();
  await popup.locator('#tokenAddPage').waitFor({ state: 'visible' });
  await popup.locator('#tokenAddressInput').fill(TOKEN_ADDRESS);
  await popup.locator('#tokenSymbolInput').fill(TOKEN_SYMBOL);
  await popup.locator('#tokenDecimalsInput').fill('18');
  await popup.locator('#saveTokenBtn').click();
  await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 15_000 });
}

test(localizedTitle("【转账与交易 / UI】 WL-UI-031 添加 ERC-20 代币并展示余额", "WL-UI-031: add an ERC-20 token and see its balance in the token list"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    await routeRpcNode(ctx.context, 'https://token.e2e.invalid/**', {
      chainId: NET.chainId,
      tokenBalance: TOKEN_BALANCE_HEX,
    });

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const added = await addCustomNetwork(popup, NET);
    expect(added.success, `add network failed: ${added.error}`).toBe(true);
    await activateStubNetwork(popup);

    await addErc20Token(popup);
    await recorder.step(popup, '添加 ERC-20 通证');

    // The token row shows the symbol and the stubbed balance (5).
    const tokenRow = popup.locator('#tokenList .token-item', { hasText: TOKEN_SYMBOL });
    await expect(tokenRow).toBeVisible({ timeout: 15_000 });
    await expect(tokenRow.locator('.token-symbol')).toContainText(TOKEN_SYMBOL);
    await expect(tokenRow.locator('.token-balance')).toContainText('5');
    await recorder.step(popup, '通证余额已展示');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【转账与交易 / UI】 WL-UI-032 转账 ERC-20 代币", "WL-UI-032: transferring an ERC-20 token broadcasts an ERC-20 transfer() call"), async ({
  recorder,
}) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const capture = await routeRpcNode(ctx.context, 'https://token.e2e.invalid/**', {
      chainId: NET.chainId,
      balanceWei: '0x8ac7230489e80000', // 10 ETH (to cover gas)
      tokenBalance: TOKEN_BALANCE_HEX,
    });

    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
    const added = await addCustomNetwork(popup, NET);
    expect(added.success, `add network failed: ${added.error}`).toBe(true);
    await activateStubNetwork(popup);
    await addErc20Token(popup);

    // Go to transfer, pick the ERC-20 token from the asset selector.
    await openTransferPage(popup);
    const tokenSelector = popup.locator('.token-selector');
    await tokenSelector.locator('.token-trigger').click();
    const option = tokenSelector.locator(`.token-option[data-value="${TOKEN_ADDRESS}"]`);
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    await option.click();
    await expect(popup.locator('#transferTokenSymbol')).toContainText(TOKEN_SYMBOL);
    await recorder.step(popup, '选择 ERC-20 通证进行转账');

    await byId(popup, 'recipientAddress').fill(RECIPIENT);
    await byId(popup, 'amount').fill('1');
    await byId(popup, 'sendBtn').click();

    const prompt = popup.locator('#passwordPromptModal');
    if (await prompt.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
      await popup.locator('#passwordPromptInput').fill(TEST_PASSWORD);
      await popup.locator('#passwordPromptConfirm').click();
    }
    await expect(byId(popup, 'globalWaitingOverlay')).toBeHidden({ timeout: 60_000 });

    // The broadcast raw tx must be an ERC-20 transfer() to the contract.
    await expect.poll(() => capture.rawTxs.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const parsed = ethers.Transaction.from(capture.rawTxs[0]);
    expect(parsed.to?.toLowerCase()).toBe(TOKEN_ADDRESS.toLowerCase());
    expect(parsed.data.toLowerCase().startsWith('0xa9059cbb')).toBe(true);
    // recipient is encoded in the first arg (last 20 bytes of the 32-byte word).
    expect(parsed.data.toLowerCase()).toContain(RECIPIENT.slice(2).toLowerCase());
    await recorder.step(popup, 'ERC-20 transfer() 已广播');
  } finally {
    await teardownWalletContext(ctx);
  }
});
