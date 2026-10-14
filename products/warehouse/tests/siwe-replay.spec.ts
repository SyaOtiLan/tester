/**
 * warehouse — SIWE nonce is single-use / replay-protected (WH-API-004).
 *
 * A successful challenge → sign → verify consumes the stored challenge
 * (web3_authenticator.go calls challengeStore.Delete(address) on success).
 * Replaying the exact same address + signature must therefore fail because the
 * nonce/challenge is gone (auth.ErrChallengeExpired → 4xx).
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL         (backend API origin, e.g. http://localhost:6065)
 *   - WAREHOUSE_WALLET_PRIVATE_KEY (auto-creates the user on first login)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { Wallet, getAddress } from 'ethers';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}

test(localizedTitle("【鉴权与会话 / API】 WH-API-004 SIWE nonce 一次性 / 防重放", "WH-API-004 a consumed SIWE nonce cannot be replayed"), async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
  const key = envFor('warehouse')['WAREHOUSE_WALLET_PRIVATE_KEY'];
  test.skip(!key, 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  const wallet = new Wallet(key!);
  const checksum = getAddress(wallet.address);

  const ctx = await apiContext(apiBase()!);
  try {
    const challengeRes = await ctx.post('/api/v1/public/auth/challenge', {
      data: { address: checksum },
    });
    expect(challengeRes.status()).toBe(200);
    const message = (await challengeRes.json()).data.challenge as string;
    const signature = await wallet.signMessage(message);

    // First verify consumes the challenge → 200 with a JWT.
    const first = await ctx.post('/api/v1/public/auth/verify', {
      data: { address: checksum, signature },
    });
    expect(first.status()).toBe(200);

    // Replaying the same signature must be rejected (challenge already consumed).
    const replay = await ctx.post('/api/v1/public/auth/verify', {
      data: { address: checksum, signature },
    });
    expect(replay.status()).toBeGreaterThanOrEqual(400);
    expect(replay.status()).toBeLessThan(500);
  } finally {
    await ctx.dispose();
  }
});
