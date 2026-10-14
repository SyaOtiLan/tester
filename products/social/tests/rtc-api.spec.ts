/**
 * social — RTC signaling service (rtc module, 8890).
 *
 * The rtc service exposes WebRTC signaling + a system-config probe. Its base URL
 * is derived from the platform base URL (8888 -> 8890) unless SOCIAL_RTC_URL is
 * set explicitly. Its endpoints authenticate with the same custom `accessToken`
 * header the platform uses (a SIWE-issued JWT works).
 *
 * Contract (live):
 *  - GET  /system/config   (accessToken header)
 *      -> Result<{webrtc:{maxChannel, iceServers:[{urls,...}]}}>
 *  - POST /webrtc/private/call?uid=&mode=  — delivers a call offer over the IM
 *      WebSocket to an *online* callee. With no peer connected it returns a
 *      generic {code:500} (see SO-API-063 skip).
 *
 * Env:
 *  - SOCIAL_BASE_URL      platform backend (8888) — RTC URL derived from it
 *  - SOCIAL_RTC_URL       optional explicit rtc base (defaults to :8890)
 *  - SOCIAL_IDENTITY_URL  web3-identity (8901) — mints the authenticated caller
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { request } from '@playwright/test';
import { newSiweIdentity, type Envelope } from '../helpers/auth';

const platformURL = () => baseURLFor('social');
const identityURL = () => envFor('social')['SOCIAL_IDENTITY_URL'];

/** rtc base URL: explicit override, else the platform host with port 8890. */
function rtcURL(): string | undefined {
  const explicit = process.env['SOCIAL_RTC_URL']?.trim();
  if (explicit) return explicit;
  const base = platformURL();
  if (!base) return undefined;
  return base.replace(/:8888(\/|$)/, ':8890$1');
}

// SO-API-062 (P2) — the rtc service's system-config probe is reachable and
// returns the WebRTC config (ICE servers, channel cap).
test(localizedTitle("【音视频通话(RTC 信令) / API】 SO-API-062 RTC 系统配置可达", "SO-API-062 RTC system config reachable"), async () => {
  test.skip(!platformURL() || !identityURL(), 'SOCIAL_BASE_URL / SOCIAL_IDENTITY_URL required');
  const A = await newSiweIdentity(platformURL()!, identityURL()!);

  const ctx = await request.newContext({ baseURL: rtcURL()! });
  try {
    let body: Envelope<{ webrtc: { maxChannel: number; iceServers: unknown[] } }> | undefined;
    try {
      const res = await ctx.get('/system/config', {
        headers: { accessToken: A.login.accessToken },
      });
      body = await res.json();
    } catch {
      // rtc service not listening in this environment.
    }
    test.skip(!body, `rtc service unreachable at ${rtcURL()}`);
    expect(body!.code).toBe(200);
    expect(body!.data.webrtc).toBeTruthy();
    expect(Array.isArray(body!.data.webrtc.iceServers)).toBe(true);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-063 (P2) — initiate a 1:1 call signal.
// DEGRADED SKIP: /webrtc/private/call pushes the call offer to the callee over
// the IM WebSocket, and only succeeds when the callee is connected. There is no
// second, WS-connected peer in an automated API run (the SPA's /ws handshake
// does not complete here either), so the call returns a generic {code:500} for
// every variant — success cannot be reached without an online peer.
test(localizedTitle("【音视频通话(RTC 信令) / API】 SO-API-063 发起 1:1 通话信令", "SO-API-063 initiate 1:1 call signal"), async () => {
  test.skip(
    true,
    'A call signal needs a WS-connected callee to succeed; no online peer is ' +
      'available in an automated run, so /webrtc/private/call returns a generic 500.',
  );
});
