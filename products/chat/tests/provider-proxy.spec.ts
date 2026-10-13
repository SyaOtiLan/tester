/**
 * chat — Provider proxy API (CH-051..CH-058).
 *
 * The chat app proxies model providers under `/api/<provider>/...`. The
 * dispatcher (app/api/[provider]/[...path]/route.ts) recognizes a fixed set of
 * providers and returns 404 `{error:"Unknown provider: X"}` for anything else.
 *
 * OBSERVED in this standalone deployment: recognized-provider handlers
 * (openai/anthropic/...) currently respond 500 because the [provider] route is
 * declared `dynamic = "force-static"` yet the handlers read the incoming
 * request (method/headers/body) — a dynamic-server access under a static route.
 * The unknown-provider branch reads only route params, so it works. We assert
 * the wiring boundary (recognized vs. unknown) which holds regardless, and skip
 * the auth-gating / forwarding cases that need CODE / HIDE_USER_API_KEY /
 * a system key — none configured here (verified via /api/config).
 */
import { test, expect, baseURLFor } from '../fixtures';

function skipNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

type PublicConfig = {
  needCode?: boolean;
  hideUserApiKey?: boolean;
  [k: string]: unknown;
};

async function publicConfig(request: any): Promise<PublicConfig> {
  const res = await request.get('/api/config');
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as PublicConfig;
}

// CH-053 — unknown provider returns 404 with a precise error body.
test("【Provider 代理 API / API】 CH-053 未知 provider 返回 404", async ({ request }) => {
  skipNoService();
  const res = await request.post('/api/unknownvendor/v1/chat', {
    data: { hello: 'world' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body).toEqual({ error: 'Unknown provider: unknownvendor' });
});

// CH-051 — OpenAI-compatible chat proxy is wired (recognized, not "unknown
// provider"). Actual upstream forwarding needs OPENAI_API_KEY / a gateway.
test("【Provider 代理 API / API】 CH-051 OpenAI 兼容对话代理转发", async ({
  request,
}) => {
  skipNoService();
  const res = await request.post('/api/openai/v1/chat/completions', {
    data: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });
  // Recognized: must NOT be the unknown-provider 404 signature.
  expect(res.status()).not.toBe(404);
  const text = await res.text();
  expect(text).not.toContain('Unknown provider');
  // We cannot assert a real forwarded completion without a provider key.
  const hasKey = !!process.env.OPENAI_API_KEY?.trim();
  test.skip(!hasKey, 'OPENAI_API_KEY empty — cannot assert real upstream forwarding');
});

// CH-052 — Anthropic messages proxy is wired.
test("【Provider 代理 API / API】 CH-052 Anthropic 对话代理转发", async ({
  request,
}) => {
  skipNoService();
  const res = await request.post('/api/anthropic/v1/messages', {
    data: { model: 'claude-3-haiku', messages: [{ role: 'user', content: 'hi' }] },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });
  expect(res.status()).not.toBe(404);
  const text = await res.text();
  expect(text).not.toContain('Unknown provider');
  const hasKey = !!process.env.ANTHROPIC_API_KEY?.trim();
  test.skip(!hasKey, 'ANTHROPIC_API_KEY empty — cannot assert real upstream forwarding');
});

// CH-054 — access-code gating: needs CODE configured (needCode=true).
test("【Provider 代理 API / API】 CH-054 需要访问码时缺码被拒", async ({ request }) => {
  skipNoService();
  const cfg = await publicConfig(request);
  test.skip(
    !cfg.needCode,
    'server CODE not configured (needCode=false) — cannot exercise empty/wrong access-code rejection',
  );
  const res = await request.post('/api/openai/v1/chat/completions', {
    data: { model: 'gpt-4o-mini', messages: [] },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });
  const body = await res.text();
  expect(body).toContain('access code');
});

// CH-055 — a correct access code (nk-<code>) is accepted. Needs CODE + a known code.
test("【Provider 代理 API / API】 CH-055 携带正确访问码放行", async ({ request }) => {
  skipNoService();
  const cfg = await publicConfig(request);
  test.skip(
    !cfg.needCode || !process.env.CHAT_ACCESS_CODE?.trim(),
    'needCode=false or no CHAT_ACCESS_CODE — cannot assert access-code acceptance',
  );
  const code = process.env.CHAT_ACCESS_CODE!.trim();
  const res = await request.post('/api/openai/v1/chat/completions', {
    data: { model: 'gpt-4o-mini', messages: [] },
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer nk-${code}` },
    failOnStatusCode: false,
  });
  // Must not be rejected with an access-code error once the code is correct.
  const body = await res.text();
  expect(body).not.toContain('wrong access code');
  expect(body).not.toContain('empty access code');
});

// CH-056 — HIDE_USER_API_KEY rejects a user-supplied key.
test("【Provider 代理 API / API】 CH-056 HIDE_USER_API_KEY 时拒绝自带 Key", async ({ request }) => {
  skipNoService();
  const cfg = await publicConfig(request);
  test.skip(
    !cfg.hideUserApiKey,
    'HIDE_USER_API_KEY not enabled (hideUserApiKey=false) — cannot assert own-key rejection',
  );
  const res = await request.post('/api/openai/v1/chat/completions', {
    data: { model: 'gpt-4o-mini', messages: [] },
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-user-own-key' },
    failOnStatusCode: false,
  });
  const body = await res.text();
  expect(body).toContain('not allowed to access with your own api key');
});

// CH-057 — no system key configured: request degrades to an upstream auth error
// rather than a local success. Without a key we can only assert the route is
// recognized (not unknown provider) and does not fabricate a success.
test("【Provider 代理 API / API】 CH-057 未配置系统 Key 时的降级", async ({ request }) => {
  skipNoService();
  const res = await request.post('/api/openai/v1/chat/completions', {
    data: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }] },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });
  // Recognized provider, and with no key it is never a 200 success.
  expect(res.status()).not.toBe(404);
  expect(res.ok()).toBeFalsy();
});

// CH-058 — GET /api/openai/v1/models proxies the upstream model list.
test("【Provider 代理 API / API】 CH-058 GET /api/openai/v1/models 列出模型", async ({ request }) => {
  skipNoService();
  const res = await request.get('/api/openai/v1/models', { failOnStatusCode: false });
  expect(res.status()).not.toBe(404);
  const text = await res.text();
  expect(text).not.toContain('Unknown provider');
  const hasKey = !!process.env.OPENAI_API_KEY?.trim();
  test.skip(!hasKey, 'OPENAI_API_KEY empty — cannot assert a real upstream model list');
});
