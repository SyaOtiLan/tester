/**
 * social — friend / group / private+group message API flow.
 *
 * Drives the full messaging graph as two wallet users (A, B) provisioned via
 * SIWE. Because the platform accepts SIWE-issued JWTs, the entire flow runs
 * over the platform API (8888) with the custom `accessToken` header.
 *
 * Runs serially: friendship must exist before invite / private messaging, so
 * the tests share state (A, B, groupId) built up in order.
 *
 * Env:
 *  - SOCIAL_BASE_URL      platform backend (8888)
 *  - SOCIAL_IDENTITY_URL  web3-identity (8901) — mints the two wallet users
 *
 * Contract (live):
 *  - GET  /friend/list                    -> List<FriendVO>
 *  - POST /friend/add?friendId=<id>       -> mutual bind (code:200)
 *  - POST /group/create {name}            -> GroupVO with new id, caller = owner
 *  - POST /group/invite {groupId,friendIds:[...]} — invitees must be friends
 *  - GET  /group/members/{groupId}        -> List<GroupMemberVO>
 *  - POST /message/private/send {recvId,content,type} — requires friendship
 *  - POST /message/group/send   {groupId,content,type}
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import {
  newSiweIdentity,
  platformCtx,
  type SocialIdentity,
  type Envelope,
} from '../helpers/auth';
import type { APIRequestContext } from '@playwright/test';

const platformURL = () => baseURLFor('social');
const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

test.describe.serial("【social flow】社交消息流（social messaging flow）", () => {
  let A: SocialIdentity;
  let B: SocialIdentity;
  let ctxA: APIRequestContext;
  let ctxB: APIRequestContext;
  let groupId: number;

  test.beforeAll(async () => {
    test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL not configured');
    A = await newSiweIdentity(platformURL()!, identityURL()!);
    B = await newSiweIdentity(platformURL()!, identityURL()!);
    ctxA = await platformCtx(platformURL()!, A.login.accessToken);
    ctxB = await platformCtx(platformURL()!, B.login.accessToken);
  });

  test.afterAll(async () => {
    await ctxA?.dispose();
    await ctxB?.dispose();
  });

  // SO-API-029 — friend list (empty for a brand-new user, but a valid array).
  test(localizedTitle("【好友与联系人 / API】 SO-API-029 好友列表", "SO-API-029 friend list"), async () => {
    const res = await ctxA.get('/friend/list');
    const body = (await res.json()) as Envelope<Array<{ id: number }>>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // SO-API-030 — add friend (mutual), then confirm B appears in A's list.
  test(localizedTitle("【好友与联系人 / API】 SO-API-030 添加好友", "SO-API-030 add friend"), async () => {
    const addAB = await ctxA.post(`/friend/add?friendId=${B.userId}`);
    expect(((await addAB.json()) as Envelope<null>).code).toBe(200);
    // Bind the reverse direction too so later messaging passes the isFriend gate.
    const addBA = await ctxB.post(`/friend/add?friendId=${A.userId}`);
    expect(((await addBA.json()) as Envelope<null>).code).toBe(200);

    const listRes = await ctxA.get('/friend/list');
    const list = (await listRes.json()) as Envelope<Array<{ id: number }>>;
    expect(list.code).toBe(200);
    expect(list.data.some((f) => f.id === B.userId)).toBe(true);
  });

  // SO-API-034 — create a group; caller becomes owner.
  test(localizedTitle("【群组管理 / API】 SO-API-034 创建群组", "SO-API-034 create group"), async () => {
    const res = await ctxA.post('/group/create', { data: { name: `e2e-grp-${Date.now() % 100000}` } });
    const body = (await res.json()) as Envelope<{ id: number; ownerId: number }>;
    expect(body.code).toBe(200);
    expect(body.data.id).toBeGreaterThan(0);
    expect(body.data.ownerId).toBe(A.userId);
    groupId = body.data.id;
  });

  // SO-API-038 — invite friend B into the group; members list updates.
  test(localizedTitle("【群组管理 / API】 SO-API-038 邀请好友入群", "SO-API-038 invite friend into group"), async () => {
    expect(groupId).toBeGreaterThan(0);
    const inv = await ctxA.post('/group/invite', { data: { groupId, friendIds: [B.userId] } });
    expect(((await inv.json()) as Envelope<null>).code).toBe(200);

    const membersRes = await ctxA.get(`/group/members/${groupId}`);
    const members = (await membersRes.json()) as Envelope<Array<{ userId: number }>>;
    expect(members.code).toBe(200);
    expect(members.data.some((m) => m.userId === B.userId)).toBe(true);
  });

  // SO-API-044 — send a private message A -> B.
  test(localizedTitle("【私聊消息 / API】 SO-API-044 发送私聊消息", "SO-API-044 send private message"), async () => {
    const res = await ctxA.post('/message/private/send', {
      data: { recvId: B.userId, content: 'hello from e2e', type: 0 },
    });
    const body = (await res.json()) as Envelope<{ id: number; recvId: number; content: string }>;
    expect(body.code).toBe(200);
    expect(body.data.id).toBeGreaterThan(0);
    expect(body.data.recvId).toBe(B.userId);
    expect(body.data.content).toBe('hello from e2e');
  });

  // SO-API-050 — send a group message into the shared group.
  test(localizedTitle("【群聊消息 / API】 SO-API-050 发送群聊消息", "SO-API-050 send group message"), async () => {
    expect(groupId).toBeGreaterThan(0);
    const res = await ctxA.post('/message/group/send', {
      data: { groupId, content: 'group hello from e2e', type: 0 },
    });
    const body = (await res.json()) as Envelope<{ id: number; groupId: number; content: string }>;
    expect(body.code).toBe(200);
    expect(body.data.id).toBeGreaterThan(0);
    expect(body.data.groupId).toBe(groupId);
    expect(body.data.content).toBe('group hello from e2e');
  });
});
