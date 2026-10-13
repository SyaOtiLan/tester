/**
 * project — messages/dialogs & work reports (P1 API).
 *
 * Covers PJ-103, PJ-104, PJ-108, PJ-109.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost, type RegisteredUser } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【messages reports】项目消息和报告 (P1 API)（project messages & reports (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
  });

  // PJ-103 获取对话列表
  test("【消息与对话 / API】 PJ-103 获取对话列表", async () => {
    const body = await apiGet(baseURL!, '/api/dialog/lists', user.token);
    expect(body.ret).toBe(1);
    expect(body.data).toHaveProperty('data');
    expect(Array.isArray(body.data.data)).toBe(true);
  });

  // PJ-104 发送文本消息
  test("【消息与对话 / API】 PJ-104 发送文本消息", async () => {
    // Open (auto-create) a 1-on-1 dialog to obtain a valid dialog_id.
    const open = await apiGet(baseURL!, `/api/dialog/open/user?userid=${user.userid}`, user.token);
    expect(open.ret).toBe(1);
    const dialogId = Number(open.data.id);
    expect(dialogId).toBeGreaterThan(0);

    const send = await apiPost(
      baseURL!,
      '/api/dialog/msg/sendtext',
      { dialog_id: dialogId, text: `hello ${Date.now()}` },
      user.token,
    );
    expect(send.ret).toBe(1);
    expect(send.msg).toBe('发送成功');
    expect(Number(send.data.dialog_id)).toBe(dialogId);
  });

  // PJ-108 保存并发送工作汇报
  test("【工作汇报 / API】 PJ-108 保存并发送工作汇报", async () => {
    const body = await apiPost(
      baseURL!,
      '/api/report/store',
      { title: `周报${Date.now() % 100000}`, type: 'weekly', content: '<p>本周完成了 e2e 测试</p>' },
      user.token,
    );
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('保存成功');
    expect(body.data.type).toBe('weekly');
    expect(Number(body.data.id)).toBeGreaterThan(0);
  });

  // PJ-109 我发送/我接收的汇报列表
  test("【工作汇报 / API】 PJ-109 我发送/我接收的汇报列表", async () => {
    // Ensure at least one sent report exists.
    await apiPost(
      baseURL!,
      '/api/report/store',
      { title: `日报${Date.now() % 100000}`, type: 'daily', content: '<p>今日进展</p>' },
      user.token,
    );

    const mine = await apiGet(baseURL!, '/api/report/my', user.token);
    expect(mine.ret).toBe(1);
    expect(Array.isArray(mine.data?.data)).toBe(true);
    expect(mine.data.data.length).toBeGreaterThan(0);

    const received = await apiGet(baseURL!, '/api/report/receive', user.token);
    expect(received.ret).toBe(1);
    expect(received.data).toHaveProperty('data');
  });
});
