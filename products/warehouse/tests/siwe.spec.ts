/**
 * warehouse — Classical SIWE (challenge / verify) wallet login.
 *
 * The warehouse backend exposes a simpler SIWE flow at
 *   POST /api/v1/public/auth/challenge  →  { challenge, nonce, ... }
 *   POST /api/v1/public/auth/verify     →  { token, expiresAt, address }
 *
 * The live wallet button uses a more complex UCAN-based identity flow
 * (covered by the UI smoke + identity-presentation integration on the
 * warehouse side). This spec exercises the raw SIWE crypto path: it is
 * stable, fast, and tests the same key infrastructure.
 *
 * Requires:
 *   - WAREHOUSE_BASE_URL
 *   - WAREHOUSE_WALLET_PRIVATE_KEY  (auto-creates the user on first login)
 *
 * Optional:
 *   - WAREHOUSE_EXPECTED_ADDRESS    (asserts the bound wallet matches)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { Wallet, getAddress } from 'ethers';

function skipIfNoService() {
  test.skip(!baseURLFor('warehouse'), 'WAREHOUSE_BASE_URL not configured');
}

interface ChallengeResponse {
  data: { challenge: string; nonce: string; address: string };
}

interface VerifyResponse {
  data: { token: string; address: string; expiresAt: number };
}

test(localizedTitle("【鉴权与会话 / API】 SIWE 质询需要校验和地址", "SIWE challenge requires a checksum address"), async ({ request }) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');
  const wallet = new Wallet(env['WAREHOUSE_WALLET_PRIVATE_KEY']!);
  // All-lowercase should be rejected by the server's EIP-55 check.
  const res = await request.post('/api/v1/public/auth/challenge', {
    data: { address: wallet.address.toLowerCase() },
  });
  expect(res.status()).toBe(400);
});

test(localizedTitle("【鉴权与会话 / API】 SIWE 质询 -> 签名 -> 验证返回绑定到钱包的 JWT", "SIWE challenge -> sign -> verify returns a JWT bound to the wallet"), async ({ request }) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  const wallet = new Wallet(env['WAREHOUSE_WALLET_PRIVATE_KEY']!);
  const checksum = getAddress(wallet.address);

  // 1) Request the challenge
  const challengeRes = await request.post('/api/v1/public/auth/challenge', {
    data: { address: checksum },
  });
  expect(challengeRes.status()).toBe(200);
  const challengeBody = (await challengeRes.json()) as ChallengeResponse;
  expect(challengeBody.data.challenge.toLowerCase()).toContain(checksum.toLowerCase());
  expect(challengeBody.data.nonce).toMatch(/^[A-Za-z0-9_-]{16,}$/);

  // 2) Sign the challenge with personal_sign
  const signature = await wallet.signMessage(challengeBody.data.challenge);

  // 3) Verify → JWT
  const verifyRes = await request.post('/api/v1/public/auth/verify', {
    data: { address: checksum, signature },
  });
  expect(verifyRes.status()).toBe(200);
  const verifyBody = (await verifyRes.json()) as VerifyResponse;
  expect(verifyBody.data.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(verifyBody.data.address.toLowerCase()).toBe(wallet.address.toLowerCase());

  if (env['WAREHOUSE_EXPECTED_ADDRESS']) {
    expect(verifyBody.data.address.toLowerCase()).toBe(
      env['WAREHOUSE_EXPECTED_ADDRESS']!.toLowerCase(),
    );
  }

  // 4) The token must work on quota/info endpoints (regression: signature
  //    bound to the right wallet address).
  const quotaRes = await request.get('/api/v1/public/webdav/quota', {
    headers: { Authorization: `Bearer ${verifyBody.data.token}` },
  });
  expect(quotaRes.status()).toBe(200);
});

test(localizedTitle("【鉴权与会话 / DAPP】 SIWE verify 拒绝来自错误密钥的签名", "SIWE verify rejects a signature from the wrong key"), async ({ request }) => {
  skipIfNoService();
  const env = envFor('warehouse');
  test.skip(!env['WAREHOUSE_WALLET_PRIVATE_KEY'], 'WAREHOUSE_WALLET_PRIVATE_KEY not configured');

  const correct = new Wallet(env['WAREHOUSE_WALLET_PRIVATE_KEY']!);
  const wrong = Wallet.createRandom();
  const checksum = getAddress(correct.address);

  const challengeRes = await request.post('/api/v1/public/auth/challenge', {
    data: { address: checksum },
  });
  const challengeBody = (await challengeRes.json()) as ChallengeResponse;
  const badSig = await wrong.signMessage(challengeBody.data.challenge);

  const verifyRes = await request.post('/api/v1/public/auth/verify', {
    data: { address: checksum, signature: badSig },
  });
  // Backend should reject. We don't assert on the specific code — any
  // 4xx proves the signature was checked, not silently accepted.
  expect(verifyRes.status()).toBeGreaterThanOrEqual(400);
  expect(verifyRes.status()).toBeLessThan(500);
});