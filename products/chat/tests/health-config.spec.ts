/**
 * chat — health & runtime config probes (CH-004, CH-005, CH-006).
 *
 * Pure API-level tests against the Next.js route handlers; no login or model
 * needed. All skip cleanly when CHAT_BASE_URL is not configured.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';

function skipIfNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

// CH-004 — liveness probe.
test(localizedTitle("【健康检查与冒烟 / API】 CH-004 存活探针 /health/live 返回 ok", "CH-004 /health/live returns ok with no-store"), async ({ request }) => {
  skipIfNoService();
  const res = await request.get('/health/live');
  expect(res.status()).toBe(200);
  expect((res.headers()['cache-control'] || '').toLowerCase()).toContain('no-store');
  const body = await res.json();
  expect(body).toMatchObject({ status: 'ok', service: 'chat' });
});

// CH-005 — readiness probe reports a version string.
test(localizedTitle("【健康检查与冒烟 / API】 CH-005 就绪探针 /health/ready 返回版本", "CH-005 /health/ready returns version"), async ({ request }) => {
  skipIfNoService();
  const res = await request.get('/health/ready');
  expect(res.status()).toBe(200);
  expect((res.headers()['cache-control'] || '').toLowerCase()).toContain('no-store');
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.service).toBe('chat');
  // BUILD_VERSION when set, else the literal "unknown"; always a non-empty string.
  expect(typeof body.version).toBe('string');
  expect(body.version.length).toBeGreaterThan(0);
});

// CH-006 — runtime public config, GET and POST, no private key leakage.
test(localizedTitle("【健康检查与冒烟 / API】 CH-006 运行时公开配置下发 /api/config", "CH-006 /api/config exposes public runtime fields (GET & POST)"), async ({ request }) => {
  skipIfNoService();
  for (const method of ['get', 'post'] as const) {
    const res = method === 'get' ? await request.get('/api/config') : await request.post('/api/config');
    expect(res.status()).toBe(200);
    expect((res.headers()['cache-control'] || '').toLowerCase()).toContain('no-store');
    const body = await res.json();
    // Documented public fields must be present.
    for (const key of [
      'needCode',
      'hideUserApiKey',
      'disableFastLink',
      'defaultModel',
      'ucanLoginForceMode',
      'routerPortalUrl',
    ]) {
      expect(body, `missing public field ${key}`).toHaveProperty(key);
    }
    expect(typeof body.needCode).toBe('boolean');
    expect(['auto', 'wallet', 'central']).toContain(body.ucanLoginForceMode);
    // Must NOT leak private server secrets in cleartext.
    for (const secret of ['openaiApiKey', 'anthropicApiKey', 'accessCode', 'apiKey']) {
      expect(body, `unexpected private field ${secret}`).not.toHaveProperty(secret);
    }
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
  }
});
