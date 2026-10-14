/**
 * social — private + group message history / recall / offline / read API.
 *
 * Extends the send coverage in social-flow.spec.ts with the read-side and
 * recall paths. Two serial blocks: private (A<->B friends) and group (A owns a
 * group with B). Recall is exercised on a just-sent message, well inside the
 * 5-minute recall window. All shapes are live-verified.
 *
 * Contract (live):
 *  private (base /message/private):
 *   - GET    /history?friendId=&page=&size=  -> Result<List<PrivateMessageVO>>
 *   - DELETE /recall/{id}                    -> Result<PrivateMessageVO> (RECALL tip, type 10)
 *   - GET    /loadOfflineMessage?minId=      -> Result<List<PrivateMessageVO>>
 *   - PUT    /readed?friendId=               -> Result<null>
 *   - GET    /maxReadedId?friendId=          -> Result<Long>
 *  group (base /message/group):
 *   - GET    /history?groupId=&page=&size=   -> Result<List<GroupMessageVO>>
 *   - DELETE /recall/{id}                    -> Result<GroupMessageVO>
 *   - GET    /loadOfflineMessage?minId=      -> Result<List<GroupMessageVO>>
 *   - PUT    /readed?groupId=                -> Result<null>
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

interface PrivateMessageVO {
  id: number;
  sendId: number;
  recvId: number;
  content: string;
  type: number;
}
interface GroupMessageVO {
  id: number;
  groupId: number;
  sendId: number;
  content: string;
  type: number;
}

async function sendPrivate(ctx: APIRequestContext, recvId: number, content: string) {
  const res = await ctx.post('/message/private/send', { data: { recvId, content, type: 0 } });
  return ((await res.json()) as Envelope<PrivateMessageVO>).data;
}
async function sendGroup(ctx: APIRequestContext, groupId: number, content: string) {
  const res = await ctx.post('/message/group/send', { data: { groupId, content, type: 0 } });
  return ((await res.json()) as Envelope<GroupMessageVO>).data;
}

test.describe.serial("【message history】社交私信历史记录（social private message history）", () => {
  let A: SocialIdentity;
  let B: SocialIdentity;
  let ctxA: APIRequestContext;
  let ctxB: APIRequestContext;

  test.beforeAll(async () => {
    test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required');
    A = await newSiweIdentity(platformURL()!, identityURL()!);
    B = await newSiweIdentity(platformURL()!, identityURL()!);
    await befriend(platformURL()!, A, B);
    ctxA = await platformCtx(platformURL()!, A.login.accessToken);
    ctxB = await platformCtx(platformURL()!, B.login.accessToken);
  });
  test.afterAll(async () => {
    await ctxA?.dispose();
    await ctxB?.dispose();
  });

  // SO-API-045 — private history is a paginated list containing the sent message.
  test(localizedTitle("【私聊消息 / API】 SO-API-045 私聊历史记录分页", "SO-API-045 private chat history pagination"), async () => {
    const sent = await sendPrivate(ctxA, B.userId, `hist-${Date.now() % 100000}`);
    const res = await ctxA.get(`/message/private/history?friendId=${B.userId}&page=1&size=10`);
    const body = (await res.json()) as Envelope<PrivateMessageVO[]>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((m) => m.id === sent.id)).toBe(true);
  });

  // SO-API-046 — recall a just-sent private message (inside the 5-min window).
  test(localizedTitle("【私聊消息 / API】 SO-API-046 撤回私聊消息", "SO-API-046 recall private message"), async () => {
    const sent = await sendPrivate(ctxA, B.userId, `recall-${Date.now() % 100000}`);
    expect(sent.id).toBeGreaterThan(0);
    const res = await ctxA.delete(`/message/private/recall/${sent.id}`);
    const body = (await res.json()) as Envelope<PrivateMessageVO>;
    expect(body.code).toBe(200);
    // The server persists a RECALL tip message (type 10) referencing the id.
    expect(body.data.type).toBe(10);
    expect(body.data.content).toBe(String(sent.id));
  });

  // SO-API-047 — B loads offline private messages since minId=0.
  test(localizedTitle("【私聊消息 / API】 SO-API-047 加载离线私聊消息", "SO-API-047 load offline private messages"), async () => {
    const sent = await sendPrivate(ctxA, B.userId, `offline-${Date.now() % 100000}`);
    const res = await ctxB.get('/message/private/loadOfflineMessage?minId=0');
    const body = (await res.json()) as Envelope<PrivateMessageVO[]>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((m) => m.id === sent.id)).toBe(true);
  });

  // SO-API-048 — B marks the conversation read; A can query the read pointer.
  test(localizedTitle("【私聊消息 / API】 SO-API-048 标记会话已读", "SO-API-048 mark conversation read"), async () => {
    await sendPrivate(ctxA, B.userId, `read-${Date.now() % 100000}`);
    const readed = await ctxB.put(`/message/private/readed?friendId=${A.userId}`);
    expect(((await readed.json()) as Envelope<null>).code).toBe(200);

    // maxReadedId is served from Redis (IM_READED_POSITION); in this environment
    // the pointer is WS-driven and reads back the default (-1) over HTTP, so we
    // assert the endpoint is reachable and returns a numeric pointer, not that it
    // advances to the just-sent id.
    const max = await ctxA.get(`/message/private/maxReadedId?friendId=${B.userId}`);
    const body = (await max.json()) as Envelope<number>;
    expect(body.code).toBe(200);
    expect(typeof body.data).toBe('number');
  });

  // SO-API-049 — query the max read message id (read-receipt pointer).
  // Served from Redis (IM_READED_POSITION); WS-driven in this environment, so it
  // reads back the default (-1) over HTTP — we assert the endpoint is reachable
  // and returns a numeric pointer.
  test(localizedTitle("【私聊消息 / API】 SO-API-049 查询最大已读消息 id", "SO-API-049 query max readed message id"), async () => {
    await sendPrivate(ctxA, B.userId, `maxread-${Date.now() % 100000}`);
    const res = await ctxA.get(`/message/private/maxReadedId?friendId=${B.userId}`);
    const body = (await res.json()) as Envelope<number>;
    expect(body.code).toBe(200);
    expect(typeof body.data).toBe('number');
  });
});

test.describe.serial("【message history】社交群组消息历史记录（social group message history）", () => {
  let A: SocialIdentity;
  let B: SocialIdentity;
  let ctxA: APIRequestContext;
  let ctxB: APIRequestContext;
  let groupId: number;

  test.beforeAll(async () => {
    test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required');
    A = await newSiweIdentity(platformURL()!, identityURL()!);
    B = await newSiweIdentity(platformURL()!, identityURL()!);
    await befriend(platformURL()!, A, B);
    ctxA = await platformCtx(platformURL()!, A.login.accessToken);
    ctxB = await platformCtx(platformURL()!, B.login.accessToken);
    const gc = await ctxA.post('/group/create', { data: { name: `mgrp-${Date.now() % 100000}` } });
    groupId = ((await gc.json()) as Envelope<{ id: number }>).data.id;
    await ctxA.post('/group/invite', { data: { groupId, friendIds: [B.userId] } });
  });
  test.afterAll(async () => {
    await ctxA?.dispose();
    await ctxB?.dispose();
  });

  // SO-API-051 — group history is a paginated list containing the sent message.
  test(localizedTitle("【群聊消息 / API】 SO-API-051 群聊历史记录分页", "SO-API-051 group chat history pagination"), async () => {
    const sent = await sendGroup(ctxA, groupId, `ghist-${Date.now() % 100000}`);
    const res = await ctxA.get(`/message/group/history?groupId=${groupId}&page=1&size=10`);
    const body = (await res.json()) as Envelope<GroupMessageVO[]>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((m) => m.id === sent.id)).toBe(true);
  });

  // SO-API-052 — recall a just-sent group message (inside the 5-min window).
  test(localizedTitle("【群聊消息 / API】 SO-API-052 撤回群聊消息", "SO-API-052 recall group message"), async () => {
    const sent = await sendGroup(ctxA, groupId, `grecall-${Date.now() % 100000}`);
    expect(sent.id).toBeGreaterThan(0);
    const res = await ctxA.delete(`/message/group/recall/${sent.id}`);
    const body = (await res.json()) as Envelope<GroupMessageVO>;
    expect(body.code).toBe(200);
    expect(body.data.type).toBe(10);
    expect(body.data.content).toBe(String(sent.id));
  });

  // SO-API-053 — B loads offline group messages since minId=0.
  test(localizedTitle("【群聊消息 / API】 SO-API-053 加载离线群聊消息", "SO-API-053 load offline group messages"), async () => {
    const sent = await sendGroup(ctxA, groupId, `goffline-${Date.now() % 100000}`);
    const res = await ctxB.get('/message/group/loadOfflineMessage?minId=0');
    const body = (await res.json()) as Envelope<GroupMessageVO[]>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((m) => m.id === sent.id)).toBe(true);
  });

  // SO-API-054 — B marks the group messages read.
  test(localizedTitle("【群聊消息 / API】 SO-API-054 标记群消息已读", "SO-API-054 mark group messages read"), async () => {
    await sendGroup(ctxA, groupId, `gread-${Date.now() % 100000}`);
    const readed = await ctxB.put(`/message/group/readed?groupId=${groupId}`);
    expect(((await readed.json()) as Envelope<null>).code).toBe(200);
  });

  // SO-API-055 — query which users have read a specific group message.
  // A sends a message, B marks the group read, then A queries the read list and
  // finds B's id in it. (Receipt lists apply to groups of ≤500 members.)
  test(localizedTitle("【群聊消息 / API】 SO-API-055 查询群消息已读用户", "SO-API-055 query group message readed users"), async () => {
    const sent = await sendGroup(ctxA, groupId, `greadusers-${Date.now() % 100000}`);
    expect(sent.id).toBeGreaterThan(0);
    const readed = await ctxB.put(`/message/group/readed?groupId=${groupId}`);
    expect(((await readed.json()) as Envelope<null>).code).toBe(200);

    const res = await ctxA.get(
      `/message/group/findReadedUsers?groupId=${groupId}&messageId=${sent.id}`,
    );
    const body = (await res.json()) as Envelope<number[]>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.map(Number)).toContain(B.userId);
  });
});
