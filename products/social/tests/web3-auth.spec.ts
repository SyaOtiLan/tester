/**
 * social — Web3 public auth + wallet binding (web3-identity, 8901).
 *
 * These exercise the standalone web3-identity service's session-scoped
 * endpoints, all live-verified while authoring:
 *
 *  - POST /auth/wallet/link       — bind another wallet to the current session.
 *      Session is carried by the custom header `accessToken: <jwt>` (the SIWE
 *      verify token). The bound wallet must present a SIWE message over a fresh
 *      nonce issued for its own address. Success -> {code:200, data:null}.
 *  - POST /api/v1/public/auth/refresh — rotate a web3 token pair. refreshToken
 *      is read from header `refreshToken` (or cookie `refresh_token`).
 *      Returns Web3VerifyVO {token, address, refreshToken, expiresAt, refreshExpiresAt}.
 *  - GET  /api/v1/public/auth/profile — verify a token (Authorization: Bearer),
 *      UCAN-compatible. Returns Web3ProfileVO {address, issuedAt}. A missing/invalid
 *      token surfaces as HTTP 200 with envelope code 500 (GlobalException).
 *
 * Env:
 *  - SOCIAL_IDENTITY_URL  web3-identity SIWE service (8901). Tests skip when unset.
 */
import { test, expect, envFor } from '../fixtures';
import { request } from '@playwright/test';
import { Wallet } from 'ethers';
import { issueNonce, buildSiweMessage, siweLogin, type Envelope } from '../helpers/auth';

const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

function skipIfNoIdentity() {
  test.skip(!identityURL(), 'SOCIAL_IDENTITY_URL not configured');
}

// SO-API-019 (P1) — bind a wallet to the current (SIWE-authenticated) session.
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-019 绑定钱包到当前会话", async () => {
  skipIfNoIdentity();
  // Establish a session by logging in wallet A via SIWE.
  const A = Wallet.createRandom();
  const { envelope } = await siweLogin(identityURL()!, A.privateKey);
  expect(envelope.code).toBe(200);
  const sessionToken = envelope.data.accessToken;

  // Prepare a second wallet W and a valid SIWE proof over its OWN fresh nonce.
  const W = Wallet.createRandom();
  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    const nonceEnv = await issueNonce(ctx, W.address, '1');
    expect(nonceEnv.code).toBe(200);
    const message = buildSiweMessage({
      address: W.address,
      nonce: nonceEnv.data.nonce,
      chainId: nonceEnv.data.chainId,
    });
    const signature = await W.signMessage(message);

    // The session travels in the custom `accessToken` header.
    const res = await ctx.post('/auth/wallet/link', {
      headers: { accessToken: sessionToken },
      data: { address: W.address, signature, message },
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).toBe(200);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-019b — without a session the link is rejected (guards the session gate).
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-019b 没有会话的钱包链接被拒绝", async () => {
  skipIfNoIdentity();
  const W = Wallet.createRandom();
  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    const nonceEnv = await issueNonce(ctx, W.address, '1');
    const message = buildSiweMessage({
      address: W.address,
      nonce: nonceEnv.data.nonce,
      chainId: nonceEnv.data.chainId,
    });
    const signature = await W.signMessage(message);
    const res = await ctx.post('/auth/wallet/link', {
      data: { address: W.address, signature, message },
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).not.toBe(200); // NO_LOGIN
  } finally {
    await ctx.dispose();
  }
});

// SO-API-020 (P2) — unbind a wallet from the current (SIWE-authenticated) session.
// Live: POST /auth/wallet/unlink {address} with the session in header `accessToken`
// -> {code:200}. Without a session -> {code:400,"未登录"}.
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-020 解绑钱包", async () => {
  skipIfNoIdentity();
  // Establish a session by logging in wallet A via SIWE.
  const A = Wallet.createRandom();
  const { envelope } = await siweLogin(identityURL()!, A.privateKey);
  expect(envelope.code).toBe(200);
  const sessionToken = envelope.data.accessToken;

  // Bind a second wallet W (valid SIWE proof over its own fresh nonce) first,
  // so there is a real binding to remove.
  const W = Wallet.createRandom();
  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    const nonceEnv = await issueNonce(ctx, W.address, '1');
    const message = buildSiweMessage({
      address: W.address,
      nonce: nonceEnv.data.nonce,
      chainId: nonceEnv.data.chainId,
    });
    const signature = await W.signMessage(message);
    const link = await ctx.post('/auth/wallet/link', {
      headers: { accessToken: sessionToken },
      data: { address: W.address, signature, message },
    });
    expect(((await link.json()) as Envelope<null>).code).toBe(200);

    // Unlink succeeds with the session header.
    const unlink = await ctx.post('/auth/wallet/unlink', {
      headers: { accessToken: sessionToken },
      data: { address: W.address },
    });
    expect(((await unlink.json()) as Envelope<null>).code).toBe(200);

    // Without a session the unlink is rejected (guards the session gate).
    const noSession = await ctx.post('/auth/wallet/unlink', { data: { address: W.address } });
    const noSessionBody = (await noSession.json()) as Envelope<null>;
    expect(noSessionBody.code).not.toBe(200); // NO_LOGIN (400)
  } finally {
    await ctx.dispose();
  }
});

// SO-API-022 (P2) — logout the current session; the endpoint reports success.
// Live: POST /api/v1/public/auth/logout (Authorization: Bearer) -> {code:200}.
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-022 注销会话", async () => {
  skipIfNoIdentity();
  const { envelope } = await siweLogin(identityURL()!, Wallet.createRandom().privateKey);
  expect(envelope.code).toBe(200);

  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    const res = await ctx.post('/api/v1/public/auth/logout', {
      headers: { Authorization: `Bearer ${envelope.data.accessToken}` },
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).toBe(200); // 注销成功
  } finally {
    await ctx.dispose();
  }
});

// SO-API-021 (P1) — web3 public token refresh rotates a valid token pair.
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-021 token 刷新(web3 公共认证)", async () => {
  skipIfNoIdentity();
  const { envelope } = await siweLogin(identityURL()!, Wallet.createRandom().privateKey);
  expect(envelope.code).toBe(200);

  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    const res = await ctx.post('/api/v1/public/auth/refresh', {
      headers: { refreshToken: envelope.data.refreshToken },
    });
    const body = (await res.json()) as Envelope<{
      token: string;
      refreshToken: string;
      expiresAt: number;
      refreshExpiresAt: number;
    }>;
    expect(body.code).toBe(200);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.token.length).toBeGreaterThan(20);
    expect(typeof body.data.refreshToken).toBe('string');
    expect(body.data.expiresAt).toBeGreaterThan(Date.now());
    expect(body.data.refreshExpiresAt).toBeGreaterThan(body.data.expiresAt);

    // The rotated access token verifies via the profile endpoint.
    const profile = await ctx.get('/api/v1/public/auth/profile', {
      headers: { Authorization: `Bearer ${body.data.token}` },
    });
    expect(((await profile.json()) as Envelope<{ address: string }>).code).toBe(200);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-023 (P1) — profile verifies a Bearer token and returns the wallet profile.
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-023 profile 校验 token 返回资料(兼容 UCAN)", async () => {
  skipIfNoIdentity();
  const wallet = Wallet.createRandom();
  const { address, envelope } = await siweLogin(identityURL()!, wallet.privateKey);
  expect(envelope.code).toBe(200);

  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    // Valid token -> Web3ProfileVO carrying the (lower-cased) wallet address.
    const ok = await ctx.get('/api/v1/public/auth/profile', {
      headers: { Authorization: `Bearer ${envelope.data.accessToken}` },
    });
    const okBody = (await ok.json()) as Envelope<{ address: string; issuedAt: number }>;
    expect(okBody.code).toBe(200);
    expect(okBody.data.address.toLowerCase()).toBe(address.toLowerCase());
    expect(okBody.data.issuedAt).toBeGreaterThan(0);

    // Missing token -> rejected (GlobalException surfaces as envelope code 500).
    const missing = await ctx.get('/api/v1/public/auth/profile');
    const missingBody = (await missing.json()) as Envelope<unknown>;
    expect(missingBody.code).not.toBe(200);
    expect(missingBody.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});
