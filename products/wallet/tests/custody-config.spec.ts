/**
 * Wallet — 云端密钥托管:配置与状态口径(CUST-001 / CUST-002)。
 *
 * CUST-001 checks the service-worker default settings (`CUSTODY_GET_SETTINGS`):
 * endpoint `https://node.yeying.pub`, fixed capability `custody`/`write`, and a
 * disabled toggle before anything is configured.
 *
 * CUST-002 drives the real settings UI (设置 → 云端密钥托管 → 高级设置 config
 * modal): an illegal URL is rejected (`readCustodyForm` → `new URL()`), leaving
 * the stored endpoint unchanged; a valid URL is saved with trailing slashes
 * stripped (SW `normalizeEndpoint`).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect } from '../fixtures';

import { loadWalletContext, teardownWalletContext } from '../helpers/extension';
import { stubPublicEndpoints } from '../helpers/network';
import { byId, createAndUnlockWallet, openPopup, sendSw } from '../helpers/popup';

interface Settings {
  enabled: boolean;
  endpoint: string;
  ucanResource: string;
  ucanAction: string;
  ucanAudience: string;
  lastBackupAt: string;
  lastStatus: unknown;
}
interface SettingsResult {
  success: boolean;
  settings?: Settings;
}

test(localizedTitle("【云端密钥托管与恢复 / API】 CUST-001 默认配置", "CUST-001: custody defaults — node.yeying.pub, custody/write, disabled"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await openPopup(ctx.context, ctx.extensionId);
    await byId(popup, 'welcomePage').waitFor({ state: 'visible' });

    const res = await sendSw<SettingsResult>(popup, 'CUSTODY_GET_SETTINGS');
    expect(res?.success).toBe(true);
    const s = res.settings!;
    expect(s.enabled).toBe(false);
    expect(s.endpoint).toBe('https://node.yeying.pub');
    expect(s.ucanResource).toBe('custody');
    expect(s.ucanAction).toBe('write');
    expect(s.lastBackupAt).toBe('');
    expect(s.lastStatus).toBeNull();
    await recorder.step(popup, 'CUST-001 默认托管配置');
  } finally {
    await teardownWalletContext(ctx);
  }
});

test(localizedTitle("【云端密钥托管与恢复 / UI】 CUST-002 地址校验(配置弹窗)", "CUST-002: config modal rejects an illegal URL and normalizes a valid one"), async ({ recorder }) => {
  const ctx = await loadWalletContext();
  try {
    await stubPublicEndpoints(ctx.context);
    const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);

    // 设置 → 云端密钥托管 详情 → 高级设置 配置弹窗。
    await byId(popup, 'walletHeaderMenuBtn').click();
    await byId(popup, 'settingsBtn').click();
    await byId(popup, 'settingsPage').waitFor({ state: 'visible' });
    await expect(popup.locator('#custodySettingsSection')).toBeVisible();
    await popup.locator('#custodyDetailBtn').click();
    await popup.locator('#custodyDetailPage').waitFor({ state: 'visible' });
    await popup.locator('#custodyConfigBtn').click();
    await popup.locator('#custodyConfigModal').waitFor({ state: 'visible' });

    const endpointInput = popup.locator('#custodyEndpointInput');
    const saveBtn = popup.locator('#custodySaveBtn');

    // --- illegal URL: rejected, endpoint unchanged, modal stays open ---
    await endpointInput.fill('not a valid url');
    await saveBtn.click();
    await expect(popup.locator('#custodyConfigModal')).toBeVisible();
    let s = (await sendSw<SettingsResult>(popup, 'CUSTODY_GET_SETTINGS')).settings!;
    expect(s.endpoint, 'illegal URL must not overwrite the stored endpoint').toBe('https://node.yeying.pub');
    await recorder.step(popup, 'CUST-002 非法地址被拒绝');

    // --- valid URL with trailing slashes: saved + normalized, modal closes ---
    await endpointInput.fill('https://custody.example.com///');
    await saveBtn.click();
    await expect(popup.locator('#custodyConfigModal')).toBeHidden();
    s = (await sendSw<SettingsResult>(popup, 'CUSTODY_GET_SETTINGS')).settings!;
    expect(s.endpoint).toBe('https://custody.example.com');
    // Capability stays fixed regardless of endpoint edits.
    expect(s.ucanResource).toBe('custody');
    expect(s.ucanAction).toBe('write');
    await recorder.step(popup, 'CUST-002 合法地址去除末尾斜杠');
  } finally {
    await teardownWalletContext(ctx);
  }
});
