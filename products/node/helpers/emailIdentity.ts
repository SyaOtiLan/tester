import type { APIRequestContext } from '@playwright/test';
import { getAddress, Wallet } from 'ethers';

import type { SelfAssertedIdentity } from './identity';

interface NodeEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

interface LinkedAccount {
  chainKey: string;
  address: string;
}

async function postData<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(path, { data });
  const body = (await response.json().catch(() => null)) as NodeEnvelope<T> | null;
  if (!response.ok() || !body?.data || (body.code !== undefined && body.code !== 0)) {
    const details = body?.message ?? (await response.text().catch(() => ''));
    throw new Error(`Node ${path} failed (HTTP ${response.status()}): ${details}`);
  }
  return body.data;
}

export async function linkWalletToIdentity(
  request: APIRequestContext,
  identity: SelfAssertedIdentity,
  privateKey: string,
): Promise<LinkedAccount> {
  const wallet = new Wallet(privateKey);
  const account = { chainKey: 'eip155:1', address: getAddress(wallet.address) };
  const challenge = await postData<{
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    message: string;
  }>(request, '/api/v1/public/identity/account-links/challenge', {
    identity: identity.did,
    account,
  });

  await postData(request, '/api/v1/public/identity/account-links/verify', {
    identityDocument: identity.buildDocument(),
    identity: identity.did,
    account,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    accountSignature: await wallet.signMessage(challenge.message),
  });
  return account;
}

export function resolveMailpitUrl(configured?: string): string {
  return (configured?.trim() || 'http://127.0.0.1:8025').replace(/\/+$/, '');
}

export async function readMailpitCode(
  request: APIRequestContext,
  mailpitUrl: string,
  email: string,
  sinceMs: number,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:${email}`);
  while (Date.now() < deadline) {
    const response = await request.get(`${mailpitUrl}/api/v1/search?query=${query}&limit=5`);
    if (response.ok()) {
      const body = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ ID: string; Subject?: string; Created?: string }>;
      };
      const messages = (body.messages ?? [])
        .filter((message) => Date.parse(message.Created ?? '') >= sinceMs - 1000)
        .sort((a, b) => Date.parse(b.Created ?? '') - Date.parse(a.Created ?? ''));
      for (const message of messages) {
        const fromSubject = message.Subject?.match(/\b\d{6}\b/)?.[0];
        if (fromSubject) return fromSubject;
        const detail = await request.get(`${mailpitUrl}/api/v1/message/${message.ID}`);
        if (detail.ok()) {
          const contents = (await detail.json().catch(() => ({}))) as {
            Subject?: string;
            Text?: string;
          };
          const code = `${contents.Subject ?? ''}\n${contents.Text ?? ''}`.match(/\b\d{6}\b/)?.[0];
          if (code) return code;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No verification code for ${email} appeared in Mailpit`);
}

export async function requestAndConfirmEmail(
  request: APIRequestContext,
  mailpitUrl: string,
  identity: SelfAssertedIdentity,
  account: LinkedAccount,
  email: string,
) {
  const requestedAt = Date.now();
  const verification = await postData<{ verificationId: string }>(
    request,
    '/api/v1/public/identity/verifications/request',
    { types: ['email'], identity: identity.did, account, email },
  );
  const code = await readMailpitCode(request, mailpitUrl, email, requestedAt);
  return request.post('/api/v1/public/identity/verifications/confirm', {
    data: { types: ['email'], verificationId: verification.verificationId, code },
  });
}
