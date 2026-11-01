/* eslint-disable playwright/no-skipped-test -- Service availability depends on the local test environment. */
/** Authenticated console navigation from a user's perspective. */
import type { Page } from '@playwright/test';
import { Wallet } from 'ethers';

import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { injectWallet } from '../helpers/wallet';

async function login(page: Page) {
  test.skip(!baseURLFor('orchestrator'), 'ORCHESTRATOR_BASE_URL not configured');
  await injectWallet(page, Wallet.createRandom().privateKey);
  await page.goto('/');
  await page.getByRole('button', { name: '使用钱包登录' }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

test(
  localizedTitle(
    '【导航与应用外壳 / E2E】登录后渲染控制台导航项',
    'authenticated console renders its navigation items',
  ),
  async ({ page }) => {
    await login(page);
    const navigation = page.locator('nav.primary-nav');
    await expect(navigation.getByRole('link', { name: '运行概览' })).toBeVisible();
    await expect(navigation.getByRole('link', { name: '运行时实例' })).toBeVisible();
    await expect(navigation.getByRole('link', { name: '应用工作台' })).toBeVisible();
    await expect(navigation.getByRole('link', { name: '交易员' })).toBeVisible();
    await expect(navigation.getByRole('link', { name: '信使' })).toBeVisible();
  },
);

test(
  localizedTitle(
    '【导航与应用外壳 / E2E】侧栏导航通过 SPA 切换并更新当前项',
    'sidebar navigation changes routes and active item without a reload',
  ),
  async ({ page }) => {
    await login(page);
    const navigation = page.locator('nav.primary-nav');
    const dashboardLink = navigation.getByRole('link', { name: '运行概览' });
    const runtimeLink = navigation.getByRole('link', { name: '运行时实例' });
    await expect(dashboardLink).toHaveAttribute('aria-current', 'page');

    await runtimeLink.click();
    await expect(page).toHaveURL(/\/runtime$/);
    await expect(runtimeLink).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: '运行时实例' })).toBeVisible();
  },
);

test(
  localizedTitle(
    '【登录页与钱包连接 UI / UI】登录页显示产品身份与钱包入口',
    'login page shows product identity and wallet sign-in',
  ),
  async ({ page }) => {
    test.skip(!baseURLFor('orchestrator'), 'ORCHESTRATOR_BASE_URL not configured');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '登录运行控制台' })).toBeVisible();
    await expect(page.getByRole('button', { name: '使用钱包登录' })).toBeVisible();
  },
);
