/* eslint-disable playwright/no-skipped-test, @typescript-eslint/no-explicit-any -- These gated E2E flows serialize browser WebAuthn objects across page.evaluate. */
import { randomBytes } from 'node:crypto';
import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { Wallet } from 'ethers';

import { apiContext } from '../../../shared/api';
import { localizedTitle } from '../../../shared/title';
import { envFor, test, expect } from '../fixtures';
import { makeSelfAssertedIdentity } from '../helpers/identity';
import {
  linkWalletToIdentity,
  readMailpitCode,
  requestAndConfirmEmail,
  resolveMailpitUrl,
} from '../helpers/emailIdentity';

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function testEndpoints() {
  const env = envFor('node');
  const selectedEnv = process.env.TEST_ENV?.trim().toLowerCase();
  test.skip(
    selectedEnv !== 'local' && selectedEnv !== 'test',
    'Set TEST_ENV=local or TEST_ENV=test to run identity email E2E cases',
  );
  test.skip(
    env['NODE_IDENTITY_EMAIL_E2E_ENABLED']?.trim().toLowerCase() !== 'true',
    'Set NODE_IDENTITY_EMAIL_E2E_ENABLED=true to opt in to identity email E2E cases',
  );

  const apiUrl = env['NODE_API_URL'] ?? env.baseURL;
  test.skip(!apiUrl, 'NODE_API_URL or NODE_BASE_URL is not configured');
  const apiHost = new URL(apiUrl!).hostname.toLowerCase();
  test.skip(
    selectedEnv === 'local' && !isLoopback(apiHost),
    'TEST_ENV=local requires a loopback Node API URL',
  );
  test.skip(
    apiHost === 'node.yeying.pub' || apiHost.endsWith('.node.yeying.pub'),
    'Identity email E2E cases are blocked from the production Node host',
  );

  const mailpitUrl = resolveMailpitUrl(env['MAILPIT_URL']);
  test.skip(
    !isLoopback(new URL(mailpitUrl).hostname),
    'Identity email E2E cases require a loopback Mailpit instance',
  );
  return { apiUrl: apiUrl!, mailpitUrl };
}

async function ensureMailpitAvailable(request: APIRequestContext, mailpitUrl: string) {
  let response: APIResponse;
  try {
    const query = encodeURIComponent('to:mailpit-healthcheck@example.test');
    response = await request.get(`${mailpitUrl}/api/v1/search?query=${query}&limit=1`);
  } catch {
    test.skip(true, 'Mailpit is not reachable; identity email E2E cases are skipped');
    throw new Error('Mailpit is not reachable');
  }
  test.skip(!response.ok(), 'Mailpit is not available; identity email E2E cases are skipped');
}

function uniqueEmail(): string {
  return `e2e-${randomBytes(12).toString('hex')}@example.test`;
}

async function ensureNodeAvailable(request: APIRequestContext) {
  let response: APIResponse;
  try {
    response = await request.get('/api/v1/public/health');
  } catch {
    test.skip(true, 'Node API is not reachable; identity email E2E cases are skipped');
    throw new Error('Node API is not reachable');
  }
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { code: number; data: { status: string } };
  expect(body.code).toBe(0);
  expect(body.data.status).toBe('ok');
}

async function createRegistrationCredential(
  page: Page,
  options: Record<string, unknown>,
  transport: 'internal' | 'usb',
) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  try {
    return await page.evaluate(async (opts: any) => {
      const decode = (value: string) => {
        let source = String(value).replace(/-/g, '+').replace(/_/g, '/');
        source = source.padEnd(source.length + ((4 - (source.length % 4)) % 4), '=');
        const binary = atob(source);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1)
          bytes[index] = binary.charCodeAt(index);
        return bytes.buffer;
      };
      const encode = (value: ArrayBuffer) => {
        let binary = '';
        for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      };
      const credential = await (navigator as any).credentials.create({
        publicKey: {
          rp: opts.rp,
          user: { ...opts.user, id: decode(opts.user.id) },
          challenge: decode(opts.challenge),
          pubKeyCredParams: opts.pubKeyCredParams,
          timeout: opts.timeout,
          attestation: opts.attestation,
          authenticatorSelection: opts.authenticatorSelection,
          hints: opts.hints,
          excludeCredentials: (opts.excludeCredentials || []).map((item: any) => ({
            ...item,
            id: decode(item.id),
          })),
        },
      });
      const response = credential.response as any;
      return {
        id: credential.id,
        rawId: encode(credential.rawId),
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
        response: {
          clientDataJSON: encode(response.clientDataJSON),
          attestationObject: encode(response.attestationObject),
          transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
        },
      };
    }, options);
  } finally {
    await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
  }
}

test(
  localizedTitle(
    '【身份邮箱绑定 / API】 ND-API-038 同 DID 多钱包可重验邮箱且普通换绑被拒',
    'ND-API-038 one DID can re-verify its email through another wallet but cannot silently rebind',
  ),
  async () => {
    const { apiUrl, mailpitUrl } = testEndpoints();
    const request = await apiContext(apiUrl);
    try {
      await ensureNodeAvailable(request);
      await ensureMailpitAvailable(request, mailpitUrl);
      const identity = makeSelfAssertedIdentity();
      const firstAccount = await linkWalletToIdentity(
        request,
        identity,
        Wallet.createRandom().privateKey,
      );
      const secondAccount = await linkWalletToIdentity(
        request,
        identity,
        Wallet.createRandom().privateKey,
      );
      const email = uniqueEmail();

      const initial = await requestAndConfirmEmail(
        request,
        mailpitUrl,
        identity,
        firstAccount,
        email,
      );
      expect(initial.status()).toBe(200);
      const initialBody = (await initial.json()) as {
        data: { credentials: Array<{ type: string }> };
      };
      expect(initialBody.data.credentials.map((item) => item.type)).toContain('EmailCredential');

      const renewed = await requestAndConfirmEmail(
        request,
        mailpitUrl,
        identity,
        secondAccount,
        email,
      );
      expect(renewed.status()).toBe(200);

      const replacement = await requestAndConfirmEmail(
        request,
        mailpitUrl,
        identity,
        secondAccount,
        uniqueEmail(),
      );
      expect(replacement.status()).toBe(409);
      expect(((await replacement.json()) as { message: string }).message).toBe(
        'IDENTITY_EMAIL_CHANGE_REQUIRES_AUTHORIZATION',
      );
    } finally {
      await request.dispose();
    }
  },
);

test(
  localizedTitle(
    '【无插件邮箱身份 / E2E】 ND-API-040 OTP 后创建并轮换 Passkey challenge，最终激活同一 DID',
    'ND-API-040 email bootstrap creates and rotates Passkey challenge after OTP, then activates the same DID',
  ),
  async ({ page }) => {
    const { apiUrl, mailpitUrl } = testEndpoints();
    const request = await apiContext(apiUrl);
    try {
      await ensureNodeAvailable(request);
      await ensureMailpitAvailable(request, mailpitUrl);
      const pageBaseUrl = envFor('node').baseURL;
      test.skip(!pageBaseUrl, 'NODE_BASE_URL is required for the WebAuthn browser origin');
      await page.goto(pageBaseUrl!, { waitUntil: 'domcontentloaded' });

      const identity = makeSelfAssertedIdentity();
      const identityDocument = identity.buildDocument();
      const email = uniqueEmail();
      const requestedAt = Date.now();
      const registrationResponse = await request.post(
        '/api/v1/public/auth/email/register/request',
        {
          data: {
            email,
            username: `e2e${randomBytes(8).toString('hex')}`,
            avatar: 'https://example.invalid/avatar.png',
            identityDocument,
            deviceName: 'E2E Bootstrap Passkey',
          },
        },
      );
      expect(registrationResponse.status(), await registrationResponse.text().catch(() => '')).toBe(
        200,
      );
      const registration = (await registrationResponse.json()) as {
        data: { verificationId: string; registrationId: string; identity: string };
      };
      expect(registration.data.identity).toBe(identity.did);
      const code = await readMailpitCode(request, mailpitUrl, email, requestedAt);

      const platformResponse = await request.post('/api/v1/public/auth/email/register/confirm', {
        data: {
          verificationId: registration.data.verificationId,
          code,
          authenticatorMode: 'platform',
        },
      });
      expect(platformResponse.status(), await platformResponse.text().catch(() => '')).toBe(200);
      const platform = (await platformResponse.json()) as {
        data: { registrationId: string; identity: string; passkeyRequest: Record<string, any> };
      };
      expect(platform.data).toMatchObject({
        registrationId: registration.data.registrationId,
        identity: identity.did,
      });
      expect(platform.data.passkeyRequest.authenticatorSelection).toMatchObject({
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      });
      expect(platform.data.passkeyRequest.hints).toEqual(['client-device']);

      const fallbackResponse = await request.post('/api/v1/public/auth/email/register/confirm', {
        data: {
          verificationId: registration.data.verificationId,
          code,
          authenticatorMode: 'security-key',
        },
      });
      expect(fallbackResponse.status(), await fallbackResponse.text().catch(() => '')).toBe(200);
      const fallback = (await fallbackResponse.json()) as {
        data: { registrationId: string; identity: string; passkeyRequest: Record<string, any> };
      };
      expect(fallback.data).toMatchObject({
        registrationId: registration.data.registrationId,
        identity: identity.did,
      });
      expect(fallback.data.passkeyRequest.requestId).toBe(platform.data.passkeyRequest.requestId);
      expect(fallback.data.passkeyRequest.challenge).not.toBe(
        platform.data.passkeyRequest.challenge,
      );
      expect(fallback.data.passkeyRequest.authenticatorSelection).toMatchObject({
        authenticatorAttachment: 'cross-platform',
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      });
      expect(fallback.data.passkeyRequest.hints).toEqual(['security-key']);

      const staleCredential = await createRegistrationCredential(
        page,
        platform.data.passkeyRequest,
        'internal',
      );
      const staleConfirmation = await request.post('/api/v1/public/identity/register/confirm', {
        data: {
          registrationId: registration.data.registrationId,
          identityDocument,
          credential: staleCredential,
        },
      });
      expect(staleConfirmation.status()).not.toBe(200);

      const credential = await createRegistrationCredential(
        page,
        fallback.data.passkeyRequest,
        'usb',
      );
      const passkeyConfirmation = await request.post('/api/v1/public/identity/register/confirm', {
        data: {
          registrationId: registration.data.registrationId,
          identityDocument,
          credential,
          deviceName: 'E2E Security Key',
        },
      });
      expect(passkeyConfirmation.status(), await passkeyConfirmation.text().catch(() => '')).toBe(
        200,
      );

      const account = await linkWalletToIdentity(
        request,
        identity,
        Wallet.createRandom().privateKey,
      );
      const completed = await request.post('/api/v1/public/auth/email/register/complete', {
        data: {
          verificationId: registration.data.verificationId,
          registrationId: registration.data.registrationId,
          accountLink: { account },
          custody: {
            walletId: `wallet_${randomBytes(8).toString('hex')}`,
            accountId: `account_${randomBytes(8).toString('hex')}`,
            address: account.address,
            ciphertext: 'e2e-wallet-v2-ciphertext',
            metadata: { version: 2, identityCount: 1, hasWalletIdentity: true },
          },
        },
      });
      expect(completed.status(), await completed.text().catch(() => '')).toBe(200);
      expect(((await completed.json()) as { data: { identity: string } }).data.identity).toBe(
        identity.did,
      );
    } finally {
      await request.dispose();
    }
  },
);

test(
  localizedTitle(
    '【身份邮箱绑定 / API】 ND-API-039 跨 DID 邮箱冲突且无插件注册不能绕过绑定',
    'ND-API-039 another DID and password-only registration cannot reuse a wallet-bound email',
  ),
  async () => {
    const { apiUrl, mailpitUrl } = testEndpoints();
    const request = await apiContext(apiUrl);
    try {
      await ensureNodeAvailable(request);
      await ensureMailpitAvailable(request, mailpitUrl);
      const existingIdentity = makeSelfAssertedIdentity();
      const existingAccount = await linkWalletToIdentity(
        request,
        existingIdentity,
        Wallet.createRandom().privateKey,
      );
      const email = uniqueEmail();
      const initial = await requestAndConfirmEmail(
        request,
        mailpitUrl,
        existingIdentity,
        existingAccount,
        email,
      );
      expect(initial.status()).toBe(200);

      const otherIdentity = makeSelfAssertedIdentity();
      const otherAccount = await linkWalletToIdentity(
        request,
        otherIdentity,
        Wallet.createRandom().privateKey,
      );
      const duplicate = await requestAndConfirmEmail(
        request,
        mailpitUrl,
        otherIdentity,
        otherAccount,
        email,
      );
      expect(duplicate.status()).toBe(409);
      expect(((await duplicate.json()) as { message: string }).message).toBe(
        'IDENTITY_EMAIL_ALREADY_BOUND',
      );

      const registrationIdentity = makeSelfAssertedIdentity();
      const registration = await request.post('/api/v1/public/auth/email/register/request', {
        data: {
          email,
          username: `e2e${randomBytes(8).toString('hex')}`,
          avatar: 'https://example.invalid/avatar.png',
          identityDocument: registrationIdentity.buildDocument(),
        },
      });
      expect(registration.status()).toBe(409);
      expect(((await registration.json()) as { message: string }).message).toBe(
        'IDENTITY_EMAIL_ALREADY_REGISTERED',
      );
    } finally {
      await request.dispose();
    }
  },
);
