/**
 * chat — Export & share (CH-088..CH-092).
 *
 * Markdown/PNG export (CH-088/089) is reached from the exporter modal of an
 * ACTIVE chat session with messages. No text model is available here (empty
 * OPENAI/ANTHROPIC keys + unfunded Router), so a message-bearing session cannot
 * be produced and the exporter cannot be opened — those skip with a precise
 * reason.
 *
 * Artifacts share (CH-090/091) is a same-origin API backed by Cloudflare KV.
 * KV is NOT configured here, and additionally the `/api/artifacts` route is
 * declared `dynamic = "force-static"` while its handler reads the request, so it
 * responds 500 rather than the documented "Save data error". We assert the
 * honest boundary: the endpoint is wired (not 404) and never fabricates a share
 * without KV; the full create→read round trip skips (needs KV).
 *
 * ShareGPT (CH-092) posts to the external https://sharegpt.com service from an
 * active session — skipped (external dependency + session required).
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor } from '../fixtures';

function skipNoService() {
  test.skip(!baseURLFor('chat'), 'CHAT_BASE_URL not configured');
}

// CH-088 — export a conversation as Markdown.
test(localizedTitle("【导出与分享 / E2E】 CH-088 导出会话为 Markdown", "CH-088 export conversation as Markdown"), async () => {
  skipNoService();
  test.skip(
    !process.env.OPENAI_API_KEY?.trim() && !process.env.ANTHROPIC_API_KEY?.trim(),
    'exporter opens from an active chat session with messages; no text model available (empty provider keys + unfunded Router) to populate one',
  );
});

// CH-089 — export a conversation as a PNG image.
test(localizedTitle("【导出与分享 / E2E】 CH-089 导出会话为 PNG 图片", "CH-089 export conversation as PNG"), async () => {
  skipNoService();
  test.skip(
    !process.env.OPENAI_API_KEY?.trim() && !process.env.ANTHROPIC_API_KEY?.trim(),
    'PNG export opens from an active chat session with messages; no text model available to populate one',
  );
});

// CH-090 — POST /api/artifacts creates a share (needs Cloudflare KV).
test(localizedTitle("【导出与分享 / API】 CH-090 通过 artifacts 分享生成分享页", "CH-090 artifacts POST does not fabricate a share without KV"), async ({ request }) => {
  skipNoService();
  const res = await request.post('/api/artifacts', {
    data: 'e2e-artifact-content',
    headers: { 'Content-Type': 'text/plain' },
    failOnStatusCode: false,
  });
  // Recognized endpoint (not a routing 404) and never a fabricated success
  // ({code:0,id}) when KV is unconfigured.
  expect(res.status()).not.toBe(404);
  const text = await res.text();
  expect(text).not.toContain('"code":0');
  expect(res.ok()).toBeFalsy();
  // A real create+read round trip requires Cloudflare KV.
  test.skip(
    true,
    'Cloudflare KV not configured (and /api/artifacts returns 500 under force-static in this build) — cannot create a real share to read back',
  );
});

// CH-091 — GET /api/artifacts?id=<id> reads share content (needs a stored id).
test(localizedTitle("【导出与分享 / API】 CH-091 读取 artifacts 分享内容", "CH-091 artifacts GET is wired but yields no content without KV"), async ({ request }) => {
  skipNoService();
  const res = await request.get('/api/artifacts?id=nonexistent-e2e-id', {
    failOnStatusCode: false,
  });
  expect(res.status()).not.toBe(404);
  // Without KV / a real id there is no shared content to return.
  expect(res.ok()).toBeFalsy();
});

// CH-092 — ShareGPT export.
test(localizedTitle("【导出与分享 / E2E】 CH-092 ShareGPT 分享导出", "CH-092 ShareGPT export"), async () => {
  skipNoService();
  test.skip(
    true,
    'ShareGPT export posts to the external https://sharegpt.com service from an active session — external dependency + populated session not available here',
  );
});
