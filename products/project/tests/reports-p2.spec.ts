/**
 * project — work report edge cases (P2 API).
 *
 * Covers PJ-110 (mark a received report read + unread counter), PJ-111
 * (generate a report template).
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【工作汇报】项目报告（P2 API）（project reports (P2 API)）", "project reports (P2 API)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-111 生成汇报模板
  test(localizedTitle("【工作汇报 / API】 PJ-111 生成汇报模板", "PJ-111 report/template returns a pre-filled weekly template"), async () => {
    const user = await registerUser(baseURL!);
    const body = await apiGet(baseURL!, '/api/report/template?type=weekly', user.token);
    expect(body.ret).toBe(1);
    expect(body.data).toHaveProperty('time');
    expect(body.data).toHaveProperty('sign');
    expect(typeof body.data.content).toBe('string');
    expect(body.data.content.length).toBeGreaterThan(0);
    // The weekly template title is labelled as a 周报.
    expect(body.data.title).toContain('周报');
  });

  // PJ-110 汇报标记已读与未读数
  test(localizedTitle("【工作汇报 / API】 PJ-110 汇报标记已读与未读数", "PJ-110 report/unread counts a received report and report/read clears it"), async () => {
    const sender = await registerUser(baseURL!);
    const receiver = await registerUser(baseURL!);

    const stored = await apiPost(
      baseURL!,
      '/api/report/store',
      { title: `周报${Date.now() % 100000}`, type: 'weekly', content: '<p>本周完成 e2e</p>', receive: [receiver.userid] },
      sender.token,
    );
    expect(stored.ret, `report/store failed: ${stored.msg}`).toBe(1);
    expect(stored.msg).toBe('保存成功');

    // The receiver now has an unread report.
    const unread = await apiGet(baseURL!, '/api/report/unread', receiver.token);
    expect(unread.ret).toBe(1);
    expect(Number(unread.data.total)).toBeGreaterThan(0);

    // Fetch the received report id and mark it read.
    const received = await apiGet(baseURL!, '/api/report/receive', receiver.token);
    expect(received.ret).toBe(1);
    const rid = Number((received.data?.data ?? [])[0]?.id);
    expect(rid).toBeGreaterThan(0);

    const read = await apiPost(baseURL!, '/api/report/read', { ids: [rid] }, receiver.token);
    expect(read.ret, `report/read failed: ${read.msg}`).toBe(1);
  });
});
