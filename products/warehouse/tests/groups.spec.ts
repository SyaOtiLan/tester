/**
 * warehouse — share groups (WH-API-069, WH-API-070).
 *
 *   - WH-API-069 分组增删改查: create a group → it appears in the list → rename
 *     it (PUT update) → the new name shows in the list → delete it (DELETE) →
 *     it is gone.
 *   - WH-API-070 分组成员管理与审批: add a member (by wallet address) to a group
 *     → it appears in the member list with status "pending" → remove it
 *     (DELETE) → it is gone.
 *
 *     审批 (approve/reject) is intentionally NOT exercised here: those endpoints
 *     only accept a peer-INITIATED join request (canRespond=true). An
 *     owner-added member has canRespond=false and approve/reject return 404 for
 *     it — there is no way to synthesize a second interactive peer joining in a
 *     headless API test, so approval is asserted only as far as the management
 *     surface (add/list/remove) that the owner actually controls.
 *
 * Groups work for any authenticated identity (no admin needed), so a fresh SIWE
 * wallet is used for full isolation. Requires WAREHOUSE_WEBDAV_URL.
 *
 * Source: web/src/api/index.ts groupApi — groups (GET list), groups/create
 * (POST {name}→{id,name}), groups/update (PUT {id,name}), groups/delete
 * (DELETE {id}); members (GET list), members/create (POST {groupId,target,
 * name,walletAddress}), members/delete (DELETE {id}).
 */
import { test, expect, envFor } from '../fixtures';
import { Wallet } from 'ethers';
import { loginWithWallet, authedRequest } from '../helpers/auth';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}

const G = '/api/v1/public/webdav/group';

interface ManagedGroup {
  id: string;
  name: string;
}
interface GroupMember {
  id: string;
  walletAddress: string;
  groupId: string;
  status?: string;
}

test("【分组管理 / API】 WH-API-069 分组增删改查", async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');

  const user = await loginWithWallet(apiBase()!, Wallet.createRandom().privateKey);
  const ctx = await authedRequest(apiBase()!, user.token);
  const stamp = Date.now();
  let groupId = '';
  try {
    // create
    const create = await ctx.post(`${G}/groups/create`, { data: { name: `e2e-grp-${stamp}` } });
    expect(create.status()).toBe(200);
    const group = (await create.json()) as ManagedGroup;
    expect(group.id).toBeTruthy();
    expect(group.name).toBe(`e2e-grp-${stamp}`);
    groupId = group.id;

    // list contains it
    const list1 = await ctx.get(`${G}/groups`);
    expect(list1.status()).toBe(200);
    const items1 = ((await list1.json()) as { items: ManagedGroup[] }).items;
    expect(items1.find((g) => g.id === groupId)).toBeTruthy();

    // rename (PUT)
    const rename = await ctx.fetch(`${G}/groups/update`, {
      method: 'PUT',
      data: { id: groupId, name: `e2e-grp-renamed-${stamp}` },
    });
    expect(rename.status()).toBe(200);

    // the new name is reflected
    const list2 = await ctx.get(`${G}/groups`);
    const renamed = ((await list2.json()) as { items: ManagedGroup[] }).items.find(
      (g) => g.id === groupId,
    );
    expect(renamed?.name).toBe(`e2e-grp-renamed-${stamp}`);

    // delete (DELETE)
    const del = await ctx.fetch(`${G}/groups/delete`, { method: 'DELETE', data: { id: groupId } });
    expect(del.status()).toBe(200);
    groupId = '';

    // it is gone
    const list3 = await ctx.get(`${G}/groups`);
    const gone = ((await list3.json()) as { items: ManagedGroup[] }).items.find(
      (g) => g.id === group.id,
    );
    expect(gone).toBeFalsy();
  } finally {
    if (groupId) {
      await ctx.fetch(`${G}/groups/delete`, { method: 'DELETE', data: { id: groupId } }).catch(() => undefined);
    }
    await ctx.dispose();
  }
});

test("【分组管理 / API】 WH-API-070 分组成员管理与审批", async () => {
  test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');

  const user = await loginWithWallet(apiBase()!, Wallet.createRandom().privateKey);
  const ctx = await authedRequest(apiBase()!, user.token);
  const stamp = Date.now();
  const memberWallet = Wallet.createRandom().address; // checksum; stored lowercase
  let groupId = '';
  try {
    const create = await ctx.post(`${G}/groups/create`, { data: { name: `e2e-mem-${stamp}` } });
    expect(create.status()).toBe(200);
    groupId = ((await create.json()) as ManagedGroup).id;

    // add a member by wallet address
    const add = await ctx.post(`${G}/members/create`, {
      data: {
        groupId,
        target: memberWallet,
        name: memberWallet,
        walletAddress: memberWallet,
      },
    });
    expect(add.status()).toBe(200);
    const member = (await add.json()) as GroupMember;
    expect(member.id).toBeTruthy();
    expect(member.walletAddress.toLowerCase()).toBe(memberWallet.toLowerCase());
    // owner-added members land in "pending" until they accept.
    expect(member.status).toBe('pending');

    // it shows up in the group's member list
    const list1 = await ctx.get(`${G}/members`);
    expect(list1.status()).toBe(200);
    const members = ((await list1.json()) as { items: GroupMember[] }).items;
    expect(members.find((m) => m.id === member.id)).toBeTruthy();

    // remove it
    const del = await ctx.fetch(`${G}/members/delete`, { method: 'DELETE', data: { id: member.id } });
    expect(del.status()).toBe(200);

    // it is gone from the list
    const list2 = await ctx.get(`${G}/members`);
    const stillThere = ((await list2.json()) as { items: GroupMember[] }).items.find(
      (m) => m.id === member.id,
    );
    expect(stillThere).toBeFalsy();
  } finally {
    if (groupId) {
      await ctx.fetch(`${G}/groups/delete`, { method: 'DELETE', data: { id: groupId } }).catch(() => undefined);
    }
    await ctx.dispose();
  }
});
