/**
 * project — groups, message read-state & UI message send (P2).
 *
 * Covers PJ-105 (message read / unread stats), PJ-106 (create a group + manage
 * its members), PJ-107 (send a message from the messenger UI).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost, withDeadlockRetry, type RegisteredUser } from '../helpers/api';
import { seedUiSession } from '../helpers/session';

const baseURL = baseURLFor('project');

test.describe("【消息与对话】项目组和消息 (P2)（project groups & messages (P2)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-106 新建群组与成员管理
  test("【消息与对话 / API】 PJ-106 新建群组与成员管理", async () => {
    const owner = await registerUser(baseURL!);
    const m1 = await registerUser(baseURL!);
    const m2 = await registerUser(baseURL!);

    const created = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/dialog/group/add', { chat_name: `群${Date.now() % 100000}`, userids: [m1.userid] }, owner.token),
    );
    expect(created.ret, `group/add failed: ${created.msg}`).toBe(1);
    expect(created.msg).toBe('创建成功');
    const gid = Number(created.data.id);
    expect(gid).toBeGreaterThan(0);

    const add = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/dialog/group/adduser', { dialog_id: gid, userids: [m2.userid] }, owner.token),
    );
    expect(add.ret, `group/adduser failed: ${add.msg}`).toBe(1);
    expect(add.msg).toBe('添加成功');

    const del = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/dialog/group/deluser', { dialog_id: gid, userids: [m2.userid] }, owner.token),
    );
    expect(del.ret, `group/deluser failed: ${del.msg}`).toBe(1);
    expect(del.msg).toBe('移出成功');
  });

  // PJ-105 消息已读/未读统计
  test("【消息与对话 / API】 PJ-105 消息已读/未读统计", async () => {
    const owner = await registerUser(baseURL!);
    const peer = await registerUser(baseURL!);
    const group = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/dialog/group/add', { chat_name: `读群${Date.now() % 100000}`, userids: [peer.userid] }, owner.token),
    );
    expect(group.ret, `group/add failed: ${group.msg}`).toBe(1);
    const gid = Number(group.data.id);

    // Peer posts a message into the group.
    const sent = await withDeadlockRetry(() =>
      apiPost(baseURL!, '/api/dialog/msg/sendtext', { dialog_id: gid, text: `unread-${Date.now()}` }, peer.token),
    );
    expect(sent.ret, `sendtext failed: ${sent.msg}`).toBe(1);
    const msgId = Number(sent.data.id);

    // The unread endpoint returns the dialog read-state summary.
    const unread = await apiGet(baseURL!, `/api/dialog/msg/unread?dialog_id=${gid}`, owner.token);
    expect(unread.ret).toBe(1);
    expect(unread.data).toHaveProperty('unread');
    expect(typeof unread.data.unread).toBe('number');

    // Marking the message read succeeds.
    const read = await apiPost(baseURL!, '/api/dialog/msg/read', { id: msgId }, owner.token);
    expect(read.ret, `msg/read failed: ${read.msg}`).toBe(1);
  });

  // PJ-107 UI 消息页发送消息
  test("【消息与对话 / E2E】 PJ-107 UI 消息页发送消息", async ({ page }) => {
    const acc = await seedUiSession(page, baseURL!);
    // Open a 1-on-1 dialog (the "file transfer" self dialog) to get a stable id.
    const open = await apiGet(baseURL!, `/api/dialog/open/user?userid=${acc.userid}`, acc.token);
    expect(open.ret).toBe(1);
    const dialogId = Number(open.data.id);

    await page.goto(`/#/manage/messenger?dialog_id=${dialogId}`, { waitUntil: 'domcontentloaded' });

    // The Quill-based composer mounts a contenteditable .ql-editor inside the
    // chat input wrapper; the send affordance is the .chat-send toolbar button.
    const editor = page.locator('.chat-input-wrapper .ql-editor').first();
    await editor.waitFor({ state: 'visible', timeout: 20_000 });

    const text = `ui-send-${Date.now()}`;
    await editor.click();
    await editor.type(text);
    await page.locator('.chat-send').first().click();

    // The just-sent message renders in the dialog window.
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 });
  });
});
