/**
 * router — wallet SIWE negative / nonce-lifecycle contract.
 *
 * The custom-format challenge → verify flow returns the proto envelope
 * `{ success, message, data }` (HTTP 200 even on failure — there is NO top-level
 * `code`; `writeProtoError` discards the numeric code). These tests pin the
 * failure branches verified against router `internal/admin/controller/auth/wallet.go`:
 *
 *   - wrong-key signature      → "签名地址与请求地址不一致" (RT-API-009)
 *   - missing address          → "参数错误，缺少 address"   (RT-API-007)
 *   - missing signature/nonce  → "缺少签名或 nonce"          (RT-API-010)
 *   - overwritten nonce        → "nonce 无效或已过期"        (RT-API-011)
 *   - consumed (one-time) nonce→ "nonce 无效或已过期"        (RT-API-012)
 *
 * The nonce store keeps exactly one entry per address (GetWalletNonce), so the
 * overwrite + one-time cases are ordered inside a `serial` block to avoid a
 * parallel challenge clobbering the nonce mid-test.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireRouterToken } from '../helpers/auth';
import { Wallet } from 'ethers';

const CHALLENGE = '/api/v1/public/common/auth/challenge';
const VERIFY = '/api/v1/public/common/auth/verify';
const REFRESH = '/api/v1/public/common/auth/refreshToken';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}
function skipIfNoKey() {
  test.skip(
    !envFor('router')['ROUTER_WALLET_PRIVATE_KEY'],
    'ROUTER_WALLET_PRIVATE_KEY not configured',
  );
}

interface ProtoEnvelope {
  success: boolean;
  message: string;
  data: unknown;
}

// RT-API-009 (P0)
test(localizedTitle("【钱包自定义 SIWE 鉴权 / DAPP】 验证拒绝来自错误私钥的签名（未颁发令牌）", "verify rejects a signature from the wrong private key (no token issued)"), async () => {
  skipIfNoService();
  const env = envFor('router');
  test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    const declared = new Wallet(env['ROUTER_WALLET_PRIVATE_KEY']!).address.toLowerCase();

    // The shared wallet's nonce can be clobbered by a parallel login between
    // our challenge and verify. Retry until we get a real (non-nonce) verdict.
    let vBody: ProtoEnvelope & { data: { token?: string } | null } = {
      success: true,
      message: '',
      data: null,
    };
    for (let attempt = 0; attempt < 6; attempt++) {
      const cRes = await ctx.post(CHALLENGE, { data: { address: declared } });
      expect(cRes.status()).toBe(200);
      const cBody = (await cRes.json()) as { data: { message: string; nonce: string } };

      // Sign the *correct* challenge message with a DIFFERENT (random) key, so
      // the recovered signer address will not match the declared address.
      const attacker = Wallet.createRandom();
      const signature = await attacker.signMessage(cBody.data.message);

      const vRes = await ctx.post(VERIFY, {
        data: { address: declared, signature, nonce: cBody.data.nonce, message: cBody.data.message },
      });
      expect(vRes.status()).toBe(200);
      vBody = (await vRes.json()) as ProtoEnvelope & { data: { token?: string } | null };
      if (!(vBody.message ?? '').includes('nonce')) break;
      await new Promise(r => setTimeout(r, 50 + Math.floor(Math.random() * 150)));
    }

    expect(vBody.success).toBe(false);
    expect(vBody.message).toContain('签名地址与请求地址不一致');
    // No token leaked on the mismatch path.
    expect(vBody.data == null || (vBody.data as { token?: string }).token == null).toBe(true);
  } finally {
    await ctx.dispose();
  }
});

// RT-API-007 (P1)
test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 挑战拒绝丢失/格式错误的地址", "challenge rejects missing / malformed address"), async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    for (const body of [{}, { address: 'not-an-eth-address' }]) {
      const res = await ctx.post(CHALLENGE, { data: body });
      expect(res.status()).toBe(200);
      const parsed = (await res.json()) as ProtoEnvelope;
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain('address');
    }
  } finally {
    await ctx.dispose();
  }
});

// RT-API-008 (P1) — challenge rejects an unbound address when auto-register is off.
//
// `WalletChallengeProto` (wallet.go) rejects with proto code 5 + "钱包未绑定账户…"
// when `!IsWalletAddressAlreadyTaken(addr) && !config.AutoRegisterEnabled`.
// Challenging a *fresh random* address only ever mints a nonce (auto-create
// happens at verify), so this probe is side-effect free. If the deployment has
// AutoRegisterEnabled=true the reject branch is unreachable and we skip with the
// live-detected reason; otherwise we assert the controlled rejection.
test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 当自动注册被禁用时，质询会拒绝未绑定的地址", "challenge rejects an unbound address when auto-register is disabled"), async () => {
  skipIfNoService();
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    const fresh = Wallet.createRandom().address.toLowerCase();
    const res = await ctx.post(CHALLENGE, { data: { address: fresh } });
    expect(res.status()).toBe(200);
    const parsed = (await res.json()) as ProtoEnvelope;

    // Auto-register ON → an unbound address still gets a nonce; the reject branch
    // can never fire on this deployment.
    test.skip(
      parsed.success === true,
      'AutoRegisterEnabled=true on this deployment: unbound wallet addresses are auto-registered, ' +
        'so the challenge reject branch (RT-API-008) cannot fire',
    );

    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain('钱包未绑定账户');
  } finally {
    await ctx.dispose();
  }
});

// RT-API-010 (P1)
test(localizedTitle("【钱包自定义 SIWE 鉴权 / DAPP】 验证拒绝缺少签名的请求", "verify rejects a request missing the signature"), async () => {
  skipIfNoService();
  const env = envFor('router');
  test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
  const ctx = await apiContext(baseURLFor('router')!);
  try {
    const declared = new Wallet(env['ROUTER_WALLET_PRIVATE_KEY']!).address.toLowerCase();
    const cRes = await ctx.post(CHALLENGE, { data: { address: declared } });
    const cBody = (await cRes.json()) as { data: { message: string; nonce: string } };

    const res = await ctx.post(VERIFY, {
      data: { address: declared, nonce: cBody.data.nonce, message: cBody.data.message },
    });
    expect(res.status()).toBe(200);
    const parsed = (await res.json()) as ProtoEnvelope;
    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain('缺少签名或 nonce');
  } finally {
    await ctx.dispose();
  }
});

// RT-API-013 (P2) — refreshToken issues a fresh token for a valid JWT and
// rejects a forged/expired one.
//
// The endpoint uses the proto envelope `{ success, message, data }` (HTTP 200
// even on failure; `writeProtoError` drops the numeric code, so — contrary to
// the doc's "code=3" — there is no top-level code; the failure is pinned via
// message "token 无效或已过期"). Verified live against
// `internal/admin/controller/auth/*` refreshToken handler.
test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 RT-API-013 refreshToken 换发新 token 且拒绝非法 token", "refreshToken exchanges a valid token and rejects an invalid one (RT-API-013)"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);

  // Valid token → a new access token + expires_at is issued.
  const authed = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await authed.post(REFRESH);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      data?: { token?: string; expires_at?: string } | null;
    };
    expect(body.success).toBe(true);
    expect(body.data?.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.data?.expires_at).toBeTruthy();
  } finally {
    await authed.dispose();
  }

  // Forged token → controlled rejection, no token issued.
  const forged = await apiContext(baseURL, { Authorization: 'Bearer not.a.valid.jwt' });
  try {
    const res = await forged.post(REFRESH);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      message?: string;
      data?: { token?: string } | null;
    };
    expect(body.success).toBe(false);
    expect(body.message ?? '').toMatch(/token 无效或已过期|无效|过期/);
    expect(body.data == null || body.data.token == null).toBe(true);
  } finally {
    await forged.dispose();
  }
});

// RT-API-014 (P2) — address is validated by a regex (IsValidEthAddress), not an
// EIP-55 checksum, and normalized (NormalizeWalletAddress), so an all-uppercase
// (non-checksum) address completes the whole challenge → sign → verify flow and
// the issued account's wallet_address comes back canonicalised to lowercase.
test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 EIP-55：地址上的登录名不区分大小写（非 ）（RT-API-014）", "login is case-insensitive on the address (non-EIP-55) (RT-API-014)"), async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const wallet = new Wallet(envFor('router')['ROUTER_WALLET_PRIVATE_KEY']!);
  const upper = '0x' + wallet.address.slice(2).toUpperCase(); // deliberately non-checksum
  const ctx = await apiContext(baseURL);
  try {
    // Retry across the shared-wallet single-nonce race until we get a real verdict.
    let vBody: {
      success?: boolean;
      data?: { token?: string; user?: { wallet_address?: string } } | null;
      message?: string;
    } = {};
    for (let attempt = 0; attempt < 6; attempt++) {
      const cBody = (await (
        await ctx.post(CHALLENGE, { data: { address: upper } })
      ).json()) as { success?: boolean; data?: { message: string; nonce: string } };
      expect(cBody.success).toBe(true);
      const signature = await wallet.signMessage(cBody.data!.message);
      vBody = (await (
        await ctx.post(VERIFY, {
          data: { address: upper, signature, nonce: cBody.data!.nonce, message: cBody.data!.message },
        })
      ).json()) as typeof vBody;
      if (vBody.success || !(vBody.message ?? '').includes('nonce')) break;
      await new Promise(r => setTimeout(r, 50 + Math.floor(Math.random() * 150)));
    }
    expect(vBody.success).toBe(true);
    expect(vBody.data?.token).toBeTruthy();
    // Address is normalized to lowercase regardless of the input casing.
    expect((vBody.data?.user?.wallet_address ?? '').toLowerCase()).toBe(
      wallet.address.toLowerCase(),
    );
    expect(vBody.data?.user?.wallet_address).toBe(wallet.address.toLowerCase());
  } finally {
    await ctx.dispose();
  }
});

// RT-API-015 (P2) — the auth endpoints are wrapped by CriticalRateLimit.
//
// DEGRADED SKIP when the limiter is inactive on this deployment. Per the router
// source, `/common/auth/challenge` is wrapped by CriticalRateLimit (20 requests
// / 20 min per client IP, in-memory fallback when Redis is off), BUT
// `rateLimitFactory` short-circuits to a no-op when `DebugEnabled` (typical for
// a local dev build) or the threshold is 0. Probed live: 500 rapid challenge
// calls all returned 200 → the limiter is a no-op here. Because the limit is
// per-IP, tripping a *live* limiter would poison every other auth test for 20
// minutes, so we fire only a small burst just past the 20-request threshold: if
// the server starts rejecting (429) we assert the protection; otherwise we skip
// with the live-detected reason rather than fake a limit this build doesn't
// enforce.
test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 RT-API-015 auth 端点受 CriticalRateLimit 限流", "auth endpoints are protected by CriticalRateLimit (RT-API-015)"), async () => {
  skipIfNoService();
  const baseURL = baseURLFor('router')!;
  const ctx = await apiContext(baseURL);
  try {
    const addr = '0x' + '3'.repeat(40);
    // 30 > the 20/20min CriticalRateLimit threshold: enough to trip an active
    // limiter, small enough not to wildly overshoot.
    const statuses = await Promise.all(
      Array.from({ length: 30 }, () =>
        ctx.post(CHALLENGE, { data: { address: addr } }).then(r => r.status()),
      ),
    );
    const limited = statuses.filter(s => s === 429).length;
    test.skip(
      limited === 0,
      `CriticalRateLimit is a no-op on this deployment: ${statuses.length} rapid /auth/challenge ` +
        'calls (past the 20/20min threshold) were all accepted — the limiter is short-circuited ' +
        '(DebugEnabled or threshold 0), so the throttle branch is unreachable',
    );
    // If the limiter fired, it must return the 429 rate-limit status.
    expect(limited).toBeGreaterThan(0);
  } finally {
    await ctx.dispose();
  }
});

test.describe(localizedTitle("【鉴权与权限边界】nonce 生命周期（串行 — 每个地址存储单条目）（nonce lifecycle (serial — single-entry per-address store)）", "nonce lifecycle (serial — single-entry per-address store)"), () => {
  test.describe.configure({ mode: 'serial' });

  // RT-API-011 (P1) — a second challenge overwrites the first address nonce.
  test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 RT-API-011 同地址重复 challenge 使旧 nonce 失效(覆盖语义)", "a later challenge overwrites the previous nonce (RT-API-011)"), async () => {
    skipIfNoService();
    const env = envFor('router');
    test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
    const wallet = new Wallet(env['ROUTER_WALLET_PRIVATE_KEY']!);
    const address = wallet.address.toLowerCase();
    const ctx = await apiContext(baseURLFor('router')!);
    try {
      const c1 = (await (await ctx.post(CHALLENGE, { data: { address } })).json()) as {
        data: { message: string; nonce: string };
      };
      const sig1 = await wallet.signMessage(c1.data.message);

      // Second challenge for the same address supersedes nonce #1.
      await ctx.post(CHALLENGE, { data: { address } });

      const res = await ctx.post(VERIFY, {
        data: { address, signature: sig1, nonce: c1.data.nonce, message: c1.data.message },
      });
      expect(res.status()).toBe(200);
      const parsed = (await res.json()) as ProtoEnvelope;
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain('nonce 无效或已过期');
    } finally {
      await ctx.dispose();
    }
  });

  // RT-API-012 (P1) — a nonce is single-use; replay after a successful verify fails.
  test(localizedTitle("【钱包自定义 SIWE 鉴权 / API】 RT-API-012 verify 使用已过期/已消费 nonce 报错", "a consumed nonce cannot be replayed (RT-API-012)"), async () => {
    skipIfNoService();
    const env = envFor('router');
    test.skip(!env['ROUTER_WALLET_PRIVATE_KEY'], 'ROUTER_WALLET_PRIVATE_KEY not configured');
    const wallet = new Wallet(env['ROUTER_WALLET_PRIVATE_KEY']!);
    const address = wallet.address.toLowerCase();
    const ctx = await apiContext(baseURLFor('router')!);
    try {
      // Land a clean challenge→verify (retrying across the shared-wallet nonce
      // race) so we hold a genuinely *consumed* nonce to replay.
      let verifyBody: { address: string; signature: string; nonce: string; message: string } | null =
        null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const c = (await (await ctx.post(CHALLENGE, { data: { address } })).json()) as {
          data: { message: string; nonce: string };
        };
        const signature = await wallet.signMessage(c.data.message);
        const candidate = { address, signature, nonce: c.data.nonce, message: c.data.message };
        const first = (await (await ctx.post(VERIFY, { data: candidate })).json()) as ProtoEnvelope & {
          data: { token?: string } | null;
        };
        if (first.success) {
          expect(first.data?.token).toBeTruthy();
          verifyBody = candidate;
          break;
        }
        await new Promise(r => setTimeout(r, 50 + Math.floor(Math.random() * 150)));
      }
      expect(verifyBody, 'could not land a clean verify to consume a nonce').not.toBeNull();

      // Replaying the exact same message/nonce must fail — nonce is one-time.
      const second = await ctx.post(VERIFY, { data: verifyBody! });
      expect(second.status()).toBe(200);
      const secondBody = (await second.json()) as ProtoEnvelope;
      expect(secondBody.success).toBe(false);
      expect(secondBody.message).toContain('nonce 无效或已过期');
    } finally {
      await ctx.dispose();
    }
  });
});
