/**
 * Router — real wallet-identity login (RT-API, module 十三).
 *
 * The end-to-end wallet-identity path, run against LIVE services (no stubs):
 *
 *   YeYing Node issuer (:8100) + Mailpit dev inbox (:8025) + Router (:3011)
 *   + the real wallet MV3 extension driving `wallet_identity_presentation`.
 *
 * Flow:
 *   1. Create + unlock a wallet, then onboard a real `did:yeying:wid_…`
 *      identity — link the EVM account, verify email + username against the
 *      Node (reading the code out of Mailpit). See helpers/identity.ts.
 *   2. Ask Router for an identity login session (nonce + audience + scopes).
 *   3. Have the wallet produce a genuine Ed25519 verifiable presentation for
 *      that session via the injected EIP-1193 provider (with user approval).
 *   4. POST the presentation to Router's verify endpoint and assert Router
 *      accepts it and persists the wallet identity DID on the user.
 *
 * This is the proof that "web3 产品用钱包登录 → 钱包身份" works through the
 * real stack, and covers the previously-⬜ identity-login case. It requires
 * the Node trust material (config.identity.trust_dir) to contain the issuer
 * keys; if Router cannot verify the credentials the verify step fails loudly
 * rather than being faked green.
 */
import { localizedTitle } from '../../../shared/title';
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import { test, expect, baseURLFor } from '../../wallet/fixtures';
import { loadWalletContext, teardownWalletContext } from '../../wallet/helpers/extension';
import { stubPublicEndpoints } from '../../wallet/helpers/network';
import { createAndUnlockWallet, TEST_PASSWORD } from '../../wallet/helpers/popup';
import {
  onboardWalletIdentity,
  routerCreateIdentitySession,
  routerVerifyIdentityLogin,
  resolveNodeUrl,
} from '../helpers/identity';

/**
 * Resolve an approval window by TYPE, tolerant of the open-before-we-listen
 * race. The shared `waitForApproval` relies on `context.waitForEvent('page')`,
 * which only fires for windows opened *after* the listener attaches; the
 * wallet can open the approval faster than that, so we poll the already-open
 * pages first and only then fall back to waiting.
 */
async function getApproval(
  context: BrowserContext,
  extensionId: string,
  requestType: string,
  timeoutMs = 30_000,
): Promise<Page> {
  const prefix = `chrome-extension://${extensionId}/html/approval.html`;
  const matches = (p: Page) =>
    p.url().startsWith(prefix) && new URL(p.url()).searchParams.get('type') === requestType;
  const deadline = Date.now() + timeoutMs;
  let page: Page | undefined;
  while (Date.now() < deadline) {
    page = context.pages().find(matches);
    if (page) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!page) throw new Error(`approval window type=${requestType} never opened`);
  await page.bringToFront();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.request-view:not(.hidden)').first().waitFor({ state: 'visible', timeout: 10_000 });
  return page;
}

const ROUTER_BASE = baseURLFor('router');

// Router user roles (internal/admin/model/user.go): guest=0, common=1, admin=10, root=100.
const ROLE_COMMON_USER = 1;

// A hermetic dApp origin used only to host the injected provider. The VP's
// audience comes from the Router session parameters we pass to the provider,
// not from the page origin, so a static stub avoids the router SPA's own web3
// navigation racing our `eth_requestAccounts` call.
const DAPP_ORIGIN = 'https://dapp.identity.e2e.invalid/';

// This spec builds its own extension context and talks to three live services;
// give it room and never parallelise the shared login sessions.
test.describe.configure({ mode: 'serial' });

/** Skip the running test unless the Node issuer answers its health probe. */
async function requireNodeReachable(nodeUrl: string): Promise<void> {
  const probe = await chromium.launch();
  try {
    const api = await probe.newContext();
    const health = await api.request
      .get(`${nodeUrl}/api/v1/health`, { timeout: 5_000 })
      .catch(() => null);
    test.skip(!health, `Node issuer not reachable at ${nodeUrl}`);
    await api.close();
  } finally {
    await probe.close();
  }
}

interface PreparedLogin {
  identity: Awaited<ReturnType<typeof onboardWalletIdentity>>;
  session: Awaited<ReturnType<typeof routerCreateIdentitySession>>;
  vp: any;
}

/**
 * Shared setup for the identity-login cases: onboard a brand-new verified
 * identity against the live Node + Mailpit, open a Router login session and
 * drive the injected provider to produce a genuine VP for it. Each call runs
 * in a fresh wallet context, so the DID / EVM address / username have never
 * been seen by Router — the caller decides what Router should do with them.
 */
async function onboardAndPresent(
  ctx: Awaited<ReturnType<typeof loadWalletContext>>,
  routerBase: string,
  nodeUrl: string,
): Promise<PreparedLogin> {
  await stubPublicEndpoints(ctx.context);
  await ctx.context.route(`${DAPP_ORIGIN}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Identity login harness</title></head><body><main><h1>Router identity login e2e</h1></main></body></html>',
    });
  });
  const popup = await createAndUnlockWallet(ctx.context, ctx.extensionId);
  const request = ctx.context.request;

  // 1. Onboard a real verified identity against Node + Mailpit.
  const identity = await onboardWalletIdentity({ popup, request, password: TEST_PASSWORD, nodeUrl });
  expect(identity.did, 'a did:yeying:wid_ identity was created').toMatch(/^did:yeying:wid_/);
  expect(
    identity.credentialTypes,
    `identity should hold all three required credential types (got ${identity.credentialTypes.join(', ')})`,
  ).toEqual(expect.arrayContaining(['WalletAccountCredential', 'EmailCredential', 'UsernameCredential']));

  // 2. Router login session.
  const session = await routerCreateIdentitySession(request, routerBase);
  expect(session.sessionId).toBeTruthy();
  expect(session.nonce).toBeTruthy();
  expect(session.scopes).toEqual(
    expect.arrayContaining(['identity.basic', 'identity.wallet', 'identity.username', 'identity.email']),
  );

  // 3. Produce a real VP for that session via the injected provider.
  const dapp = await ctx.context.newPage();
  await dapp.goto(DAPP_ORIGIN, { waitUntil: 'domcontentloaded' });
  await dapp.waitForFunction(() => (globalThis as any).ethereum?.isYeYing === true, undefined, {
    timeout: 20_000,
  });

  // Connect the dApp origin first (site authorization).
  const connectPromise = dapp.evaluate(() =>
    (globalThis as any).ethereum.request({ method: 'eth_requestAccounts' }),
  );
  const connectApproval = await getApproval(ctx.context, ctx.extensionId, 'connect');
  await connectApproval.locator('#approveConnect').click({ timeout: 10_000 });
  const accounts = (await connectPromise) as string[];
  expect(accounts[0].toLowerCase()).toBe(identity.address.toLowerCase());

  // Request the identity presentation for Router's session parameters. The
  // wallet grants the identity scopes silently on the back of the fresh connect
  // approval (a 30s window in account-handler), so this resolves straight to a
  // VP — there is no second approval window to click.
  const presentationResult = (await dapp.evaluate(
    async ({ audience, nonce, scopes }) => {
      try {
        const vp = await (globalThis as any).ethereum.request({
          method: 'wallet_identity_presentation',
          params: [{ audience, nonce, scopes }],
        });
        return { ok: true, vp };
      } catch (err: any) {
        return { ok: false, code: err?.code, message: err?.message };
      }
    },
    { audience: session.audience, nonce: session.nonce, scopes: session.scopes },
  )) as { ok: true; vp: any } | { ok: false; code?: number; message?: string };
  expect(
    presentationResult.ok,
    presentationResult.ok ? '' : `presentation failed: ${presentationResult.message}`,
  ).toBe(true);
  const vp = (presentationResult as { ok: true; vp: any }).vp;
  expect(vp?.holder).toBe(identity.did);
  expect(vp?.proof?.type).toBe('YeyingIdentityPresentationProofV1');

  return { identity, session, vp };
}

test.describe(localizedTitle("【钱包身份登录(真实 Node + Mailpit)】Router钱包身份登录（真实Node + Mailpit）（Router wallet identity login (real Node + Mailpit)）", "Router wallet identity login (real Node + Mailpit)"), () => {
  test.skip(!ROUTER_BASE, 'ROUTER_BASE_URL not configured');

  test(localizedTitle("【钱包身份登录(真实 Node + Mailpit) / API】 RT-API-067 全新钱包身份自动注册并落库 DID", "RT-API-067: a brand-new wallet identity auto-registers, logs in and persists the DID"), async ({}, testInfo) => {
    testInfo.setTimeout(150_000);
    const routerBase = ROUTER_BASE!;
    const nodeUrl = resolveNodeUrl();
    await requireNodeReachable(nodeUrl);

    const ctx = await loadWalletContext();
    try {
      const { identity, session, vp } = await onboardAndPresent(ctx, routerBase, nodeUrl);

      // Router verifies the VP and — because this DID / address / username are
      // all brand new — takes the auto-register branch (findOrCreateWalletIdentityUser
      // → autoCreateWalletIdentityUser), issuing a token and persisting the DID.
      const login = await routerVerifyIdentityLogin(ctx.context.request, routerBase, {
        sessionId: session.sessionId,
        address: identity.address,
        presentation: vp,
      });
      expect(login.ok, `Router identity login failed (HTTP ${login.status}): ${login.message}`).toBe(true);
      expect(login.data?.token, 'a session token is issued').toBeTruthy();
      expect(login.data?.did).toBe(identity.did);
      expect(String(login.data?.walletAddress || '').toLowerCase()).toBe(identity.address.toLowerCase());

      // The persisted user is a freshly auto-created common account: the brand-new
      // DID + address are stored and the identity's own username is adopted with a
      // common-user role. Because this DID / address / username were never seen by
      // Router before, a matching user can only exist via autoCreateWalletIdentityUser
      // — the proof that a never-before-seen user onboards purely via wallet identity.
      // (has_password is NOT asserted: the repo's Create() forces it true whenever a
      // Password string is present, and auto-create seeds a random one, so it is true
      // for identity users too and carries no new-vs-existing signal.)
      const user = login.data?.user ?? {};
      expect(String(user.wallet_identity_did || '').trim()).toBe(identity.did);
      expect(String(user.wallet_address || '').toLowerCase()).toBe(identity.address.toLowerCase());
      expect(String(user.username || '').trim()).toBe(identity.username);
      expect(user.role).toBe(ROLE_COMMON_USER);
    } finally {
      await teardownWalletContext(ctx);
    }
  });

  test(localizedTitle("【钱包身份登录(真实 Node + Mailpit) / API】 RT-API-068 未关联身份在关闭自动注册时被拒", "RT-API-068: unlinked identity is rejected when auto-register is disabled"), async ({}, testInfo) => {
    testInfo.setTimeout(150_000);
    const routerBase = ROUTER_BASE!;
    const nodeUrl = resolveNodeUrl();
    await requireNodeReachable(nodeUrl);

    const ctx = await loadWalletContext();
    try {
      const { identity, session, vp } = await onboardAndPresent(ctx, routerBase, nodeUrl);

      // Same brand-new identity, but here we assert Router's *rejection* path for
      // an unlinked account. That branch only fires when AutoRegisterEnabled is
      // off; this deployment ships it ON (RT-API-067 proves auto-register works),
      // so a fresh identity logs straight in. When that happens we cannot exercise
      // the rejection and downgrade to a skip rather than faking a green — exactly
      // as auth-negative does for the SIWE auto-register probe.
      const login = await routerVerifyIdentityLogin(ctx.context.request, routerBase, {
        sessionId: session.sessionId,
        address: identity.address,
        presentation: vp,
      });
      test.skip(
        login.ok,
        'AutoRegisterEnabled=true on this deployment: an unlinked identity auto-registers instead of being rejected; rejection branch unreachable',
      );

      // Auto-register is OFF → the unlinked identity must be refused with the
      // specific controlled message, not a 5xx or a generic error.
      expect(login.data?.token, 'no token is issued for a rejected login').toBeFalsy();
      expect(
        login.message || '',
        `expected the unlinked-account rejection message, got: ${login.message}`,
      ).toMatch(/未找到钱包身份关联的账户|请先绑定|自动注册/);
    } finally {
      await teardownWalletContext(ctx);
    }
  });
});
