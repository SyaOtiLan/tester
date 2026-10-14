/**
 * Wallet — popup smoke: create-wallet flow lands on the wallet home page.
 *
 * Mirrors the first test in `wallet/tests/e2e/extension-smoke.test.mjs`,
 * which is the source of truth for the popup's UI vocabulary. If this
 * spec starts failing, the wallet repo's e2e is likely failing too —
 * that's where to look for context.
 *
 * Selectors, viewport, and password match the smoke test verbatim.
 *
 * Annotated with `recorder.step(...)` calls — opt-in to user-manual
 * generation. Each call captures a full-page screenshot of the popup
 * state at that point; `pnpm manual:build` renders them into Markdown.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext, type WalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { POPUP_HEIGHT, POPUP_WIDTH, byId, openPopup } from '../helpers/popup';

const TEST_PASSWORD = 'E2E-password-2026';
const TEST_WALLET_NAME = 'E2E Wallet';

test(localizedTitle("【钱包创建与初始化 / UI】 欢迎→创建钱包→设置密码登陆#walletPage", "welcome → create wallet → set password lands on #walletPage"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);

    await expect(popup).toHaveTitle('夜莺钱包');

    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });
    await expect(byId(popup, 'welcomeCreateWalletBtn')).toHaveText('新建钱包');
    await recorder.step(popup, '欢迎页（首次打开）', {
      note: '新装钱包插件后第一次打开看到的页面。两个入口：新建钱包、导入钱包。',
    });

    await byId(popup, 'welcomeCreateWalletBtn').click();
    await byId(popup, 'setPasswordPage').waitFor({ state: 'visible' });
    await recorder.step(popup, '设置密码页', {
      note: '钱包名自动填好 `hd-NNNN` 形式，可改名。',
    });

    // The wallet auto-fills `hd-NNNN`; we overwrite it before continuing.
    await expect(byId(popup, 'setWalletName')).toHaveValue(/^hd-\d{4}$/);

    await byId(popup, 'setWalletName').fill(TEST_WALLET_NAME);
    await byId(popup, 'setPasswordBtn').click();
    await byId(popup, 'passwordPromptInput').fill(TEST_PASSWORD);
    await byId(popup, 'passwordPromptConfirm').click();

    await byId(popup, 'walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await recorder.step(popup, '钱包主页（创建完成）', {
      note: '顶部为账户地址（已截断），下方为功能入口。',
    });

    // Address is rendered truncated (`0x1234…abcd`) — accept either
    // ellipsis form (the wallet uses `…` since v1.4.x).
    const address = (await byId(popup, 'accountAddress').textContent())?.trim() ?? '';
    expect(address).toMatch(/^0x[\da-fA-F]+(?:…|\.\.\.)[\da-fA-F]+$/);

    // Popup state persists across close + reopen — close, fresh page,
    // navigate to the popup URL, should still be on the wallet page.
    await popup.close();
    const reopened = await openPopup(ctx.context, ctx.extensionId);
    await byId(reopened, 'walletPage').waitFor({ state: 'visible', timeout: 15_000 });
    await recorder.step(reopened, '关闭后重新打开，仍在主页', {
      note: '说明 wallet state 已经持久化到 chrome.storage。',
    });
  } finally {
    await teardownWalletContext(ctx);
  }
});

// Explicit viewport assertions, mostly so the intent is visible in code
// rather than buried in the helper. If POPUP_WIDTH/HEIGHT ever drift
// these will catch it.
test(localizedTitle("【钱包创建与初始化 / UI】 弹出视口默认匹配钱包 UI 期望", "popup viewport defaults match wallet UI expectations"), () => {
  expect(POPUP_WIDTH).toBe(380);
  expect(POPUP_HEIGHT).toBe(600);
});

// Type-level sanity: ensure WalletContext shape is stable. If `extension.ts`
// changes its return shape this will surface at type-check time.
test(localizedTitle("【钱包创建与初始化 / UI】 loadWalletContext 返回预期的形状", "loadWalletContext returns the expected shape"), async () => {
  const ctx: WalletContext = await loadWalletContext({ headless: true });
  try {
    expect(typeof ctx.extensionId).toBe('string');
    expect(ctx.extensionId).toMatch(/^[a-z]{32}$/);
    expect(ctx.userDataDir).toContain('yeying-wallet-e2e-');
    expect(ctx.context).toBeTruthy();
  } finally {
    await teardownWalletContext(ctx);
  }
});