/**
 * warehouse — health & readiness smoke (WH-API-076, WH-API-077).
 *
 * These are unauthenticated liveness/readiness probes served by the backend on
 * the WebDAV/API port (6065). We target that port directly rather than the Vite
 * dev server (5173) so the checks reflect the real backend, not the proxy.
 *
 * Requires:
 *   - WAREHOUSE_WEBDAV_URL   (backend API+WebDAV origin, e.g. http://localhost:6065)
 *
 * Verified source behavior (warehouse internal/.../handler/health.go):
 *   - GET /api/v1/public/health/heartbeat → 200 {status:"healthy", uptime, version}
 *   - GET /api/v1/public/health/readiness → 200 {status:"ready", checks:[{name,status}]}
 *     with a check named "database"; returns 503 when a dependency is not ready.
 */
import { localizedTitle } from '../../../shared/title';
import { test, expect, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';

function apiBase(): string | undefined {
  return envFor('warehouse')['WAREHOUSE_WEBDAV_URL'];
}

test.describe(localizedTitle("【健康检查与冒烟】仓库健康探针（warehouse health probes）", "warehouse health probes"), () => {
  test(localizedTitle("【健康检查与冒烟 / API】 WH-API-076 心跳检查", "WH-API-076 heartbeat returns 200 healthy"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    const ctx = await apiContext(apiBase()!);
    try {
      const res = await ctx.get('/api/v1/public/health/heartbeat');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { status: string; version?: string };
      expect(body.status).toBe('healthy');
    } finally {
      await ctx.dispose();
    }
  });

  test(localizedTitle("【健康检查与冒烟 / API】 WH-API-077 就绪检查确认数据库", "WH-API-077 readiness confirms the database dependency"), async () => {
    test.skip(!apiBase(), 'WAREHOUSE_WEBDAV_URL not configured');
    const ctx = await apiContext(apiBase()!);
    try {
      const res = await ctx.get('/api/v1/public/health/readiness');
      // 200 when all dependencies (incl. database) are ready; 503 otherwise.
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        status: string;
        checks: Array<{ name: string; status: string }>;
      };
      expect(body.status).toBe('ready');
      const db = body.checks.find((c) => c.name === 'database');
      expect(db, 'readiness must report a "database" check').toBeDefined();
      expect(db!.status).toBe('ready');
    } finally {
      await ctx.dispose();
    }
  });
});
