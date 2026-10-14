/**
 * node — application write-path authorization & signed-action guards (API).
 *
 * Every mutating application route runs the request body through
 * `executeSignedAction`, which verifies a `personal_sign` envelope before the
 * handler body runs. These API tests exercise that gate and the authorization
 * checks around it, using a fresh throwaway wallet per test so residue lives
 * under a never-reused owner address.
 *
 * Covers:
 *   - ND-API-022 publish an un-approved app → 403 Audit not approved
 *   - ND-API-025 missing / invalid signature envelope → 400 / 401
 *   - ND-API-016 create missing did/version → 400
 *   - ND-API-017 create owner mismatch → 403
 *   - ND-API-018 create without JWT → 401
 *   - ND-API-026 application config PUT → GET round-trip
 *   - ND-API-028 non-admin audit search out of scope → 403
 *
 * Signed-action envelope + payload contracts live in
 * `products/node/helpers/signedAction.ts` (mirrors node
 * `src/routes/public/applications.ts`).
 */
import { localizedTitle } from '../../../shared/title';
import { randomUUID } from 'crypto';
import { Wallet, getAddress, type BaseWallet } from 'ethers';

import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { loginWithWallet } from '../helpers/auth';
import {
  buildConfigUpsertBody,
  buildCreateApplicationBody,
  buildUpdateApplicationBody,
  deleteBody,
  publishBody,
} from '../helpers/signedAction';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
}

interface Session {
  wallet: BaseWallet;
  address: string; // checksummed
  ctx: Awaited<ReturnType<typeof apiContext>>;
}

/** Fresh random wallet → real SIWE login → authed API context. */
async function freshSession(baseURL: string): Promise<Session> {
  const wallet = Wallet.createRandom();
  const tokens = await loginWithWallet(baseURL, wallet.privateKey);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${tokens.token}` });
  return { wallet, address: getAddress(wallet.address), ctx };
}

async function createApp(s: Session, baseURL: string) {
  const req = await buildCreateApplicationBody(s.wallet, s.address);
  const res = await s.ctx.post('/api/v1/public/applications', { data: req.body });
  const body = (await res.json()) as { code: number; data?: { uid?: string } };
  expect(res.status(), await res.text().catch(() => '')).toBe(200);
  expect(body.code).toBe(0);
  expect(body.data?.uid).toBeTruthy();
  return { uid: body.data!.uid! };
}

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-022 发布未通过审核的应用返回 403", "ND-API-022 publishing an un-approved application is rejected with 403"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const s = await freshSession(baseURL);
  try {
    const { uid } = await createApp(s, baseURL);
    // A valid signature envelope — so this is NOT a signature failure; the
    // publish is blocked purely by the missing approved audit gate.
    const res = await s.ctx.post(`/api/v1/public/applications/${uid}/publish`, {
      data: await publishBody(s.wallet, s.address, uid),
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.message).toBe('Audit not approved');
    // clean up
    await s.ctx.delete(`/api/v1/public/applications/${uid}`, {
      data: await deleteBody(s.wallet, s.address, uid),
    });
  } finally {
    await s.ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-025 写操作缺失/无效签名信封被拒", "ND-API-025 write operations reject missing / invalid signature envelopes"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const s = await freshSession(baseURL);
  try {
    const { uid } = await createApp(s, baseURL);

    // publish with no envelope → 400 Missing signature fields
    const noSig = await s.ctx.post(`/api/v1/public/applications/${uid}/publish`, { data: {} });
    expect(noSig.status()).toBe(400);
    expect(((await noSig.json()) as { message: string }).message).toBe('Missing signature fields');

    // publish with a well-formed-but-wrong signature → 401 Invalid signature
    const badSig = await s.ctx.post(`/api/v1/public/applications/${uid}/publish`, {
      data: {
        requestId: randomUUID(),
        timestamp: new Date().toISOString(),
        signature: '0x' + 'ab'.repeat(65),
      },
    });
    expect(badSig.status()).toBe(401);
    expect(((await badSig.json()) as { message: string }).message).toBe('Invalid signature');

    // delete with no envelope → 400 (delete is also a signed action)
    const delNoSig = await s.ctx.delete(`/api/v1/public/applications/${uid}`, { data: {} });
    expect(delNoSig.status()).toBe(400);
    expect(((await delNoSig.json()) as { message: string }).message).toBe('Missing signature fields');

    // clean up with a valid envelope
    await s.ctx.delete(`/api/v1/public/applications/${uid}`, {
      data: await deleteBody(s.wallet, s.address, uid),
    });
  } finally {
    await s.ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-016 建应用缺 did/version 返回 400", "ND-API-016 create missing did/version returns 400"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const s = await freshSession(baseURL);
  try {
    // owner omitted → defaults to the logged-in address (passes owner check);
    // did/version validation runs before the signature gate.
    const res = await s.ctx.post('/api/v1/public/applications', {
      data: { name: 'no-did', location: 'http://localhost:3020' },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('Missing did or version');
  } finally {
    await s.ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-017 建应用 owner 与登录地址不符返回 403", "ND-API-017 create with mismatched owner returns 403"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const s = await freshSession(baseURL);
  try {
    const other = getAddress(Wallet.createRandom().address);
    const res = await s.ctx.post('/api/v1/public/applications', {
      data: { owner: other, did: `did:e2e:${Date.now()}`, version: 1, location: 'http://localhost:3020' },
    });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe('Owner mismatch');
  } finally {
    await s.ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-018 建应用未登录返回 401", "ND-API-018 create without a JWT returns 401"), async () => {
  skipIfNoService();
  const baseURL = baseURLFor('node')!;
  const ctx = await apiContext(baseURL);
  try {
    const res = await ctx.post('/api/v1/public/applications', {
      data: { did: `did:e2e:${Date.now()}`, version: 1, location: 'http://localhost:3020' },
    });
    expect(res.status()).toBe(401);
    expect(((await res.json()) as { message: string }).message).toBe('Missing access token');
  } finally {
    await ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-026 应用授权配置读取与写入", "ND-API-026 application config round-trips through PUT then GET"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const s = await freshSession(baseURL);
  try {
    const { uid } = await createApp(s, baseURL);
    const config = [
      { code: 'DOMAIN_A', instance: 'instance-a' },
      { code: 'DOMAIN_B', instance: 'instance-b' },
    ];

    const put = await s.ctx.put(`/api/v1/public/applications/${uid}/config`, {
      data: await buildConfigUpsertBody(s.wallet, s.address, uid, config),
    });
    expect(put.status(), await put.text().catch(() => '')).toBe(200);
    expect(((await put.json()) as { code: number }).code).toBe(0);

    const get = await s.ctx.get(`/api/v1/public/applications/${uid}/config`);
    expect(get.status()).toBe(200);
    const body = (await get.json()) as { data: { config: Array<{ code: string; instance: string }> } };
    expect(body.data.config).toEqual(config);

    await s.ctx.delete(`/api/v1/public/applications/${uid}`, {
      data: await deleteBody(s.wallet, s.address, uid),
    });
  } finally {
    await s.ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-027 保存草稿前的重名检查", "ND-API-027 duplicate-name pre-check search returns matching own applications"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const s = await freshSession(baseURL);
  try {
    // Create a draft with a known, unique name.
    const req = await buildCreateApplicationBody(s.wallet, s.address);
    const createRes = await s.ctx.post('/api/v1/public/applications', { data: req.body });
    expect(createRes.status(), await createRes.text().catch(() => '')).toBe(200);
    const uid = ((await createRes.json()) as { data: { uid: string } }).data.uid;
    expect(uid).toBeTruthy();

    // The front-end's rename-collision check searches by the same name within
    // the caller's own (offline-inclusive) scope. It must return 200 with the
    // matching row — never a 500 — so the UI can warn about a duplicate.
    const searchRes = await s.ctx.post('/api/v1/public/applications/search', {
      data: { condition: { name: req.name, owner: s.address, includeOffline: true } },
    });
    expect(searchRes.status(), await searchRes.text().catch(() => '')).toBe(200);
    const body = (await searchRes.json()) as {
      code: number;
      data: { items: Array<{ uid: string; name: string }> };
    };
    expect(body.code).toBe(0);
    const hit = body.data.items.find((item) => item.uid === uid);
    expect(hit, 'the just-created same-name app is returned by the search').toBeTruthy();
    expect(hit!.name).toBe(req.name);

    await s.ctx.delete(`/api/v1/public/applications/${uid}`, {
      data: await deleteBody(s.wallet, s.address, uid),
    });
  } finally {
    await s.ctx.dispose();
  }
});

test(localizedTitle("【应用审核 / API】 ND-API-028 非管理员审核检索被限定范围", "ND-API-028 non-admin audit search outside own scope returns 403"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const s = await freshSession(baseURL);
  try {
    const other = getAddress(Wallet.createRandom().address);
    const res = await s.ctx.post('/api/v1/public/audits/search', {
      data: { condition: { applicant: other } },
    });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe('Audit search scope denied');
  } finally {
    await s.ctx.dispose();
  }
});

/** GET the application list for a session with an optional query string. */
async function listApps(s: Session, query = '') {
  const res = await s.ctx.get(`/api/v1/public/applications${query}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    data: { items: Array<{ uid: string }>; page: { total: number; page: number; pageSize: number } };
  };
  return body.data;
}

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-019 应用列表仅返回可见范围", "ND-API-019 application list returns only the caller-visible scope"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const a = await freshSession(baseURL);
  const b = await freshSession(baseURL);
  try {
    const appA = await createApp(a, baseURL);
    const appB = await createApp(b, baseURL);

    // Default list is the public (online) scope: it never leaks another
    // owner's unpublished draft, nor even the caller's own offline draft.
    const def = await listApps(a);
    expect(def.page).toBeTruthy();
    expect(def.items.map((i) => i.uid)).not.toContain(appB.uid);
    expect(def.items.map((i) => i.uid)).not.toContain(appA.uid);

    // A can see its OWN draft when it explicitly asks for offline + own owner.
    const own = await listApps(a, `?owner=${a.address}&includeOffline=true`);
    expect(own.items.map((i) => i.uid)).toContain(appA.uid);

    // A asking for B's offline drafts is scope-downgraded (includeOffline is
    // dropped for a non-owner/non-admin), so B's draft stays hidden.
    const cross = await listApps(a, `?owner=${b.address}&includeOffline=true`);
    expect(cross.items.map((i) => i.uid)).not.toContain(appB.uid);

    await a.ctx.delete(`/api/v1/public/applications/${appA.uid}`, {
      data: await deleteBody(a.wallet, a.address, appA.uid),
    });
    await b.ctx.delete(`/api/v1/public/applications/${appB.uid}`, {
      data: await deleteBody(b.wallet, b.address, appB.uid),
    });
  } finally {
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-020 应用详情对不可见者返回 404", "ND-API-020 application detail is 404 to a non-visible viewer, 200 to the owner"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const a = await freshSession(baseURL);
  const b = await freshSession(baseURL);
  try {
    const appB = await createApp(b, baseURL);

    // A cannot see B's unpublished draft — invisible reads as not-found.
    const asA = await a.ctx.get(`/api/v1/public/applications/${appB.uid}`);
    expect(asA.status()).toBe(404);
    expect(((await asA.json()) as { message: string }).message).toBe('Application not found');

    // The owner B sees the full record.
    const asB = await b.ctx.get(`/api/v1/public/applications/${appB.uid}`);
    expect(asB.status()).toBe(200);
    expect(((await asB.json()) as { data: { uid: string } }).data.uid).toBe(appB.uid);

    await b.ctx.delete(`/api/v1/public/applications/${appB.uid}`, {
      data: await deleteBody(b.wallet, b.address, appB.uid),
    });
  } finally {
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-021 更新应用非属主返回 403", "ND-API-021 updating an application: non-owner 403, owner 200"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const a = await freshSession(baseURL);
  const b = await freshSession(baseURL);
  try {
    const appB = await createApp(b, baseURL);

    // A signs a valid application_update envelope over B's app → the signature
    // passes, but the owner check rejects it with 403.
    const asA = await a.ctx.patch(`/api/v1/public/applications/${appB.uid}`, {
      data: await buildUpdateApplicationBody(a.wallet, a.address, appB.uid, { name: 'hijacked' }),
    });
    expect(asA.status()).toBe(403);
    expect(((await asA.json()) as { message: string }).message).toBe('Owner mismatch');

    // The owner's own update persists.
    const newName = `renamed-${Date.now()}`;
    const asB = await b.ctx.patch(`/api/v1/public/applications/${appB.uid}`, {
      data: await buildUpdateApplicationBody(b.wallet, b.address, appB.uid, {
        name: newName,
        description: 'owner update',
      }),
    });
    expect(asB.status(), await asB.text().catch(() => '')).toBe(200);
    expect(((await asB.json()) as { data: { name: string } }).data.name).toBe(newName);

    // Persisted: re-reading the record returns the new name.
    const reread = await b.ctx.get(`/api/v1/public/applications/${appB.uid}`);
    expect(((await reread.json()) as { data: { name: string } }).data.name).toBe(newName);

    await b.ctx.delete(`/api/v1/public/applications/${appB.uid}`, {
      data: await deleteBody(b.wallet, b.address, appB.uid),
    });
  } finally {
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-023 下线应用恢复为离线", "ND-API-023 unpublish restores an application to offline and removes it from the market"), async () => {
  skipIfNoService();
  // The behavior under test — an ONLINE application transitioning to
  // BUSINESS_STATUS_OFFLINE and disappearing from the public market grid —
  // requires first bringing an app online, which needs an admin-approved audit
  // (see ND-E2E-003/004, skipped for the same reason). No admin approver is
  // available in this environment and other owners' online apps can't be
  // unpublished (Owner mismatch), so the online→offline path can't be driven
  // without faking a green.
  test.skip(true, 'requires an online (admin-approved & published) application; publish path is not drivable in this environment');
});

test(localizedTitle("【开发者应用生命周期 / API】 ND-API-024 删除他人应用返回 403", "ND-API-024 deleting another owner’s application returns 403 Owner mismatch"), async () => {
  skipIfNoService();
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
  const baseURL = baseURLFor('node')!;
  const a = await freshSession(baseURL);
  const b = await freshSession(baseURL);
  try {
    const appB = await createApp(b, baseURL);

    // A signs a valid application_delete envelope over B's app → owner check 403.
    const asA = await a.ctx.delete(`/api/v1/public/applications/${appB.uid}`, {
      data: await deleteBody(a.wallet, a.address, appB.uid),
    });
    expect(asA.status()).toBe(403);
    expect(((await asA.json()) as { message: string }).message).toBe('Owner mismatch');

    // The application still exists for its owner.
    const stillThere = await b.ctx.get(`/api/v1/public/applications/${appB.uid}`);
    expect(stillThere.status()).toBe(200);

    await b.ctx.delete(`/api/v1/public/applications/${appB.uid}`, {
      data: await deleteBody(b.wallet, b.address, appB.uid),
    });
  } finally {
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});
