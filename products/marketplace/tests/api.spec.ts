/**
 * marketplace — optional static-URL smoke + disk-fallback (MP-API-002 .. 004).
 *
 * MARKETPLACE_BASE_URL is unset in this environment: the HTTP-fetch variants
 * (002/003) skip, and the disk-fallback path (004) is exercised for real.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, hasEnv } from '../fixtures';
import { readIndex, readPackages, readToolsPackages } from './helpers';

function baseURL(): string {
  return (process.env['MARKETPLACE_BASE_URL'] ?? '').replace(/\/$/, '');
}

test(localizedTitle("【可选静态 URL 与冒烟 / API】 MP-API-002 静态 URL GET /packages.json 可获取且为合法 JSON", "MP-API-002 static URL GET /packages.json is 2xx and grouped cn/en"), async ({ request }) => {
  test.skip(!hasEnv('MARKETPLACE_BASE_URL'), 'MARKETPLACE_BASE_URL unset — static-URL fetch N/A');
  const res = await request.get(`${baseURL()}/packages.json`);
  expect(res.status()).toBeGreaterThanOrEqual(200);
  expect(res.status()).toBeLessThan(300);
  const body = await res.json();
  expect(body).toHaveProperty('cn');
  expect(body).toHaveProperty('en');
});

test(localizedTitle("【可选静态 URL 与冒烟 / API】 MP-API-003 静态 URL GET /tools/packages.json 可获取", "MP-API-003 static URL GET /tools/packages.json is 2xx and an array"), async ({ request }) => {
  test.skip(!hasEnv('MARKETPLACE_BASE_URL'), 'MARKETPLACE_BASE_URL unset — static-URL fetch N/A');
  const res = await request.get(`${baseURL()}/tools/packages.json`);
  expect(res.status()).toBeGreaterThanOrEqual(200);
  expect(res.status()).toBeLessThan(300);
  expect(Array.isArray(await res.json())).toBe(true);
});

test(localizedTitle("【可选静态 URL 与冒烟 / API】 MP-API-004 未设置 BASE_URL 时回退磁盘读取", "MP-API-004 with BASE_URL unset, data cases fall back to disk with no side effects"), () => {
  // Precondition of this suite: static URL is not configured.
  expect(hasEnv('MARKETPLACE_BASE_URL')).toBe(false);
  // The disk-fallback path must produce real, usable data.
  const index = readIndex();
  expect(Array.isArray(index)).toBe(true);
  expect(index.length).toBeGreaterThan(0);
  const packages = readPackages();
  expect(packages).toHaveProperty('cn');
  expect(packages).toHaveProperty('en');
  const tools = readToolsPackages();
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBeGreaterThan(0);
});
