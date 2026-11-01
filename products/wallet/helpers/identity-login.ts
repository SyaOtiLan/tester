/** Helpers for exercising wallet identity login through the injected provider. */
import type { BrowserContext, Page } from '@playwright/test';

import { waitForApproval } from './popup';

export const IDENTITY_LOGIN_ORIGIN = 'https://identity-login.e2e.invalid/';

export interface IdentityPresentation {
  version: number;
  holder: string;
  audience: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  scopes: string[];
  identityDocument?: Record<string, unknown>;
  credentials: string[];
  proof: { type: string; verificationMethod: string; purpose: string; proofValue: string };
}

export interface IdentityLoginResult {
  success: boolean;
  presentation?: IdentityPresentation;
  error?: string;
}

export interface IdentityAuthorizationResult {
  success: boolean;
  permissions?: Array<{ parentCapability: string; caveats?: unknown[] }>;
  error?: string;
}

export interface PublicIdentity {
  document: { id: string; walletIdentityId: string };
  publicJwk: Record<string, unknown>;
}

export async function serveIdentityLoginDapp(context: BrowserContext): Promise<void> {
  await context.route(`${IDENTITY_LOGIN_ORIGIN}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Wallet Identity Login</title></head><body><main><h1>Wallet Identity Login</h1></main></body></html>',
    }),
  );
}

export async function openIdentityLoginDapp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(IDENTITY_LOGIN_ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const provider = (globalThis as typeof globalThis & { ethereum?: { isYeYing?: boolean } })
        .ethereum;
      return provider?.isYeYing === true;
    },
    undefined,
    { timeout: 20_000 },
  );
  return page;
}

export async function authorizeIdentityLogin(
  context: BrowserContext,
  extensionId: string,
  dapp: Page,
  options: {
    scopes?: string[];
    beforeApprove?: (approval: Page) => Promise<void>;
  } = {},
): Promise<{ result: IdentityAuthorizationResult; approval: Page }> {
  const scopes = options.scopes ?? ['identity.basic'];
  const permissionPromise = dapp.evaluate(async (requestedScopes) => {
    try {
      const provider = (
        globalThis as typeof globalThis & {
          ethereum?: {
            request: (request: { method: string; params?: unknown[] }) => Promise<unknown>;
          };
        }
      ).ethereum;
      const permissions = await provider?.request({
        method: 'wallet_requestPermissions',
        params: [{ wallet_identity: { scopes: requestedScopes } }],
      });
      return {
        success: true,
        permissions,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, scopes);
  const approval = await waitForApproval(context, extensionId, { requestType: 'connect' });
  await options.beforeApprove?.(approval);
  await approval.locator('#approveConnect').click({ timeout: 10_000 });
  return { result: (await permissionPromise) as IdentityAuthorizationResult, approval };
}

export async function requestIdentityPresentation(
  context: BrowserContext,
  extensionId: string,
  dapp: Page,
  input: { audience: string; nonce: string; scopes?: string[] },
  options: { approve?: boolean; unlockPassword?: string } = {},
): Promise<{ result: IdentityLoginResult; approval?: Page }> {
  const requestPromise = dapp.evaluate(
    async ({ audience, nonce, scopes }) => {
      try {
        const provider = (
          globalThis as typeof globalThis & {
            ethereum?: {
              request: (request: { method: string; params?: unknown[] }) => Promise<unknown>;
            };
          }
        ).ethereum;
        const presentation = await provider?.request({
          method: 'wallet_identity_presentation',
          params: [{ appId: 'wallet-recovery-e2e', audience, nonce, scopes }],
        });
        return { success: true, presentation };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    {
      audience: input.audience,
      nonce: input.nonce,
      scopes: input.scopes ?? ['identity.basic'],
    },
  );

  let approval: Page | undefined;
  if (options.unlockPassword) {
    const unlock = await waitForApproval(context, extensionId, {
      requestType: 'unlock',
      timeout: 15_000,
    });
    await unlock.locator('#unlockPassword').fill(options.unlockPassword);
    await unlock.locator('#approveUnlock').click({ timeout: 10_000 });
  }
  if (options.approve !== false) {
    approval = await waitForApproval(context, extensionId, { requestType: 'connect' });
    await approval.locator('#approveConnect').click({ timeout: 10_000 });
  }
  return { result: (await requestPromise) as IdentityLoginResult, approval };
}

/** Verify both the DID document proof and the login Presentation proof. */
export async function verifyIdentityPresentation(
  page: Page,
  identity: PublicIdentity,
  presentation: IdentityPresentation,
): Promise<{ documentValid: boolean; presentationValid: boolean }> {
  return page.evaluate(
    async ({ publicJwk, presentation }) => {
      const key = await crypto.subtle.importKey('jwk', publicJwk, { name: 'Ed25519' }, false, [
        'verify',
      ]);
      const canonicalize = (value: unknown): string => {
        if (value === null || typeof value !== 'object') {
          const encoded = JSON.stringify(value);
          if (encoded === undefined) throw new Error('Identity signature payload is not JSON');
          return encoded;
        }
        if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
        const objectValue = value as Record<string, unknown>;
        return `{${Object.keys(objectValue)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalize(objectValue[key])}`)
          .join(',')}}`;
      };
      const decode = (value: string) => {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(`${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`);
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
      };
      const verifyObject = async (value: object) => {
        const { proof, ...unsigned } = value as Record<string, unknown>;
        if (!proof || typeof proof !== 'object') return false;
        const proofValue = (proof as Record<string, unknown>).proofValue;
        if (typeof proofValue !== 'string' || !proofValue) return false;
        return crypto.subtle.verify(
          { name: 'Ed25519' },
          key,
          decode(proofValue),
          new TextEncoder().encode(canonicalize(unsigned)),
        );
      };
      return {
        documentValid: await verifyObject(presentation.identityDocument || {}),
        presentationValid: await verifyObject(presentation),
      };
    },
    { publicJwk: identity.publicJwk, presentation },
  );
}
