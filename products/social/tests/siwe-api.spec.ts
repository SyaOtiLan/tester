/**
 * social — Web3 SIWE auth API (web3-identity, 8901).
 *
 * The SIWE endpoints live on the standalone web3-identity service and are only
 * reachable there directly — the platform gateway on 8888 returns
 * {code:500,"系统繁忙"} for `/auth/siwe/*`. autoRegister=true, so a fresh
 * wallet is provisioned on first successful verify.
 *
 * Env:
 *  - SOCIAL_IDENTITY_URL  web3-identity SIWE service (8901). Tests skip when unset.
 *
 * Contract (live):
 *  - POST /auth/siwe/nonce {address, chainId} -> {code:200,{nonce,expiresIn:300,chainId}}
 *  - POST /auth/siwe/verify {address, signature, message, terminal} -> LoginVO
 *      · active `dev` profile requires SIWE domain `localhost:8080`
 *      · wrong signature -> {code:500,"SIWE签名校验失败"}
 *      · a consumed nonce cannot be reused -> {code:500,"SIWE nonce无效或已过期"}
 *  - Errors surface as HTTP 200 with a non-200 envelope code (GlobalExceptionHandler).
 */
import { test, expect, envFor } from '../fixtures';
import { request } from '@playwright/test';
import { Wallet } from 'ethers';
import {
  issueNonce,
  buildSiweMessage,
  siweLogin,
  SIWE_DOMAIN,
  type Envelope,
  type LoginVO,
} from '../helpers/auth';

const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

function skipIfNoIdentity() {
  test.skip(!identityURL(), 'SOCIAL_IDENTITY_URL not configured');
}

// SO-API-015 — SIWE nonce challenge.
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-015 SIWE 挑战获取 nonce", async () => {
  skipIfNoIdentity();
  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    const wallet = Wallet.createRandom();
    const env = await issueNonce(ctx, wallet.address, '1');
    expect(env.code).toBe(200);
    expect(typeof env.data.nonce).toBe('string');
    expect(env.data.nonce.length).toBeGreaterThan(0);
    expect(env.data.expiresIn).toBe(300);
    expect(env.data.chainId).toBe('1');
  } finally {
    await ctx.dispose();
  }
});

// SO-API-016 — verify a valid signature, receive a LoginVO (auto-register).
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-016 SIWE 验证签名登录换取 token", async () => {
  skipIfNoIdentity();
  const wallet = Wallet.createRandom();
  const { envelope } = await siweLogin(identityURL()!, wallet.privateKey);
  expect(envelope.code).toBe(200);
  expect(typeof envelope.data.accessToken).toBe('string');
  expect(envelope.data.accessToken.length).toBeGreaterThan(20);
  expect(typeof envelope.data.refreshToken).toBe('string');
  expect(envelope.data.accessTokenExpiresIn).toBeGreaterThan(0);
});

// SO-API-017 — a signature from a different key is rejected, no token issued.
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-017 SIWE 验证拒绝错误签名", async () => {
  skipIfNoIdentity();
  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    const wallet = Wallet.createRandom();
    const impostor = Wallet.createRandom();
    const nonceEnv = await issueNonce(ctx, wallet.address, '1');
    const message = buildSiweMessage({
      domain: SIWE_DOMAIN,
      address: wallet.address,
      nonce: nonceEnv.data.nonce,
      chainId: nonceEnv.data.chainId,
    });
    // Sign the correct message with the WRONG key — recovered address mismatches.
    const badSignature = await impostor.signMessage(message);
    const res = await ctx.post('/auth/siwe/verify', {
      data: { address: wallet.address, signature: badSignature, message, terminal: 0 },
    });
    const body = (await res.json()) as Envelope<LoginVO | null>;
    expect(body.code).not.toBe(200);
    expect(body.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});

// SO-API-018 (P1) — a nonce is single-use; replaying a consumed one fails.
test("【Web3 身份认证(SIWE / web3-identity) / API】 SO-API-018 SIWE nonce 一次性 / 过期", async () => {
  skipIfNoIdentity();
  const wallet = Wallet.createRandom();
  const ctx = await request.newContext({ baseURL: identityURL()! });
  try {
    const nonceEnv = await issueNonce(ctx, wallet.address, '1');
    const message = buildSiweMessage({
      address: wallet.address,
      nonce: nonceEnv.data.nonce,
      chainId: nonceEnv.data.chainId,
    });
    const signature = await wallet.signMessage(message);
    const first = await ctx.post('/auth/siwe/verify', {
      data: { address: wallet.address, signature, message, terminal: 0 },
    });
    expect(((await first.json()) as Envelope<LoginVO>).code).toBe(200);
    // Replay the exact same (now-consumed) nonce/message/signature.
    const second = await ctx.post('/auth/siwe/verify', {
      data: { address: wallet.address, signature, message, terminal: 0 },
    });
    const body = (await second.json()) as Envelope<LoginVO | null>;
    expect(body.code).not.toBe(200);
    expect(body.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});
