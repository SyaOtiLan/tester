/**
 * social — group management API (platform, 8888).
 *
 * Extends the create/invite coverage in social-flow.spec.ts with the group
 * read + admin mutations. Runs serially over one shared group owned by A with
 * members B and C (all SIWE users), reading it first, then exercising the
 * destructive paths (remove member -> member quit -> owner dissolve) in order.
 *
 * Contract (live):
 *  - GET    /group/list                 -> Result<List<GroupVO>>
 *  - GET    /group/find/{groupId}       -> Result<GroupVO>
 *  - PUT    /group/modify (GroupVO)     -> Result<GroupVO> (name @NotEmpty)
 *  - GET    /group/members/{groupId}    -> Result<List<GroupMemberVO>> (includes quit members)
 *  - DELETE /group/members/remove (GroupMemberRemoveDTO {groupId, userIds:[]})
 *      SOFT remove — GroupMemberServiceImpl.removeByGroupAndUserIds sets quit=true;
 *      findGroupMembers returns all rows, so the removed member stays flagged quit:true.
 *  - DELETE /group/quit/{groupId}       -> Result<null> (leaves; entry flagged quit)
 *  - DELETE /group/delete/{groupId}     -> Result<null> (owner dissolves)
 *
 * Env:
 *  - SOCIAL_BASE_URL      platform backend (8888)
 *  - SOCIAL_IDENTITY_URL  web3-identity (8901)
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import {
  newSiweIdentity,
  platformCtx,
  befriend,
  type SocialIdentity,
  type Envelope,
} from '../helpers/auth';
import type { APIRequestContext } from '@playwright/test';

const platformURL = () => baseURLFor('social');
const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

interface GroupVO {
  id: number;
  name: string;
  ownerId: number;
  notice: string;
  quit: boolean;
}

test.describe.serial("【群组管理】社会团体管理（social group management）", () => {
  let A: SocialIdentity;
  let B: SocialIdentity;
  let C: SocialIdentity;
  let ctxA: APIRequestContext;
  let ctxB: APIRequestContext;
  let groupId: number;

  test.beforeAll(async () => {
    test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required');
    A = await newSiweIdentity(platformURL()!, identityURL()!);
    B = await newSiweIdentity(platformURL()!, identityURL()!);
    C = await newSiweIdentity(platformURL()!, identityURL()!);
    await befriend(platformURL()!, A, B);
    await befriend(platformURL()!, A, C);
    ctxA = await platformCtx(platformURL()!, A.login.accessToken);
    ctxB = await platformCtx(platformURL()!, B.login.accessToken);

    const gc = await ctxA.post('/group/create', { data: { name: `grp-${Date.now() % 100000}` } });
    const gcBody = (await gc.json()) as Envelope<GroupVO>;
    expect(gcBody.code).toBe(200);
    groupId = gcBody.data.id;
    const inv = await ctxA.post('/group/invite', { data: { groupId, friendIds: [B.userId, C.userId] } });
    expect(((await inv.json()) as Envelope<null>).code).toBe(200);
  });

  test.afterAll(async () => {
    await ctxA?.dispose();
    await ctxB?.dispose();
  });

  // SO-API-035 — my groups list contains the group I own.
  test(localizedTitle("【群组管理 / API】 SO-API-035 我的群组列表", "SO-API-035 my groups list"), async () => {
    const res = await ctxA.get('/group/list');
    const body = (await res.json()) as Envelope<GroupVO[]>;
    expect(body.code).toBe(200);
    expect(body.data.some((g) => g.id === groupId)).toBe(true);
  });

  // SO-API-036 — group detail.
  test(localizedTitle("【群组管理 / API】 SO-API-036 查询群组详情", "SO-API-036 group detail"), async () => {
    const res = await ctxA.get(`/group/find/${groupId}`);
    const body = (await res.json()) as Envelope<GroupVO>;
    expect(body.code).toBe(200);
    expect(body.data.id).toBe(groupId);
    expect(body.data.ownerId).toBe(A.userId);
  });

  // SO-API-037 — modify group name + notice; the change persists.
  test(localizedTitle("【群组管理 / API】 SO-API-037 修改群组信息", "SO-API-037 modify group info"), async () => {
    const cur = ((await (await ctxA.get(`/group/find/${groupId}`)).json()) as Envelope<GroupVO>).data;
    const newName = `grp-mod-${Date.now() % 100000}`;
    const newNotice = `notice-${Date.now() % 1000000}`;
    const mod = await ctxA.put('/group/modify', { data: { ...cur, name: newName, notice: newNotice } });
    expect(((await mod.json()) as Envelope<GroupVO>).code).toBe(200);

    const after = ((await (await ctxA.get(`/group/find/${groupId}`)).json()) as Envelope<GroupVO>).data;
    expect(after.name).toBe(newName);
    expect(after.notice).toBe(newNotice);
  });

  // SO-API-039 — group members list includes owner + both invitees.
  test(localizedTitle("【群组管理 / API】 SO-API-039 群成员列表", "SO-API-039 group members list"), async () => {
    const res = await ctxA.get(`/group/members/${groupId}`);
    const body = (await res.json()) as Envelope<Array<{ userId: number }>>;
    expect(body.code).toBe(200);
    const ids = body.data.map((m) => m.userId);
    expect(ids).toContain(A.userId);
    expect(ids).toContain(B.userId);
    expect(ids).toContain(C.userId);
  });

  // SO-API-040 — owner removes member C; C loses active membership (soft remove).
  test(localizedTitle("【群组管理 / API】 SO-API-040 移除群成员", "SO-API-040 remove group member"), async () => {
    const del = await ctxA.delete('/group/members/remove', {
      data: { groupId, userIds: [C.userId] },
    });
    expect(((await del.json()) as Envelope<null>).code).toBe(200);

    const members = (await (await ctxA.get(`/group/members/${groupId}`)).json()) as Envelope<
      Array<{ userId: number; quit: boolean }>
    >;
    expect(members.code).toBe(200);
    // Soft remove: C is either dropped or flagged quit=true — no longer active.
    const c = members.data.find((m) => m.userId === C.userId);
    expect(c === undefined || c.quit === true).toBe(true);
    // B is still an active (quit=false) member.
    expect(members.data.some((m) => m.userId === B.userId && m.quit === false)).toBe(true);
  });

  // SO-API-041 — member B leaves; B no longer holds an active membership.
  test(localizedTitle("【群组管理 / API】 SO-API-041 退出群组", "SO-API-041 leave group"), async () => {
    const quit = await ctxB.delete(`/group/quit/${groupId}`);
    expect(((await quit.json()) as Envelope<null>).code).toBe(200);

    const list = (await (await ctxB.get('/group/list')).json()) as Envelope<GroupVO[]>;
    expect(list.code).toBe(200);
    // A quit group is either dropped from the list or flagged quit=true — never
    // presented as an active (quit=false) membership.
    const active = list.data.find((g) => g.id === groupId && g.quit === false);
    expect(active).toBeUndefined();
  });

  // SO-API-042 — owner dissolves the group.
  test(localizedTitle("【群组管理 / API】 SO-API-042 解散群组", "SO-API-042 dissolve group"), async () => {
    const del = await ctxA.delete(`/group/delete/${groupId}`);
    expect(((await del.json()) as Envelope<null>).code).toBe(200);

    const list = (await (await ctxA.get('/group/list')).json()) as Envelope<GroupVO[]>;
    const active = list.data.find((g) => g.id === groupId && g.quit === false);
    expect(active).toBeUndefined();
  });
});

// SO-API-043 (P2) — toggle the per-group do-not-disturb flag; it round-trips
// through /group/find (GroupVO.isDnd). Standalone (own group) so it doesn't
// depend on the serial block's destructive ordering.
test(localizedTitle("【群组管理 / API】 SO-API-043 群免打扰开关", "SO-API-043 group do-not-disturb toggle"), async () => {
  test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required');
  const owner = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctx = await platformCtx(platformURL()!, owner.login.accessToken);
  try {
    const gc = await ctx.post('/group/create', { data: { name: `dnd-${Date.now() % 100000}` } });
    const groupId = ((await gc.json()) as Envelope<GroupVO>).data.id;

    const readDnd = async () =>
      ((await (await ctx.get(`/group/find/${groupId}`)).json()) as Envelope<{ isDnd: boolean }>).data
        .isDnd;

    const on = await ctx.put('/group/dnd', { data: { groupId, isDnd: 1 } });
    expect(((await on.json()) as Envelope<null>).code).toBe(200);
    expect(await readDnd()).toBe(true);

    const off = await ctx.put('/group/dnd', { data: { groupId, isDnd: 0 } });
    expect(((await off.json()) as Envelope<null>).code).toBe(200);
    expect(await readDnd()).toBe(false);
  } finally {
    await ctx.dispose();
  }
});
