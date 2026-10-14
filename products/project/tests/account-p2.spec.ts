/**
 * project — account security edge cases (P2 API).
 *
 * Covers PJ-116 (change e-mail — validation + success), PJ-117 (device list &
 * logout), PJ-118 (delete account).
 *
 * These endpoints rotate or destroy the caller's token, so each case runs on a
 * dedicated throwaway account.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe(localizedTitle("【个人设置与账号安全】项目账户安全（P2 API）（project account security (P2 API)）", "project account security (P2 API)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-116 修改邮箱发送验证
  test(localizedTitle("【个人设置与账号安全 / API】 PJ-116 修改邮箱发送验证", "PJ-116 email/send validates input and email/edit changes the address"), async () => {
    const user = await registerUser(baseURL!);

    // email/send validation branches (these return before any mail is dispatched,
    // so they are deterministic without a working SMTP channel).
    const noEmail = await apiPost(baseURL!, '/api/users/email/send', {}, user.token);
    expect(noEmail.ret).toBe(0);
    expect(noEmail.msg).toBe('请输入新邮箱地址');

    const badEmail = await apiPost(baseURL!, '/api/users/email/send', { email: 'not-an-email' }, user.token);
    expect(badEmail.ret).toBe(0);
    expect(badEmail.msg).toBe('邮箱地址错误');

    const sameEmail = await apiPost(baseURL!, '/api/users/email/send', { email: user.email, type: 2 }, user.token);
    expect(sameEmail.ret).toBe(0);
    expect(sameEmail.msg).toBe('不能与旧邮箱一致');

    // email/edit: reg_verify is off in this deployment, so no code is required;
    // the change succeeds and the backend rotates the token (old one invalidated).
    const newEmail = `e2e_ne${Date.now().toString(36).slice(-7)}@e2e.local`;
    const edited = await apiPost(baseURL!, '/api/users/email/edit', { newEmail }, user.token);
    expect(edited.ret, `email/edit failed: ${edited.msg}`).toBe(1);
    expect(edited.msg).toBe('修改成功');

    // The old token no longer authenticates (it was rotated by the edit).
    const stale = await apiGet(baseURL!, '/api/users/info', user.token);
    expect(stale.ret).toBe(-1);
  });

  // PJ-117 设备列表与登出设备
  test(localizedTitle("【个人设置与账号安全 / API】 PJ-117 设备列表与登出设备", "PJ-117 device/list returns sessions and device/logout validates ids"), async () => {
    const user = await registerUser(baseURL!);

    const list = await apiGet(baseURL!, '/api/users/device/list', user.token);
    expect(list.ret).toBe(1);
    expect(Array.isArray(list.data.list)).toBe(true);
    expect(list.data.list.length).toBeGreaterThan(0);
    const current = list.data.list[0];
    expect(current).toHaveProperty('id');
    expect(current).toHaveProperty('hash');

    // An empty id is a parameter error.
    const empty = await apiPost(baseURL!, '/api/users/device/logout', { id: '' }, user.token);
    expect(empty.ret).toBe(0);
    expect(empty.msg).toBe('参数错误');

    // A non-existent id reports the device is gone. (Run this before logging out
    // the current device, which would invalidate the token.)
    const missing = await apiPost(baseURL!, '/api/users/device/logout', { id: 999999999 }, user.token);
    expect(missing.ret).toBe(0);
    expect(missing.msg).toBe('设备不存在或已被删除');

    // Logging out the current device succeeds and invalidates this session.
    const out = await apiPost(baseURL!, '/api/users/device/logout', { id: current.id }, user.token);
    expect(out.ret, `device/logout failed: ${out.msg}`).toBe(1);
    expect(out.msg).toBe('操作成功');
  });

  // PJ-118 删除账号
  test(localizedTitle("【个人设置与账号安全 / API】 PJ-118 删除账号", "PJ-118 delete/account validates then removes the account"), async () => {
    const user = await registerUser(baseURL!);

    // A submit without type=confirm passes validation but does not delete.
    const warn = await apiPost(
      baseURL!,
      '/api/users/delete/account',
      { email: user.email, password: user.password },
      user.token,
    );
    expect(warn.ret).toBe(1);

    // A wrong password is rejected.
    const wrong = await apiPost(
      baseURL!,
      '/api/users/delete/account',
      { email: user.email, password: 'WrongPass000', type: 'confirm' },
      user.token,
    );
    expect(wrong.ret).toBe(0);
    expect(wrong.msg).toBe('密码错误');

    // Correct email + password + type=confirm deletes the account.
    const done = await apiPost(
      baseURL!,
      '/api/users/delete/account',
      { email: user.email, password: user.password, type: 'confirm', reason: 'e2e cleanup' },
      user.token,
    );
    expect(done.ret, `delete/account failed: ${done.msg}`).toBe(1);
    expect(done.msg).toBe('删除成功');
  });
});
