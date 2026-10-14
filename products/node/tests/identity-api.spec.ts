/**
 * node — wallet-identity capability flows (API): TOTP binding and PKCE
 * authorization-code exchange.
 *
 * These exercise the node identity subsystem end-to-end with a self-asserted
 * wallet-identity DID document minted per test (see `helpers/identity.ts`). The
 * server verifies the DID document / verifiable presentation for internal
 * consistency only (self-asserted `did:yeying:wid_...`, Ed25519 controller
 * signature over the canonicalized object) — exactly what a real wallet client
 * produces — so a fresh keypair drives the full closed loop.
 *
 * Covers:
 *   - ND-API-030 TOTP setup → confirm → verify → (bad code rejected) → revoke
 *   - ND-API-032 PKCE authorize request → approve (presentation) → exchange,
 *                single-use authorization code
 *
 * Signed-action / identity contracts mirror node
 * `src/routes/public/identity.ts` + `src/auth/identity*`.
 */
import { localizedTitle } from '../../../shared/title';
import { Wallet, getAddress, type BaseWallet } from 'ethers';

import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { loginWithWallet } from '../helpers/auth';
import { makeSelfAssertedIdentity, totpCode } from '../helpers/identity';
import { buildCreateApplicationBody, deleteBody } from '../helpers/signedAction';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

/** The identity subsystem treats the API origin as the authorization audience. */
function audienceFor(api: string): string {
  return new URL(api).origin;
}

test(localizedTitle("【身份能力(TOTP/Passkey/授权码) / API】 ND-API-029 身份状态查询", "ND-API-029 identity status reports the enabled capability surface"), async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;

  // Precondition is "logged in"; the status endpoints are read-only capability
  // reports, so we attach a real JWT when a wallet is configured but the call
  // succeeds regardless — assert the identity capability shape either way.
  const headers: Record<string, string> = {};
  if (env['NODE_WALLET_PRIVATE_KEY']) {
    const tokens = await loginWithWallet(env['baseURL']!, env['NODE_WALLET_PRIVATE_KEY']!);
    headers.Authorization = `Bearer ${tokens.token}`;
  }
  const ctx = await apiContext(api, headers);
  try {
    // Aggregate status → both TOTP and Passkey capability blocks.
    const statusRes = await ctx.get('/api/v1/public/identity/status');
    expect(statusRes.status()).toBe(200);
    const status = (await statusRes.json()) as {
      code: number;
      data: {
        totp: { enabled: boolean; ready: boolean };
        passkey: { enabled: boolean; ready: boolean };
      };
    };
    expect(status.code).toBe(0);
    expect(typeof status.data.totp.enabled).toBe('boolean');
    expect(typeof status.data.totp.ready).toBe('boolean');
    expect(typeof status.data.passkey.enabled).toBe('boolean');
    expect(typeof status.data.passkey.ready).toBe('boolean');

    // Dedicated TOTP status → algorithm/digits/period descriptor.
    const totpRes = await ctx.get('/api/v1/public/identity/totp/status');
    expect(totpRes.status()).toBe(200);
    const totp = (await totpRes.json()) as {
      data: { enabled: boolean; digits: number; period: number; algorithm: string };
    };
    expect(typeof totp.data.enabled).toBe('boolean');
    expect(totp.data.digits).toBe(6);
    expect(totp.data.period).toBe(30);
    expect(totp.data.algorithm).toBe('SHA1');
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【身份能力(TOTP/Passkey/授权码) / API】 ND-API-030 TOTP 绑定与校验闭环", "ND-API-030 TOTP setup → confirm → verify → revoke closed loop"), async () => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const audience = audienceFor(api);
  const id = makeSelfAssertedIdentity();
  const deviceName = `e2e-totp-${Date.now()}`;

  const ctx = await apiContext(api);
  try {
    // 1) Authorize the setup: challenge → sign the returned signingPayload with
    //    the identity controller key.
    const chRes = await ctx.post('/api/v1/public/identity/actions/challenge', {
      data: { identity: id.did, action: 'identity.totp.setup', audience, payload: { deviceName } },
    });
    expect(chRes.status(), await chRes.text().catch(() => '')).toBe(200);
    const ch = (await chRes.json()) as { data: { challengeId: string; signingPayload: unknown } };
    expect(ch.data.challengeId).toBeTruthy();

    // 2) Setup returns the shared TOTP secret.
    const setupRes = await ctx.post('/api/v1/public/identity/totp/setup', {
      data: {
        identity: id.did,
        identityDocument: id.buildDocument(),
        deviceName,
        audience,
        authorization: { challengeId: ch.data.challengeId, signature: id.sign(ch.data.signingPayload) },
      },
    });
    expect(setupRes.status(), await setupRes.text().catch(() => '')).toBe(200);
    const setup = (await setupRes.json()) as { data: { totp: { secret: string } } };
    const secret = setup.data.totp.secret;
    expect(secret).toBeTruthy();

    // 3) Confirm binds the device with a live code.
    const confirmRes = await ctx.post('/api/v1/public/identity/totp/confirm', {
      data: { identity: id.did, code: totpCode(secret) },
    });
    expect(confirmRes.status(), await confirmRes.text().catch(() => '')).toBe(200);
    const confirm = (await confirmRes.json()) as { data: { totp: { enabled: boolean; status: string } } };
    expect(confirm.data.totp.enabled).toBe(true);
    expect(confirm.data.totp.status).toBe('active');

    // 4) Verify a fresh code → accepted.
    const verifyRes = await ctx.post('/api/v1/public/identity/totp/verify', {
      data: { identity: id.did, code: totpCode(secret) },
    });
    expect(verifyRes.status()).toBe(200);
    expect(((await verifyRes.json()) as { data: { verified: boolean } }).data.verified).toBe(true);

    // 5) A wrong code → 401.
    const badRes = await ctx.post('/api/v1/public/identity/totp/verify', {
      data: { identity: id.did, code: '000000' },
    });
    expect(badRes.status()).toBe(401);
    expect(((await badRes.json()) as { message: string }).message).toBe('Invalid identity TOTP code');

    // 6) Revoke (authorized the same way) tears the binding down.
    const rchRes = await ctx.post('/api/v1/public/identity/actions/challenge', {
      data: { identity: id.did, action: 'identity.totp.revoke', audience, payload: {} },
    });
    expect(rchRes.status()).toBe(200);
    const rch = (await rchRes.json()) as { data: { challengeId: string; signingPayload: unknown } };
    const revokeRes = await ctx.post('/api/v1/public/identity/totp/revoke', {
      data: {
        identity: id.did,
        identityDocument: id.buildDocument(),
        audience,
        authorization: { challengeId: rch.data.challengeId, signature: id.sign(rch.data.signingPayload) },
      },
    });
    expect(revokeRes.status(), await revokeRes.text().catch(() => '')).toBe(200);
    const revoke = (await revokeRes.json()) as { data: { totp: { enabled: boolean; status: string } } };
    expect(revoke.data.totp.enabled).toBe(false);
    expect(revoke.data.totp.status).toBe('revoked');
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【身份能力(TOTP/Passkey/授权码) / API】 ND-API-032 应用授权码(PKCE)请求 → 批准 → 兑换", "ND-API-032 PKCE authorize request → approve → exchange (single-use code)"), async () => {
  skipIfNoService();
  const env = envFor('node');
  test.skip(!env['NODE_WALLET_PRIVATE_KEY'], 'NODE_WALLET_PRIVATE_KEY not configured');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const baseURL = env['baseURL']!;
  const audience = audienceFor(api);

  // The relying-party app must exist (with the redirect URI registered) before
  // it can request an authorization code — create one with a fresh owner.
  const wallet: BaseWallet = Wallet.createRandom();
  const address = getAddress(wallet.address);
  const tokens = await loginWithWallet(baseURL, wallet.privateKey);
  const ctx = await apiContext(api, { Authorization: `Bearer ${tokens.token}` });

  const redirectUri = 'http://localhost:9977/callback';
  let uid = '';
  try {
    const create = await buildCreateApplicationBody(wallet, address, {
      location: 'http://localhost:9977',
      redirectUris: [redirectUri],
    });
    const createRes = await ctx.post('/api/v1/public/applications', {
      data: create.body,
    });
    expect(createRes.status(), await createRes.text().catch(() => '')).toBe(200);
    uid = ((await createRes.json()) as { data: { uid: string } }).data.uid;
    expect(uid).toBeTruthy();

    // PKCE: verifier → S256 challenge.
    const { createHash, randomBytes } = await import('node:crypto');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // 1) Request an authorization: returns requestId + nonce + audience.
    const reqRes = await ctx.post('/api/v1/public/identity/authorize/request', {
      data: {
        appId: uid,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: 'S256',
        scopes: ['identity.basic'],
      },
    });
    expect(reqRes.status(), await reqRes.text().catch(() => '')).toBe(200);
    const req = (await reqRes.json()) as {
      data: { requestId: string; nonce: string; audience: string; status: string };
    };
    expect(req.data.status).toBe('pending');
    const { requestId, nonce } = req.data;
    const aud = req.data.audience ?? audience;

    // The pending request is retrievable.
    const getRes = await ctx.get(`/api/v1/public/identity/authorize/request/${requestId}`);
    expect(getRes.status()).toBe(200);
    expect(((await getRes.json()) as { data: { status: string } }).data.status).toBe('pending');

    // 2) The identity holder approves with a verifiable presentation.
    const holder = makeSelfAssertedIdentity();
    const presentation = holder.buildPresentation({ audience: aud, nonce, scopes: ['identity.basic'] });
    const approveRes = await ctx.post('/api/v1/public/identity/authorize/approve', {
      data: { requestId, presentation },
    });
    expect(approveRes.status(), await approveRes.text().catch(() => '')).toBe(200);
    const approve = (await approveRes.json()) as { data: { authorizationCode: string } };
    const code = approve.data.authorizationCode;
    expect(code).toBeTruthy();

    // 3) Exchange the code (with the matching verifier) → succeeds.
    const exRes = await ctx.post('/api/v1/public/identity/authorize/exchange', {
      data: { code, appId: uid, redirectUri, codeVerifier },
    });
    expect(exRes.status(), await exRes.text().catch(() => '')).toBe(200);
    expect(((await exRes.json()) as { code: number }).code).toBe(0);

    // 4) The authorization code is single-use — replay is rejected.
    const replayRes = await ctx.post('/api/v1/public/identity/authorize/exchange', {
      data: { code, appId: uid, redirectUri, codeVerifier },
    });
    expect(replayRes.status()).toBe(400);
    expect(((await replayRes.json()) as { message: string }).message).toBe(
      'IDENTITY_AUTHORIZATION_CODE_INVALID',
    );
  } finally {
    if (uid) {
      await ctx.delete(`/api/v1/public/applications/${uid}`, {
        data: await deleteBody(wallet, address, uid),
      });
    }
    await ctx.dispose();
  }
});
