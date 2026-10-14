/**
 * chat — LLM conversation cases (CH-030..CH-042).
 *
 * Every case here needs either a live streamed model response or a conversation
 * that already contains messages. Both require a usable text (or vision) model.
 * In this environment the account has no funded Router token and no provider key
 * is configured, so the model catalog is empty and the app routes an authorised
 * user to /setup — the chat compose view (input box, Send, message actions) is
 * never reachable. Per the task rules we skip these cleanly with a precise
 * reason rather than fabricate a streamed reply.
 *
 * If a real model becomes available these should be implemented as true tests;
 * the skip predicate documents exactly what unblocks each one.
 */
import { localizedTitle } from '../../../shared/title';
import { test, baseURLFor, hasEnv } from '../fixtures';

// True when neither a provider key is present nor a usable model is expected.
// (Router returns an empty catalog without a funded token; there is no reliable
// way to detect a usable model without first logging in and reaching /chat,
// which itself requires the model. So we gate on provider keys, which are the
// documented enabling condition for this whole section — see chat.md §五.)
const NO_MODEL =
  !baseURLFor('chat') || (!hasEnv('OPENAI_API_KEY') && !hasEnv('ANTHROPIC_API_KEY'));

const LLM_REASON =
  'requires a live model response (no OPENAI_API_KEY/ANTHROPIC_API_KEY and no funded Router token; empty model catalog routes to /setup, so the chat compose/message UI is unreachable).';

test.beforeEach(() => {
  test.skip(NO_MODEL, LLM_REASON);
});

// These would become real tests once a text/vision model is available. Until
// then the beforeEach guard skips them; each block documents its own specifics.
test(localizedTitle("【LLM 会话(依赖 key/令牌) / E2E】 CH-030 发送消息获得流式回复", "CH-030 send message gets streamed reply"), async () => {
  test.skip(true, LLM_REASON + ' Would assert SSE token-by-token append into the assistant bubble.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / E2E】 CH-031 多轮上下文连续对话", "CH-031 multi-turn context continuity"), async () => {
  test.skip(true, LLM_REASON + ' Would assert the 2nd reply reflects prior-turn context.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / E2E】 CH-032 流式过程中\"停止响应\"中断", "CH-032 stop streaming mid-response"), async () => {
  test.skip(true, LLM_REASON + ' Would assert Stop aborts the request and keeps partial content.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / E2E】 CH-033 重试/重新生成回复", "CH-033 retry / regenerate reply"), async () => {
  test.skip(true, LLM_REASON + ' Would assert Retry re-requests on the same context.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / E2E】 CH-034 编辑已发送消息并重发", "CH-034 edit a sent message and resend"), async () => {
  test.skip(true, LLM_REASON + ' Would need an existing user message in a live session.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / UI】 CH-035 删除单条消息", "CH-035 delete a single message"), async () => {
  test.skip(true, LLM_REASON + ' Would need a session containing messages.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / UI】 CH-036 复制消息内容", "CH-036 copy message content"), async () => {
  test.skip(true, LLM_REASON + ' Would need an assistant reply to copy.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / UI】 CH-037 会话内切换模型", "CH-037 switch model within a conversation"), async () => {
  test.skip(true, LLM_REASON + ' Would need multiple available models and an open chat.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / UI】 CH-038 Markdown/代码块渲染", "CH-038 markdown / code block rendering"), async () => {
  test.skip(true, LLM_REASON + ' Would need an assistant reply containing markdown/code.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / E2E】 CH-039 上传图片进行多模态提问", "CH-039 multimodal image-upload question"), async () => {
  test.skip(true, LLM_REASON + ' Additionally needs a VISION_MODELS-capable model.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / E2E】 CH-040 无效/错误 API Key 时优雅报错", "CH-040 invalid/wrong API key graceful error"), async () => {
  test.skip(
    true,
    'reaching the chat Send action requires a usable text model; with an empty catalog and no provider key the app stays on /setup, and injecting a synthetic model routes back to /setup and destabilises workspace sync. Cannot deterministically produce the in-chat upstream-auth error UI here.',
  );
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / UI】 CH-041 清除当前会话上下文", "CH-041 clear current conversation context"), async () => {
  test.skip(true, LLM_REASON + ' Would need a multi-message session to insert a clear divider.');
});
test(localizedTitle("【LLM 会话(依赖 key/令牌) / E2E】 CH-042 历史过长自动摘要压缩", "CH-042 auto-summary compression of long history"), async () => {
  test.skip(true, LLM_REASON + ' Additionally needs SUMMARIZE_MODEL and an over-threshold history.');
});
