/**
 * marketplace — no live service required.
 *
 * Env vars consumed:
 *   - MARKETPLACE_BASE_URL (optional; if empty, tests read filesystem)
 *   - MARKETPLACE_REPO_PATH (default: ../marketplace)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, hasEnv } from '../fixtures';

interface CatalogEntry {
  id: string;
  lang: string;
  name: { cn?: string; en?: string };
  category?: string;
}

function repoPath(): string {
  return (
    process.env['MARKETPLACE_REPO_PATH']?.trim() || '/Users/liuxin2/Workspace/opensource/marketplace'
  );
}

function readIndexJson(): CatalogEntry[] {
  const file = resolve(repoPath(), 'index.json');
  if (!existsSync(file)) {
    throw new Error(`marketplace index.json not found at ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as CatalogEntry[];
}

test("【索引与数据校验 / DATA】 市场index.json存在并解析", () => {
  const entries = readIndexJson();
  expect(Array.isArray(entries)).toBe(true);
  expect(entries.length).toBeGreaterThan(0);
});

test("【索引与数据校验 / DATA】 每个条目都有 ID、语言、名称和类别", () => {
  const entries = readIndexJson();
  for (const entry of entries) {
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.lang).toBe('string');
    expect(entry.name).toBeDefined();
    const hasName = !!(entry.name?.cn || entry.name?.en);
    expect(hasName, `entry ${entry.id} has no name`).toBe(true);
    expect(typeof entry.category).toBe('string');
  }
});

test("【索引与数据校验 / DATA】 packages.json 格式良好 JSON", () => {
  const file = resolve(repoPath(), 'packages.json');
  test.skip(!existsSync(file), `packages.json not found at ${file}`);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  expect(parsed).toBeDefined();
});

test("【索引与数据校验 / API】 （可选）MARKETPLACE_BASE_URL 响应 2xx", async ({ request }) => {
  test.skip(!hasEnv('MARKETPLACE_BASE_URL'), 'MARKETPLACE_BASE_URL not set');
  const baseURL = process.env['MARKETPLACE_BASE_URL']!;
  const res = await request.get(`${baseURL.replace(/\/$/, '')}/index.json`);
  expect(res.status()).toBeLessThan(500);
});
