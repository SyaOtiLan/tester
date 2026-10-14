/**
 * project — automation access tokens (P1 API).
 *
 * Covers PJ-119, PJ-120, PJ-121, PJ-122.
 *
 * token/* endpoints are self-service (scoped to the caller) and reachable with a
 * normal registered-user token header. Creation requires at least one project the
 * user participates in and the `file_cabinet` scope.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';
import { registerUser, apiGet, apiPost, createProject, type RegisteredUser } from '../helpers/api';

const baseURL = baseURLFor('project');

async function createToken(token: string, projectId: number, name: string) {
  return apiPost(
    baseURL!,
    '/api/token/create',
    { name, project_ids: [projectId], scopes: ['file_cabinet'] },
    token,
  );
}

test.describe(localizedTitle("【自动化访问令牌】项目自动化代币 (P1 API)（project automation tokens (P1 API)）", "project automation tokens (P1 API)"), () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  let user: RegisteredUser;
  let projectId: number;
  test.beforeAll(async () => {
    if (!baseURL) return;
    user = await registerUser(baseURL);
    projectId = (await createProject(baseURL, user.token, { name: `令牌项目${Date.now() % 100000}` })).id;
  });

  // PJ-119 创建访问令牌返回密钥
  test(localizedTitle("【自动化访问令牌 / API】 PJ-119 创建访问令牌返回密钥", "PJ-119 token/create returns the access/secret key pair"), async () => {
    const body = await createToken(user.token, projectId, `tok-create-${Date.now() % 100000}`);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('创建成功');
    expect(typeof body.data.access_key).toBe('string');
    expect(body.data.access_key).toMatch(/^yyak_/);
    expect(typeof body.data.secret_key).toBe('string');
    expect(body.data.secret_key).toMatch(/^yysk_/);
  });

  // PJ-120 令牌列表
  test(localizedTitle("【自动化访问令牌 / API】 PJ-120 令牌列表", "PJ-120 token/lists returns the tokens with the secret masked"), async () => {
    const created = await createToken(user.token, projectId, `tok-list-${Date.now() % 100000}`);
    expect(created.ret).toBe(1);
    const id = Number(created.data.id);

    const body = await apiGet(baseURL!, '/api/token/lists', user.token);
    expect(body.ret).toBe(1);
    const list = body.data?.list ?? [];
    const found = list.find((t: any) => Number(t.id) === id);
    expect(found, 'created token not in list').toBeTruthy();
    // The plaintext secret is only returned at creation, never in the list.
    expect(found.secret_key).toBeUndefined();
  });

  // PJ-121 轮换令牌密钥
  test(localizedTitle("【自动化访问令牌 / API】 PJ-121 轮换令牌密钥", "PJ-121 token/rotate issues a new secret"), async () => {
    const created = await createToken(user.token, projectId, `tok-rotate-${Date.now() % 100000}`);
    expect(created.ret).toBe(1);
    const id = Number(created.data.id);
    const originalSecret = created.data.secret_key;

    const body = await apiPost(baseURL!, '/api/token/rotate', { id }, user.token);
    expect(body.ret).toBe(1);
    expect(body.msg).toBe('密钥轮换成功');
    expect(body.data.secret_key).toMatch(/^yysk_/);
    expect(body.data.secret_key).not.toBe(originalSecret);
  });

  // PJ-122 禁用/删除令牌
  test(localizedTitle("【自动化访问令牌 / API】 PJ-122 禁用/删除令牌", "PJ-122 token/disable then token/delete"), async () => {
    const created = await createToken(user.token, projectId, `tok-del-${Date.now() % 100000}`);
    expect(created.ret).toBe(1);
    const id = Number(created.data.id);

    const disabled = await apiPost(baseURL!, '/api/token/disable', { id }, user.token);
    expect(disabled.ret).toBe(1);
    expect(disabled.msg).toBe('禁用成功');

    const deleted = await apiPost(baseURL!, '/api/token/delete', { id }, user.token);
    expect(deleted.ret).toBe(1);
    expect(deleted.msg).toBe('删除成功');

    const list = await apiGet(baseURL!, '/api/token/lists', user.token);
    const stillThere = (list.data?.list ?? []).find((t: any) => Number(t.id) === id);
    expect(stillThere).toBeFalsy();
  });
});
