/**
 * social — single-friend read + delete API (platform, 8888).
 *
 * Extends the friend coverage in social-flow.spec.ts (list/add) with the
 * per-friend read and the delete path. Two SIWE users are made mutual friends,
 * then A reads and removes B. All shapes are live-verified.
 *
 * Contract (live):
 *  - GET    /friend/find/{friendId}   -> Result<FriendVO> {id, nickName, headImage, isDnd, deleted}
 *  - DELETE /friend/delete/{friendId} -> Result<null>; SOFT delete — the entry
 *      stays in /friend/list flagged `deleted:true` (FriendServiceImpl.unbindFriend
 *      sets deleted=true; findAllFriends does not filter deleted rows).
 *
 * Env:
 *  - SOCIAL_BASE_URL      platform backend (8888)
 *  - SOCIAL_IDENTITY_URL  web3-identity (8901)
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { newSiweIdentity, platformCtx, befriend, type Envelope } from '../helpers/auth';

const platformURL = () => baseURLFor('social');
const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

function skipIfNoStack() {
  test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required');
}

// SO-API-031 (P1) — read a single friend's info.
test("【好友与联系人 / API】 SO-API-031 查询单个好友信息", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const B = await newSiweIdentity(platformURL()!, identityURL()!);
  await befriend(platformURL()!, A, B);

  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    const res = await ctx.get(`/friend/find/${B.userId}`);
    const body = (await res.json()) as Envelope<{ id: number; nickName: string; deleted: boolean }>;
    expect(body.code).toBe(200);
    expect(body.data.id).toBe(B.userId);
    expect(body.data.deleted).toBe(false);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-033 (P2) — toggle the per-friend do-not-disturb flag; it round-trips
// through /friend/find (FriendVO.isDnd).
test("【好友与联系人 / API】 SO-API-033 好友免打扰开关", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const B = await newSiweIdentity(platformURL()!, identityURL()!);
  await befriend(platformURL()!, A, B);

  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    type FriendVO = { id: number; isDnd: boolean };
    const readDnd = async () =>
      ((await (await ctx.get(`/friend/find/${B.userId}`)).json()) as Envelope<FriendVO>).data.isDnd;

    // Turn DND on.
    const on = await ctx.put('/friend/dnd', { data: { friendId: B.userId, isDnd: 1 } });
    expect(((await on.json()) as Envelope<null>).code).toBe(200);
    expect(await readDnd()).toBe(true);

    // Turn DND off again.
    const off = await ctx.put('/friend/dnd', { data: { friendId: B.userId, isDnd: 0 } });
    expect(((await off.json()) as Envelope<null>).code).toBe(200);
    expect(await readDnd()).toBe(false);
  } finally {
    await ctx.dispose();
  }
});
test("【好友与联系人 / API】 SO-API-032 删除好友", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const B = await newSiweIdentity(platformURL()!, identityURL()!);
  await befriend(platformURL()!, A, B);

  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    type FriendRow = { id: number; deleted: boolean };
    // Precondition: B is an active (deleted:false) friend in A's list.
    const before = (await (await ctx.get('/friend/list')).json()) as Envelope<FriendRow[]>;
    expect(before.data.some((f) => f.id === B.userId && f.deleted === false)).toBe(true);

    const del = await ctx.delete(`/friend/delete/${B.userId}`);
    expect(((await del.json()) as Envelope<null>).code).toBe(200);

    // Soft delete: the row is either dropped or flagged deleted:true — it is no
    // longer an active friendship. (Live: the row remains with deleted:true.)
    const after = (await (await ctx.get('/friend/list')).json()) as Envelope<FriendRow[]>;
    expect(after.code).toBe(200);
    const entry = after.data.find((f) => f.id === B.userId);
    expect(entry === undefined || entry.deleted === true).toBe(true);
    // No active (deleted:false) friendship with B survives the delete.
    expect(after.data.some((f) => f.id === B.userId && f.deleted === false)).toBe(false);
  } finally {
    await ctx.dispose();
  }
});
