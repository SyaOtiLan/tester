/**
 * Helpers for the wallet's 云端密钥托管 / 云端恢复 (cloud key custody / cloud
 * recovery) e2e tests.
 *
 * The custody feature talks to a custody service under
 * `<endpoint>/api/v1/public/custody/*` (see `js/background/custody-client.js`)
 * and to a Node identity service under `<endpoint>/api/v1/public/identity/*`.
 * All of those calls originate in the extension's **service worker**; Playwright
 * `context.route` intercepts SW requests in this harness (the same mechanism
 * `stubPublicEndpoints` relies on), so we stub the custody service entirely and
 * drive the SW message bus (`sendSw`) directly.
 *
 * The `CustodyClient` unwraps a `{ code, data }` envelope: `code === 0` returns
 * `data`, otherwise it throws. So every stubbed 2xx body is `{ code: 0, data }`.
 *
 * Secret ciphertext is produced with the extension's *own* `encryptObject`
 * (imported in-page from the popup, which is a same-origin extension page), so
 * the SW's `decryptObject` reads it back byte-for-byte. Never hand-roll the
 * PBKDF2/AES-GCM envelope here — pair with the product's crypto.
 */
import type { BrowserContext, Page } from '@playwright/test';

/** A dedicated non-resolving host — routed before DNS, never hits the network. */
export const CUSTODY_ENDPOINT = 'https://custody.e2e.test';

const CUSTODY_API = '/api/v1/public/custody';

/**
 * Well-known Hardhat/Anvil test vectors (account #0). Deterministic, public,
 * never funded on any real chain in these hermetic tests.
 */
export const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
export const TEST_ADDRESS_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const TEST_ADDRESS_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
export const TEST_PRIVATE_KEY_0 =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const DERIVATION_PATH_0 = "m/44'/60'/0'/0/0";
export const DERIVATION_PATH_1 = "m/44'/60'/0'/0/1";

/** The custody 密码 used to encrypt fixture secrets (>= 8 chars). */
export const CUSTODY_SECRET_PASSWORD = 'Custody-Secret-2026';

export interface CustodyRecord {
  walletId: string;
  address?: string;
  ciphertext: string;
  metadata?: Record<string, unknown>;
}

export interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  postData: string | null;
}

export interface CustodyStubOptions {
  /** GET /custody/recovery/secrets → { records, identityDid }. */
  recoveryRecords?: CustodyRecord[];
  identityDid?: string;
  /** walletId → record, served by GET /custody/recovery/secrets/{walletId}. */
  recoverySecrets?: Record<string, CustodyRecord>;
  /** GET /custody/secrets (authorized list) → { records, identityDid }. */
  authorizedRecords?: CustodyRecord[];
  /** walletId → record, served by GET /custody/secrets/{walletId}. */
  authorizedSecrets?: Record<string, CustodyRecord>;
  /** GET /custody/status → this object. */
  status?: Record<string, unknown>;
  /** HTTP status for DELETE /custody/secrets/{walletId} (default 200). */
  deleteStatus?: number;
  /** HTTP status for POST /custody/secrets (default 200). */
  upsertStatus?: number;
  /** DID returned by the mocked Node authorization exchange. */
  authorizationDid?: string;
  /** Token returned for the mocked custody.recovery authorization. */
  recoveryToken?: string;
}

export interface CustodyStub {
  requests: CapturedRequest[];
}

function json(data: unknown, code = 0) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code, data }),
  };
}

/**
 * Install a custody-service stub on `context`. Returns a live `requests` array
 * (every intercepted custody call, with captured post bodies) so tests can
 * assert what the wallet sent — e.g. that no plaintext secret leaks.
 */
export async function stubCustody(
  context: BrowserContext,
  opts: CustodyStubOptions = {},
): Promise<CustodyStub> {
  const requests: CapturedRequest[] = [];
  let authorizationRequest: { redirectUri: string; state: string; requestId: string } | null = null;

  await context.route(`${CUSTODY_ENDPOINT}/**`, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const postData = req.postData();
    const path = url.slice(CUSTODY_ENDPOINT.length).split('?')[0];
    requests.push({ method, url, path, postData });

    if (method === 'POST' && path === '/api/v1/public/identity/authorize/request') {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(postData || '{}');
      } catch {
        /* invalid body is asserted by the test */
      }
      authorizationRequest = {
        redirectUri: String(body.redirectUri || ''),
        state: String(body.state || ''),
        requestId: 'wallet-recovery-e2e-request',
      };
      return route.fulfill(json({ requestId: authorizationRequest.requestId }));
    }
    if (method === 'GET' && path === '/identity/authorize') {
      if (!authorizationRequest?.redirectUri || !authorizationRequest.state) {
        return route.fulfill({
          status: 400,
          contentType: 'text/plain',
          body: 'authorization request missing',
        });
      }
      const callback = new URL(authorizationRequest.redirectUri);
      callback.searchParams.set('code', 'wallet-recovery-e2e-code');
      callback.searchParams.set('state', authorizationRequest.state);
      const callbackUrl = callback.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body><h1>身份授权</h1><a id="approveRecovery" href="${callbackUrl}">授权并返回钱包</a></body></html>`,
      });
    }
    if (method === 'POST' && path === '/api/v1/public/identity/authorize/exchange') {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(postData || '{}');
      } catch {
        /* invalid body is asserted by the test */
      }
      const validExchange =
        body.code === 'wallet-recovery-e2e-code' &&
        typeof body.codeVerifier === 'string' &&
        body.codeVerifier.length > 0 &&
        body.redirectUri === authorizationRequest?.redirectUri;
      if (!validExchange) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 400, message: 'invalid PKCE exchange' }),
        });
      }
      return route.fulfill(
        json({
          did: opts.authorizationDid || opts.identityDid || '',
          custodyRecovery: {
            token: opts.recoveryToken || 'custody-recovery-e2e-token',
            expiresAt: Math.floor(Date.now() / 1000) + 300,
          },
        }),
      );
    }
    if (method === 'GET' && path === '/.well-known/openid-credential-issuer') {
      return route.abort('failed');
    }

    // Order matters: match the more specific recovery paths first.
    const recSecretMatch = path.match(new RegExp(`^${CUSTODY_API}/recovery/secrets/([^/]+)$`));
    const secretMatch = path.match(new RegExp(`^${CUSTODY_API}/secrets/([^/]+)$`));

    if (method === 'GET' && path === `${CUSTODY_API}/recovery/secrets`) {
      return route.fulfill(
        json({ records: opts.recoveryRecords ?? [], identityDid: opts.identityDid ?? '' }),
      );
    }
    if (method === 'GET' && recSecretMatch) {
      const walletId = decodeURIComponent(recSecretMatch[1]);
      const rec = opts.recoverySecrets?.[walletId];
      if (!rec)
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ code: 404, message: 'not found' }),
        });
      return route.fulfill(json(rec));
    }
    if (method === 'GET' && path === `${CUSTODY_API}/status`) {
      return route.fulfill(json(opts.status ?? { passkeyBound: false, recordCount: 0 }));
    }
    if (method === 'GET' && path === `${CUSTODY_API}/secrets`) {
      return route.fulfill(
        json({ records: opts.authorizedRecords ?? [], identityDid: opts.identityDid ?? '' }),
      );
    }
    if (method === 'GET' && secretMatch) {
      const walletId = decodeURIComponent(secretMatch[1]);
      const rec = opts.authorizedSecrets?.[walletId];
      if (!rec)
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ code: 404, message: 'not found' }),
        });
      return route.fulfill(json(rec));
    }
    if (method === 'DELETE' && secretMatch) {
      const status = opts.deleteStatus ?? 200;
      if (status >= 200 && status < 300) return route.fulfill(json({ deleted: true }));
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ code: status, message: 'delete failed' }),
      });
    }
    if (method === 'POST' && path === `${CUSTODY_API}/secrets`) {
      const status = opts.upsertStatus ?? 200;
      if (status >= 200 && status < 300)
        return route.fulfill(json({ walletId: 'server-assigned' }));
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ code: status, message: 'upsert failed' }),
      });
    }

    // Anything else under the custody host: fail loudly (aborted) so a missing
    // stub surfaces as a test failure rather than a silent real network call.
    return route.abort('failed');
  });

  return { requests };
}

/**
 * Encrypt a secret object with the extension's own `encryptObject`, run inside
 * the given extension page (same-origin dynamic import). Produces the exact
 * base64(salt|iv|AES-GCM) envelope the SW's `decryptObject` expects.
 */
export async function encryptSecret(
  page: Page,
  secret: unknown,
  password: string,
): Promise<string> {
  return page.evaluate(
    async ({ secret, password }) => {
      const mod = await import('/js/common/crypto/encryption.js');
      return mod.encryptObject(secret, password);
    },
    { secret, password },
  );
}

/** A minimal, valid v2 HD custody secret (Hardhat account #0, single account). */
export function hdSecret(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    wallet: {
      id: 'wallet-hd-1',
      name: '工作钱包',
      type: 'hd',
      createdAt: '2026-01-01T00:00:00.000Z',
      accountCount: 1,
    },
    mnemonic: TEST_MNEMONIC,
    accounts: [
      {
        accountId: 'acc-0',
        index: 0,
        name: '工作钱包',
        address: TEST_ADDRESS_0,
        derivationPath: DERIVATION_PATH_0,
      },
    ],
    identities: {},
    selectedIdentityId: '',
    exportedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A minimal, valid v2 imported (private-key) custody secret. */
export function importedSecret(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    wallet: {
      id: 'wallet-pk-1',
      name: '私钥钱包',
      type: 'imported',
      createdAt: '2026-01-01T00:00:00.000Z',
      accountCount: 1,
    },
    accounts: [
      {
        accountId: 'acc-pk-0',
        index: 0,
        name: '私钥钱包',
        address: TEST_ADDRESS_0,
        privateKey: TEST_PRIVATE_KEY_0,
      },
    ],
    identities: {},
    selectedIdentityId: '',
    exportedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
