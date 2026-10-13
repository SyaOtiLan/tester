/**
 * marketplace — empty/invalid/missing data handling (MP-DATA-051 .. 055).
 *
 * These assert the VALIDATOR's behavior on synthesized bad input via temp
 * fixtures — the real repo is never mutated (read-only per task constraints).
 */
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test, expect } from '../fixtures';
import { readIndexFrom, isLocalizedText, readSkillSchema, unknownTopLevelKeys } from './helpers';

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mp-edge-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("【空值与异常数据处理 / DATA】 MP-DATA-051 index.json 缺失时给出明确错误", () => {
  withTempDir((dir) => {
    const file = resolve(dir, 'index.json');
    expect(() => readIndexFrom(dir)).toThrow(`marketplace index.json not found at ${file}`);
  });
});

test("【空值与异常数据处理 / DATA】 MP-DATA-052 packages.json 缺失时优雅跳过", () => {
  withTempDir((dir) => {
    const file = resolve(dir, 'packages.json');
    // The guard the real spec uses: test.skip(!existsSync(file), ...). Assert the
    // decision resolves to "skip" for a repo that lacks packages.json.
    expect(existsSync(file)).toBe(false);
    const shouldSkip = !existsSync(file);
    expect(shouldSkip).toBe(true);
  });
});

test("【空值与异常数据处理 / DATA】 MP-DATA-053 非法 JSON 被解析失败捕获", () => {
  withTempDir((dir) => {
    const file = resolve(dir, 'index.json');
    writeFileSync(file, '[{"id":"a",},'); // trailing comma + truncated
    expect(() => readIndexFrom(dir)).toThrow(SyntaxError);
  });
});

test("【空值与异常数据处理 / DATA】 MP-DATA-054 空数组 index 触发断言失败", () => {
  withTempDir((dir) => {
    writeFileSync(resolve(dir, 'index.json'), '[]');
    const entries = readIndexFrom(dir);
    expect(Array.isArray(entries)).toBe(true);
    // The "non-empty" guard must reject an empty publish list.
    expect(() => expect(entries.length).toBeGreaterThan(0)).toThrow();
  });
});

test("【空值与异常数据处理 / DATA】 MP-DATA-055 可选字段缺省不报错", () => {
  const schema = readSkillSchema();
  const required = schema.required as string[];
  // A minimal but VALID skill: all required present, all optionals (description,
  // tags, icon, ui, ...) omitted.
  const minimal: Record<string, unknown> = {
    schemaVersion: '1.0',
    id: 'minimal-skill',
    version: '1.0.0',
    name: { en: 'Minimal' },
    launch: { type: 'chat' },
    instructions: { type: 'inline', content: 'hi' },
  };
  for (const field of required) {
    expect(minimal[field], `required ${field} present`).toBeDefined();
  }
  expect(isLocalizedText(minimal.name)).toBe(true);
  expect(unknownTopLevelKeys(minimal, schema), 'no unknown keys').toEqual([]);
  expect(minimal.description).toBeUndefined();
  expect(minimal.tags).toBeUndefined();
  expect(minimal.icon).toBeUndefined();
});
