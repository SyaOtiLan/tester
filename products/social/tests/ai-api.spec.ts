/**
 * social — AI assistant API (platform, 8888).
 *
 * The platform ships a local AI provider (no external model key needed): the
 * endpoints answer with `provider:"local", modelUsed:false`. All three routes
 * are live-verified against that local provider.
 *
 * Contract (live):
 *  - POST /ai/rewrite       {text, style}   -> Result<{text, provider, modelUsed}>
 *  - POST /ai/reply/suggest {content|messages} -> Result<{suggestions:[], provider, modelUsed}>
 *  - POST /ai/summary       {content}       -> Result<{summary, highlights:[], actionItems:[], ...}>
 *
 * Env:
 *  - SOCIAL_BASE_URL      platform backend (8888)
 *  - SOCIAL_IDENTITY_URL  web3-identity (8901) — mints the authenticated caller
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { newSiweIdentity, platformCtx, type Envelope } from '../helpers/auth';

const platformURL = () => baseURLFor('social');
const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

function skipIfNoStack() {
  test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required');
}

// SO-API-059 (P2) — AI rewrites a message; the local provider returns rewritten text.
test("【AI 助手 / API】 SO-API-059 AI 改写消息", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    const res = await ctx.post('/ai/rewrite', { data: { text: '晚点一起吃饭吗', style: 'formal' } });
    const body = (await res.json()) as Envelope<{ text: string; provider: string }>;
    expect(body.code).toBe(200);
    expect(typeof body.data.text).toBe('string');
    expect(body.data.text.length).toBeGreaterThan(0);
    expect(typeof body.data.provider).toBe('string');
  } finally {
    await ctx.dispose();
  }
});

// SO-API-060 (P2) — AI suggests replies; returns a non-empty candidate list.
test("【AI 助手 / API】 SO-API-060 AI 回复建议", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    const res = await ctx.post('/ai/reply/suggest', {
      data: { messages: [{ content: '周末有空一起爬山吗' }] },
    });
    const body = (await res.json()) as Envelope<{ suggestions: string[]; provider: string }>;
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data.suggestions)).toBe(true);
    expect(body.data.suggestions.length).toBeGreaterThan(0);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-061 (P2) — AI summarizes a conversation; returns summary text.
test("【AI 助手 / API】 SO-API-061 AI 会话摘要", async () => {
  skipIfNoStack();
  const A = await newSiweIdentity(platformURL()!, identityURL()!);
  const ctx = await platformCtx(platformURL()!, A.login.accessToken);
  try {
    const res = await ctx.post('/ai/summary', {
      data: { content: '甲:我们明天讨论下方案\n乙:好的，上午十点\n甲:会议室B' },
    });
    const body = (await res.json()) as Envelope<{
      summary: string;
      highlights: unknown[];
      actionItems: unknown[];
    }>;
    expect(body.code).toBe(200);
    expect(typeof body.data.summary).toBe('string');
    expect(body.data.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(body.data.highlights)).toBe(true);
    expect(Array.isArray(body.data.actionItems)).toBe(true);
  } finally {
    await ctx.dispose();
  }
});
