/** Uses ORCHESTRATOR_BASE_URL and ORCHESTRATOR_API_URL. */
import { Wallet } from 'ethers';

import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { injectWallet } from '../helpers/wallet';

function skipIfNoService() {
  // The product suite remains listable and safely skippable before local bring-up.
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(!baseURLFor('orchestrator'), 'ORCHESTRATOR_BASE_URL not configured');
}

test(
  localizedTitle(
    '【登录与控制台 / E2E】真实钱包完成登录并进入受保护控制台',
    'real wallet login reaches the protected orchestrator console',
  ),
  async ({ page, recorder }) => {
    skipIfNoService();
    const privateKey = Wallet.createRandom().privateKey;
    const walletAddress = await injectWallet(page, privateKey);

    await page.goto('/');
    await expect(page.getByRole('button', { name: '使用钱包登录' })).toBeVisible();
    await recorder.step(page, '登录页显示钱包登录入口');

    const challengeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/v1/public/auth/wallet/challenge'),
    );
    const verifyResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/v1/public/auth/wallet/verify'),
    );
    await page.getByRole('button', { name: '使用钱包登录' }).click();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole('heading', { name: '运行概览' })).toBeVisible();
    const challenge = await challengeResponse;
    expect(challenge.status()).toBe(200);
    const challengeBody = (await challenge.json()) as {
      wallet_id: string;
      challenge: string;
      challenge_token: string;
    };
    expect(challengeBody.wallet_id.toLowerCase()).toBe(walletAddress.toLowerCase());
    expect(challengeBody.challenge).toContain('Sign in to Orchestrator.');
    expect(challengeBody.challenge_token).toBeTruthy();

    const verification = await verifyResponse;
    expect(verification.status()).toBe(200);
    await recorder.step(page, '钱包签名完成并进入运行概览');

    const session = await page.evaluate(async () => {
      const response = await fetch('/api/v1/public/auth/me', { credentials: 'include' });
      const body = (await response.json()) as { wallet_id: string; auth_type: string };
      return { status: response.status, body };
    });
    expect(session.status).toBe(200);
    expect(session.body.wallet_id.toLowerCase()).toBe(walletAddress.toLowerCase());
    expect(session.body.auth_type).toBe('wallet_plugin');
    const authCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'hub_session',
    );
    expect(authCookie?.httpOnly).toBe(true);
    expect(authCookie?.value).toBeTruthy();

    await page.getByRole('link', { name: '运行时实例' }).click();
    await expect(page).toHaveURL(/\/runtime$/);
    await expect(page.getByRole('heading', { name: '运行时实例' })).toBeVisible();
    await recorder.step(page, '登录会话可访问运行时实例页面');
  },
);

test(
  localizedTitle(
    '【登录与控制台 / E2E】未登录访问运行时页面回到登录页',
    'unauthenticated runtime access redirects to the login page',
  ),
  async ({ page, recorder }) => {
    skipIfNoService();
    const unauthorizedSession = page.waitForResponse((response) =>
      response.url().includes('/api/v1/public/auth/me'),
    );
    await page.goto('/runtime');
    expect((await unauthorizedSession).status()).toBe(401);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '使用钱包登录' })).toBeVisible();
    await recorder.step(page, '未登录访问受保护路由被重定向到登录页');
  },
);

test(
  localizedTitle(
    '【登录与控制台 / UI】未安装钱包时显示可理解的登录错误',
    'login shows a useful error when no wallet provider is installed',
  ),
  async ({ page }) => {
    skipIfNoService();
    await page.goto('/');
    await page.getByRole('button', { name: '使用钱包登录' }).click();
    await expect(page.getByRole('alert')).toContainText('未检测到钱包扩展');
  },
);

test(
  localizedTitle(
    '【健康检查 / API】控制面健康检查可达',
    'orchestrator health endpoint is reachable',
  ),
  async () => {
    const apiURL = envFor('orchestrator').ORCHESTRATOR_API_URL;
    // The API probe is optional when running only the frontend suite.
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(!apiURL, 'ORCHESTRATOR_API_URL not configured');
    const response = await fetch(`${apiURL}/api/v1/public/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'orchestrator' });
  },
);
