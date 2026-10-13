/**
 * social — user profile + search API (platform, 8888).
 *
 * Drives GET /user/find/{id}, GET /user/findByName and PUT /user/update as a
 * SIWE-provisioned user. All shapes are live-verified.
 *
 * Contract (live):
 *  - GET  /user/find/{id}          -> Result<UserVO>
 *  - GET  /user/findByName?name=   -> Result<List<UserVO>> (matches nickName)
 *  - PUT  /user/update  (UserVO)   -> Result<null>; @Valid requires id/userName/nickName
 *
 * Env:
 *  - SOCIAL_BASE_URL      platform backend (8888)
 *  - SOCIAL_IDENTITY_URL  web3-identity (8901) — mints the wallet users
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { newSiweIdentity, platformCtx, type Envelope } from '../helpers/auth';

const platformURL = () => baseURLFor('social');
const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

interface UserVO {
  id: number;
  userName: string;
  nickName: string;
  signature: string;
  walletAddress: string;
}

function skipIfNoStack() {
  test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required');
}

// SO-API-025 (P1) — fetch a user by id.
// (SO-API-028 lives at the bottom of this file.)
test("【用户资料与搜索 / API】 SO-API-025 按 id 查询用户", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const B = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    const res = await ctx.get(`/user/find/${B.userId}`);
    const body = (await res.json()) as Envelope<UserVO>;
    expect(body.code).toBe(200);
    expect(body.data.id).toBe(B.userId);
    expect(body.data.walletAddress.toLowerCase()).toBe(B.address.toLowerCase());
  } finally {
    await ctx.dispose();
  }
});

// SO-API-026 (P1) — search users by (nick)name.
test("【用户资料与搜索 / API】 SO-API-026 按名称搜索用户", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    // A wallet user's default nickName is a shortened form of its address; use
    // it as the search term so we get a deterministic self-match.
    const selfRes = await ctx.get('/user/self');
    const self = ((await selfRes.json()) as Envelope<UserVO>).data;

    const res = await ctx.get(`/user/findByName?name=${encodeURIComponent(self.nickName)}`);
    const body = (await res.json()) as Envelope<UserVO[]>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((u) => u.id === A.userId)).toBe(true);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-027 (P1) — update own profile; the change round-trips via /user/self.
test("【用户资料与搜索 / API】 SO-API-027 更新个人资料", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    const selfRes = await ctx.get('/user/self');
    const self = ((await selfRes.json()) as Envelope<UserVO>).data;

    const newSig = `e2e-sig-${Date.now() % 1000000}`;
    const newNick = `E2E${Date.now() % 100000}`;
    const upd = await ctx.put('/user/update', { data: { ...self, signature: newSig, nickName: newNick } });
    expect(((await upd.json()) as Envelope<null>).code).toBe(200);

    const after = await ctx.get('/user/self');
    const afterBody = (await after.json()) as Envelope<UserVO>;
    expect(afterBody.code).toBe(200);
    expect(afterBody.data.signature).toBe(newSig);
    expect(afterBody.data.nickName).toBe(newNick);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-028 (P2) — query online terminals for a set of users.
// Live: GET /user/terminal/online?userIds=a,b -> Result<List<OnlineTerminalVO>>.
// Over pure HTTP (no live IM WebSocket) the users read back as offline, so the
// list is empty — we assert the endpoint is reachable and returns an array.
test("【用户资料与搜索 / API】 SO-API-028 查询终端在线状态", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const B = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    const res = await ctx.get(`/user/terminal/online?userIds=${A.userId},${B.userId}`);
    const body = (await res.json()) as Envelope<Array<{ userId: number; terminals: unknown }>>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  } finally {
    await ctx.dispose();
  }
});
