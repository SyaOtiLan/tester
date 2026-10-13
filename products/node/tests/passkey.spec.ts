/**
 * node — identity Passkey registration request + confirm (ND-API-031).
 *
 * The passkey register/confirm loop is a real WebAuthn ceremony: register/request
 * authorizes the action with a self-asserted wallet-identity (same
 * `/identity/actions/challenge` → sign pattern as TOTP) and returns
 * `PublicKeyCredentialCreationOptions`; confirm runs the attestation through
 * `@simplewebauthn/server` `verifyRegistrationResponse`, which requires a
 * genuine authenticator response (origin `http://localhost:8100`, rpId
 * `localhost`, user-verified).
 *
 * We can't use physical hardware, but Chromium's CDP virtual authenticator
 * (`WebAuthn.addVirtualAuthenticator`) produces a real, verifiable `none`
 * attestation — exactly what a platform passkey emits. So we drive the full
 * loop: request (Node) → create credential (browser, virtual authenticator) →
 * confirm (Node) → list shows it → revoke (Node, authorized) tears it down.
 *
 * Contracts mirror node `src/routes/publicIdentityAuthorization.ts` +
 * `src/domain/service/identityAuthorization.ts`.
 */
import type { Page } from '@playwright/test';

import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { makeSelfAssertedIdentity } from '../helpers/identity';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

/** The identity subsystem treats the API origin as the authorization audience. */
function audienceFor(api: string): string {
  return new URL(api).origin;
}

/**
 * Register a CDP virtual authenticator on `page`, run `navigator.credentials.create`
 * with the server-issued creation options, and return the attestation serialized
 * as the `RegistrationResponseJSON` shape the confirm endpoint expects.
 */
async function createPasskeyCredential(page: Page, options: Record<string, unknown>) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  try {
    return await page.evaluate(async (opts: any) => {
      const b64urlToBuf = (value: string) => {
        let s = String(value).replace(/-/g, '+').replace(/_/g, '/');
        s = s.padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
        const bin = atob(s);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return u.buffer;
      };
      const bufToB64url = (buf: ArrayBuffer) => {
        const u = new Uint8Array(buf);
        let bin = '';
        for (const b of u) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      };
      const publicKey: any = {
        rp: opts.rp,
        user: { ...opts.user, id: b64urlToBuf(opts.user.id) },
        challenge: b64urlToBuf(opts.challenge),
        pubKeyCredParams: opts.pubKeyCredParams,
        timeout: opts.timeout,
        attestation: opts.attestation,
        authenticatorSelection: opts.authenticatorSelection,
        excludeCredentials: (opts.excludeCredentials || []).map((c: any) => ({
          ...c,
          id: b64urlToBuf(c.id),
        })),
      };
      const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
      const response = cred.response as AuthenticatorAttestationResponse;
      return {
        id: cred.id,
        rawId: bufToB64url(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: bufToB64url(response.clientDataJSON),
          attestationObject: bufToB64url(response.attestationObject),
          transports:
            typeof response.getTransports === 'function' ? response.getTransports() : [],
        },
        clientExtensionResults: cred.getClientExtensionResults(),
        authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      };
    }, options);
  } finally {
    await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
  }
}

test("【身份能力(TOTP/Passkey/授权码) / API】 ND-API-031 Passkey 注册请求与确认", async ({ page }) => {
  skipIfNoService();
  const env = envFor('node');
  const api = env['NODE_API_URL'] ?? env['baseURL']!;
  const baseURL = env['baseURL']!;
  const audience = audienceFor(api);
  const id = makeSelfAssertedIdentity();
  const deviceName = `e2e-passkey-${Date.now()}`;

  // The browser page must live at the configured passkey origin so the
  // clientDataJSON origin matches the server's expectation.
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });

  const ctx = await apiContext(api);
  let credentialId = '';
  try {
    // 1) Authorize the register action (self-asserted identity signs the payload).
    const chRes = await ctx.post('/api/v1/public/identity/actions/challenge', {
      data: { identity: id.did, action: 'identity.passkey.register', audience, payload: { deviceName } },
    });
    expect(chRes.status(), await chRes.text().catch(() => '')).toBe(200);
    const ch = (await chRes.json()) as { data: { challengeId: string; signingPayload: unknown } };
    expect(ch.data.challengeId).toBeTruthy();

    // 2) Request the WebAuthn creation options.
    const reqRes = await ctx.post('/api/v1/public/identity/passkeys/register/request', {
      data: {
        identity: id.did,
        identityDocument: id.buildDocument(),
        deviceName,
        audience,
        authorization: { challengeId: ch.data.challengeId, signature: id.sign(ch.data.signingPayload) },
      },
    });
    expect(reqRes.status(), await reqRes.text().catch(() => '')).toBe(200);
    const passkeyRequest = ((await reqRes.json()) as { data: { passkeyRequest: Record<string, unknown> } })
      .data.passkeyRequest;
    const requestId = passkeyRequest.requestId as string;
    expect(requestId).toBeTruthy();

    // 3) Produce a real attestation via the CDP virtual authenticator.
    const credential = await createPasskeyCredential(page, passkeyRequest);
    expect(credential.id).toBeTruthy();

    // 4) Confirm the registration → server verifies the attestation.
    const confirmRes = await ctx.post('/api/v1/public/identity/passkeys/register/confirm', {
      data: { identity: id.did, requestId, credential, deviceName },
    });
    expect(confirmRes.status(), await confirmRes.text().catch(() => '')).toBe(200);
    const confirm = (await confirmRes.json()) as { data: { credentialId: string; deviceName: string } };
    credentialId = confirm.data.credentialId;
    expect(credentialId).toBeTruthy();
    expect(confirm.data.deviceName).toBe(deviceName);

    // 5) List → the freshly-registered credential is present and active.
    const listRes = await ctx.post('/api/v1/public/identity/passkeys/list', {
      data: { identity: id.did },
    });
    expect(listRes.status()).toBe(200);
    const list = (await listRes.json()) as {
      data: { credentials: Array<{ credentialId: string; deviceName: string; revokedAt: string }> };
    };
    const hit = list.data.credentials.find((c) => c.credentialId === credentialId);
    expect(hit, 'registered credential appears in the list').toBeTruthy();
    expect(hit!.deviceName).toBe(deviceName);
    expect(hit!.revokedAt || '').toBe('');

    // 6) Revoke (authorized the same way) → the credential is torn down.
    const rchRes = await ctx.post('/api/v1/public/identity/actions/challenge', {
      data: { identity: id.did, action: 'identity.passkey.revoke', audience, payload: { credentialId } },
    });
    expect(rchRes.status()).toBe(200);
    const rch = (await rchRes.json()) as { data: { challengeId: string; signingPayload: unknown } };
    const revokeRes = await ctx.post('/api/v1/public/identity/passkeys/revoke', {
      data: {
        identity: id.did,
        identityDocument: id.buildDocument(),
        credentialId,
        audience,
        authorization: { challengeId: rch.data.challengeId, signature: id.sign(rch.data.signingPayload) },
      },
    });
    expect(revokeRes.status(), await revokeRes.text().catch(() => '')).toBe(200);
    const revoke = (await revokeRes.json()) as { data: { revokedAt: string } };
    expect(revoke.data.revokedAt).toBeTruthy();
  } finally {
    await ctx.dispose();
  }
});
