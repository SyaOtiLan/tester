/**
 * project — personal profile & password (P1 API).
 *
 * Covers PJ-113, PJ-114, PJ-115.
 *
 * Each test registers its own throwaway account; PJ-114 mutates the password so
 * it must not share an account with the others.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, loginPassword, apiGet, apiPost } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【个人设置与账号安全】项目个人资料与密码（P1 API）（project profile & password (P1 API)）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-113 修改个人资料(昵称校验)
  test("【个人设置与账号安全 / API】 PJ-113 修改个人资料(昵称校验)", async () => {
    const user = await registerUser(baseURL!);

    const ok = await apiPost(baseURL!, '/api/users/editdata', { nickname: '测试昵称' }, user.token);
    expect(ok.ret).toBe(1);
    expect(ok.msg).toBe('修改成功');
    expect(ok.data.nickname).toBe('测试昵称');

    const tooShort = await apiPost(baseURL!, '/api/users/editdata', { nickname: 'x' }, user.token);
    expect(tooShort.ret).toBe(0);
    expect(tooShort.msg).toBe('昵称不可以少于2个字');

    const tooLong = await apiPost(baseURL!, '/api/users/editdata', { nickname: '长'.repeat(21) }, user.token);
    expect(tooLong.ret).toBe(0);
    expect(tooLong.msg).toBe('昵称最多只能设置20个字');
  });

  // PJ-114 修改密码成功并使旧 token 失效
  test("【个人设置与账号安全 / API】 PJ-114 修改密码成功并使旧 token 失效", async () => {
    const user = await registerUser(baseURL!);
    const newPass = 'NewPass123456';

    const body = await apiPost(baseURL!, '/api/users/editpass', { oldpass: user.password, newpass: newPass }, user.token);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('修改成功');

    // Old token is now invalid.
    const oldTokenCheck = await apiGet(baseURL!, '/api/users/info', user.token);
    expect(oldTokenCheck.ret).toBe(-1);

    // New password logs in.
    const relogin = await loginPassword(baseURL!, user.email, newPass);
    expect(relogin.ret).toBe(1);
    expect(typeof relogin.data.token).toBe('string');
  });

  // PJ-115 旧密码错误/新旧一致被拒
  test("【个人设置与账号安全 / API】 PJ-115 旧密码错误/新旧一致被拒", async () => {
    const user = await registerUser(baseURL!);

    const same = await apiPost(baseURL!, '/api/users/editpass', { oldpass: user.password, newpass: user.password }, user.token);
    expect(same.ret).toBe(0);
    expect(same.msg).toBe('新旧密码一致');

    const wrongOld = await apiPost(baseURL!, '/api/users/editpass', { oldpass: 'WrongOld123', newpass: 'BrandNew123' }, user.token);
    expect(wrongOld.ret).toBe(0);
    expect(wrongOld.msg).toBe('请填写正确的旧密码');
  });
});
