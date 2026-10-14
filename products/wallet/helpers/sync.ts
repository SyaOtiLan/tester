/**
 * Helpers for the wallet's 数据备份 / BackupSync (WebDAV) e2e tests.
 *
 * The sync feature (`js/background/sync-service.js`) stores one encrypted
 * payload per HD wallet on a WebDAV endpoint. The path fingerprint and the
 * encryption key are both derived deterministically from the wallet mnemonic
 * (`hashHex('yeying-sync-id:'+mnemonic)` / `'yeying-sync-key:'+mnemonic`), so a
 * test that knows the mnemonic can decrypt the pushed payload and assert its
 * contents.
 *
 * `stubWebDav` installs a tiny stateful WebDAV server on a context: PUT stores
 * the (already-encrypted) body keyed by path, GET/HEAD serve it back, MKCOL
 * succeeds, DELETE removes. Basic-auth mode avoids UCAN signing entirely.
 */
import type { BrowserContext, Page } from '@playwright/test';

import { sendSw } from './popup';

/** A dedicated non-resolving host — routed before DNS, never hits the network. */
export const SYNC_ENDPOINT = 'https://backup-sync.e2e.test/dav';

export type DavStore = Map<string, { body: string; etag: string }>;

export function createDavStore(): DavStore {
  return new Map();
}

/** Install a stateful WebDAV stub backed by `store` on `context`. */
export async function stubWebDav(context: BrowserContext, store: DavStore): Promise<void> {
  await context.route('https://backup-sync.e2e.test/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const path = new URL(req.url()).pathname;

    if (method === 'MKCOL') return route.fulfill({ status: 201 });
    if (method === 'HEAD') {
      const entry = store.get(path);
      return entry
        ? route.fulfill({ status: 200, headers: { ETag: entry.etag } })
        : route.fulfill({ status: 404 });
    }
    if (method === 'PUT') {
      const etag = `"${Math.random().toString(36).slice(2)}"`;
      store.set(path, { body: req.postData() ?? '', etag });
      return route.fulfill({ status: 201, headers: { ETag: etag } });
    }
    if (method === 'GET') {
      const entry = store.get(path);
      return entry
        ? route.fulfill({ status: 200, headers: { ETag: entry.etag }, body: entry.body })
        : route.fulfill({ status: 404 });
    }
    if (method === 'DELETE') {
      store.delete(path);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 405 });
  });
}

/** Configure BackupSync to the stubbed endpoint using basic auth (no UCAN). */
export async function configureSync(popup: Page): Promise<void> {
  await sendSw(popup, 'UPDATE_BACKUP_SYNC_SETTINGS', {
    updates: {
      enabled: true,
      endpoint: SYNC_ENDPOINT,
      authMode: 'basic',
      // base64("test:test") — any non-empty basic credential satisfies _hasAuth.
      basicAuth: 'dGVzdDp0ZXN0',
    },
  });
}

/**
 * Decrypt a sync payload the way the service worker does: syncKey is
 * `hashHex('yeying-sync-key:'+mnemonic)`, decrypted with the extension's own
 * `decryptObject`. Runs in the (same-origin) popup page so it uses the product
 * crypto byte-for-byte.
 */
export async function decryptSyncPayload(popup: Page, ciphertext: string, mnemonic: string): Promise<any> {
  return popup.evaluate(
    async ({ ciphertext, mnemonic }) => {
      const enc = await import('/js/common/crypto/encryption.js');
      const utils = await import('/js/common/crypto/crypto-utils.js');
      const syncKey = await utils.hashHex(`yeying-sync-key:${mnemonic}`);
      return enc.decryptObject(ciphertext, syncKey);
    },
    { ciphertext, mnemonic },
  );
}

/** Poll an async predicate until true or timeout (ms). */
export async function pollUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000, intervalMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
