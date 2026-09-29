/**
 * node — notification delivery engine (webhook / DingTalk / Feishu / SSE).
 *
 * These exercise the unified delivery engine end to end against a running node
 * instance — the parts that cannot be covered by node's in-repo unit tests
 * (real outbound HTTP, real bot signing, live SSE fan-out).
 *
 * ND-API-034 generic webhook delivery loop: register a `format=generic`
 *   webhook pointing at a throwaway local HTTP server, create an app (emits a
 *   notification whose audience is the creator = webhook owner). Fan-out queues
 *   a delivery and the background worker POSTs it to our server. Asserts the
 *   callback arrived with the documented `x-yeying-*` headers and a valid
 *   HMAC-SHA256 signature, and that the delivery record settles to `delivered`.
 *
 * ND-API-035 / ND-API-036 DingTalk / Feishu real delivery (gated): register a
 *   bot webhook with a real URL + signing secret from env, create an app and
 *   poll the delivery until it reaches `delivered` (i.e. the bot returned
 *   errcode/code 0). Skips unless the bot env vars are configured.
 *
 * ND-API-037 notification-center SSE: open `/notifications/stream` with a
 *   bearer token (via Node fetch — EventSource cannot set Authorization),
 *   confirm the `ready` frame, create an app, then assert a live
 *   `notification.created` event is pushed to the subscriber.
 *
 * Contract verified against node:
 *   src/routes/public/notifications.ts (stream + webhook CRUD + deliveries),
 *   src/domain/service/notification.ts (fan-out + delivery list shape),
 *   src/domain/service/delivery/providers/webhookProvider.ts (headers/body),
 *   src/domain/service/delivery/webhookSecret.ts (signature = sha256=HMAC).
 */
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Wallet, getAddress, type BaseWallet } from 'ethers';

import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { loginWithWallet } from '../helpers/auth';
import { buildCreateApplicationBody, deleteBody } from '../helpers/signedAction';

function skipIfNoService() {
  test.skip(!baseURLFor('node'), 'NODE_BASE_URL not configured');
  test.skip(!envFor('node')['NODE_WALLET_PRIVATE_KEY'], 'node wallet env not configured');
}

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  rawBody: string;
}

/** A throwaway HTTP server that captures the first request it receives. */
function startCaptureServer(host: string): Promise<{
  server: Server;
  port: number;
  received: Promise<CapturedRequest>;
}> {
  let resolveReq!: (value: CapturedRequest) => void;
  const received = new Promise<CapturedRequest>((resolve) => {
    resolveReq = resolve;
  });
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
      resolveReq({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers as Record<string, string>,
        rawBody: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, host, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, received });
    });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

interface NotificationListItem {
  notificationUid: string;
  type: string;
  subjectId: string;
}

/** Create an app (emits application.created) and return its uid + notificationUid. */
async function createAppEmittingNotification(
  ctx: Awaited<ReturnType<typeof apiContext>>,
  wallet: BaseWallet,
  address: string,
): Promise<{ appUid: string; notificationUid: string }> {
  const req = await buildCreateApplicationBody(wallet, address);
  const created = await ctx.post('/api/v1/public/applications', { data: req.body });
  expect(created.status(), await created.text().catch(() => '')).toBe(200);
  const appUid = ((await created.json()) as { data: { uid: string } }).data.uid;

  // The notification fan-out is created synchronously on app creation.
  let notificationUid = '';
  for (let attempt = 0; attempt < 10 && !notificationUid; attempt++) {
    const list = await ctx.get('/api/v1/public/notifications?pageSize=50');
    expect(list.status()).toBe(200);
    const items = ((await list.json()) as { data: { items: NotificationListItem[] } }).data.items;
    const match = items.find((item) => item.type === 'application.created' && item.subjectId === appUid);
    if (match) {
      notificationUid = match.notificationUid;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  expect(notificationUid, 'application.created notification for the new app').toBeTruthy();
  return { appUid, notificationUid };
}

interface DeliveryItem {
  uid: string;
  webhookUid: string;
  notificationUid: string;
  channel: string;
  status: string;
  attemptCount: number;
  lastError: string;
}

/**
 * Poll a webhook's deliveries until the one for `notificationUid` reaches a
 * terminal state (`delivered`/`failed`). The delivery is created synchronously
 * by fan-out on app-create; the background worker (default 15s interval)
 * dispatches it, so we give it a generous window.
 */
async function waitForTerminalDelivery(
  ctx: Awaited<ReturnType<typeof apiContext>>,
  webhookUid: string,
  notificationUid: string,
  timeoutMs: number,
): Promise<DeliveryItem> {
  const deadline = Date.now() + timeoutMs;
  let last: DeliveryItem | undefined;
  for (;;) {
    const res = await ctx.get(`/api/v1/public/notifications/webhooks/${webhookUid}/deliveries?limit=50`);
    expect(res.status()).toBe(200);
    const items = ((await res.json()) as { data: { items: DeliveryItem[] } }).data.items;
    last = items.find((item) => item.notificationUid === notificationUid);
    if (last && (last.status === 'delivered' || last.status === 'failed')) return last;
    if (Date.now() >= deadline) {
      throw new Error(
        `delivery for ${notificationUid} did not reach a terminal state within ${timeoutMs}ms` +
          (last ? ` (last status: ${last.status}, error: ${last.lastError})` : ' (no delivery record found)'),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

test('ND-API-034 generic webhook delivery loop signs and delivers to a live callback', async () => {
  skipIfNoService();
  test.setTimeout(90_000);
  const baseURL = baseURLFor('node')!;
  const callbackHost = envFor('node')['NODE_CALLBACK_HOST']?.trim() || '127.0.0.1';
  const secret = `e2e-webhook-secret-${Date.now()}`;

  const wallet = Wallet.createRandom();
  const address = getAddress(wallet.address);
  const tokens = await loginWithWallet(baseURL, wallet.privateKey);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${tokens.token}` });
  const { server, port, received } = await startCaptureServer(callbackHost);
  const targetUrl = `http://${callbackHost}:${port}/hook`;

  let webhookUid = '';
  let appUid = '';
  try {
    const create = await ctx.post('/api/v1/public/notifications/webhooks', {
      data: { targetUrl, secret, format: 'generic', events: ['application.created'], enabled: true },
    });
    expect(create.status(), await create.text().catch(() => '')).toBe(200);
    webhookUid = ((await create.json()) as { data: { uid: string } }).data.uid;

    // Fan-out creates a pending delivery for this webhook (owner == creator);
    // the background worker then POSTs it to our local capture server.
    const emitted = await createAppEmittingNotification(ctx, wallet, address);
    appUid = emitted.appUid;

    const callback = await withTimeout(received, 60_000, 'webhook callback');
    expect(callback.method).toBe('POST');
    expect(callback.headers['x-yeying-event']).toBe('application.created');
    expect(callback.headers['x-yeying-notification-id']).toBe(emitted.notificationUid);
    expect(callback.headers['x-yeying-webhook-id']).toBe(webhookUid);

    const timestamp = callback.headers['x-yeying-timestamp'];
    expect(timestamp, 'x-yeying-timestamp header').toBeTruthy();
    const expectedSignature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${callback.rawBody}`).digest('hex')}`;
    expect(callback.headers['x-yeying-signature']).toBe(expectedSignature);

    const body = JSON.parse(callback.rawBody) as { notification: { uid: string; type: string } };
    expect(body.notification.uid).toBe(emitted.notificationUid);
    expect(body.notification.type).toBe('application.created');

    // The delivery record settles to delivered (our server answered 200).
    const delivery = await waitForTerminalDelivery(ctx, webhookUid, emitted.notificationUid, 30_000);
    expect(delivery.channel).toBe('webhook');
    expect(delivery.status, `delivery lastError: ${delivery.lastError}`).toBe('delivered');
  } finally {
    if (webhookUid) await ctx.delete(`/api/v1/public/notifications/webhooks/${webhookUid}`).catch(() => {});
    if (appUid) {
      await ctx
        .delete(`/api/v1/public/applications/${appUid}`, { data: await deleteBody(wallet, address, appUid) })
        .catch(() => {});
    }
    await ctx.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

for (const bot of [
  { id: 'ND-API-035', format: 'dingtalk', urlKey: 'NODE_DINGTALK_WEBHOOK_URL', secretKey: 'NODE_DINGTALK_WEBHOOK_SECRET' },
  { id: 'ND-API-036', format: 'feishu', urlKey: 'NODE_FEISHU_WEBHOOK_URL', secretKey: 'NODE_FEISHU_WEBHOOK_SECRET' },
] as const) {
  test(`${bot.id} ${bot.format} bot delivers a real notification`, async () => {
    skipIfNoService();
    const env = envFor('node');
    const botUrl = env[bot.urlKey]?.trim();
    const botSecret = env[bot.secretKey]?.trim();
    test.skip(!botUrl || !botSecret, `${bot.urlKey}/${bot.secretKey} not configured`);
    test.setTimeout(90_000);
    const baseURL = baseURLFor('node')!;

    const wallet = Wallet.createRandom();
    const address = getAddress(wallet.address);
    const tokens = await loginWithWallet(baseURL, wallet.privateKey);
    const ctx = await apiContext(baseURL, { Authorization: `Bearer ${tokens.token}` });

    let webhookUid = '';
    let appUid = '';
    try {
      const create = await ctx.post('/api/v1/public/notifications/webhooks', {
        data: { targetUrl: botUrl, secret: botSecret, format: bot.format, events: ['application.created'], enabled: true },
      });
      expect(create.status(), await create.text().catch(() => '')).toBe(200);
      webhookUid = ((await create.json()) as { data: { uid: string; format: string } }).data.uid;

      const emitted = await createAppEmittingNotification(ctx, wallet, address);
      appUid = emitted.appUid;

      // Real bot round-trip: delivered means the platform returned errcode/code 0.
      const delivery = await waitForTerminalDelivery(ctx, webhookUid, emitted.notificationUid, 40_000);
      expect(delivery.channel).toBe(bot.format);
      expect(delivery.status, `delivery lastError: ${delivery.lastError}`).toBe('delivered');
    } finally {
      if (webhookUid) await ctx.delete(`/api/v1/public/notifications/webhooks/${webhookUid}`).catch(() => {});
      if (appUid) {
        await ctx
          .delete(`/api/v1/public/applications/${appUid}`, { data: await deleteBody(wallet, address, appUid) })
          .catch(() => {});
      }
      await ctx.dispose();
    }
  });
}

interface SseEvent {
  event: string;
  data: string;
}

function parseSseFrame(raw: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue; // blank or heartbeat comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0 && event === 'message') return null;
  return { event, data: dataLines.join('\n') };
}

test('ND-API-037 notification stream pushes a live notification.created event', async () => {
  skipIfNoService();
  test.setTimeout(60_000);
  const baseURL = baseURLFor('node')!;

  const wallet = Wallet.createRandom();
  const address = getAddress(wallet.address);
  const tokens = await loginWithWallet(baseURL, wallet.privateKey);

  const controller = new AbortController();
  const res = await fetch(`${baseURL}/api/v1/public/notifications/stream`, {
    headers: { Authorization: `Bearer ${tokens.token}`, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.body, 'SSE response body').toBeTruthy();

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function nextEvent(predicate: (evt: SseEvent) => boolean, timeoutMs: number): Promise<SseEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseSseFrame(frame);
        if (evt && predicate(evt)) return evt;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('SSE event timed out');
      const chunk = await withTimeout(reader.read(), remaining, 'SSE read');
      if (chunk.done) throw new Error('SSE stream ended unexpectedly');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${tokens.token}` });
  let appUid = '';
  try {
    // Handshake: the server emits `ready` then `unread-count` on connect.
    const ready = await nextEvent((evt) => evt.event === 'ready', 15_000);
    const recipient = (JSON.parse(ready.data) as { recipient: string }).recipient;
    expect(recipient.toLowerCase()).toBe(address.toLowerCase());

    // Trigger a notification for this subscriber, then expect the live event.
    const emitted = await createAppEmittingNotification(ctx, wallet, address);
    appUid = emitted.appUid;

    const created = await nextEvent((evt) => evt.event === 'notification.created', 20_000);
    const payload = JSON.parse(created.data) as { event: string; notificationUid?: string };
    expect(payload.event).toBe('notification.created');
    if (payload.notificationUid) {
      expect(payload.notificationUid).toBe(emitted.notificationUid);
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
    if (appUid) {
      await ctx
        .delete(`/api/v1/public/applications/${appUid}`, { data: await deleteBody(wallet, address, appUid) })
        .catch(() => {});
    }
    await ctx.dispose();
  }
});
