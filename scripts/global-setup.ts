/**
 * globalSetup — warms the Vite dev servers that serve the warehouse and
 * node SPAs before any test runs. Without this, the first parallel batch
 * of UI tests all hit a cold Vite queue and individual tests time out
 * waiting for first-paint. Each warm-up is a single GET that forces Vite
 * to compile + cache the entry + chunks.
 *
 * Runs once per `pnpm test` invocation. Safe to run when a service is
 * down (the fetch fails with ECONNREFUSED and we log + skip).
 */
import { baseURLFor } from '../shared/env';

async function warmup(name: string, url: string | undefined, timeoutMs = 30_000): Promise<void> {
  if (!url) {
    console.log(`[warmup] ${name}: BASE_URL not configured, skipping`);
    return;
  }
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    console.log(`[warmup] ${name}: ${url} -> HTTP ${res.status} in ${Date.now() - started}ms`);
  } catch (err) {
    console.log(`[warmup] ${name}: ${url} -> FAILED (${(err as Error).message})`);
  }
}

export default async function globalSetup(): Promise<void> {
  // Pre-compile both warehouse and node in parallel. Other products are
  // either backend-only (router, social, project) or down (chat,
  // knowledge, orchestrator) and don't need warming.
  await Promise.all([
    warmup('warehouse', baseURLFor('warehouse')),
    warmup('node', baseURLFor('node')),
  ]);
}
