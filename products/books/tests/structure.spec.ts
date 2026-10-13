/**
 * books — 目录结构与 SUMMARY 解析 (BK-DATA-002, 004, 005, 006).
 *
 * Filesystem-only assertions against the on-disk books repo (BOOKS_REPO_PATH).
 */
import { existsSync } from 'node:fs';
import { test, expect } from '../fixtures';
import { abs, readText, allMarkdown, walk, parseLinks } from './helpers';

// BK-DATA-002
test("【目录结构与 SUMMARY 解析 / DATA】 BK-DATA-002 agent/SUMMARY.md 存在、非空且以 Markdown 列表组织目录", () => {
  const text = readText('agent/SUMMARY.md');
  expect(text.length).toBeGreaterThan(0);
  const listItems = text.split('\n').filter((l) => /^\s*-\s+\[/.test(l));
  expect(listItems.length).toBeGreaterThanOrEqual(5);
  // every list item is a `- [title](link)` directory entry
  for (const item of listItems) {
    expect(item).toMatch(/^\s*-\s+\[[^\]]+\]\([^)]+\)/);
  }
});

// BK-DATA-004
test("【目录结构与 SUMMARY 解析 / DATA】 BK-DATA-004 SUMMARY 章节编号单调有序", () => {
  const text = readText('agent/SUMMARY.md');
  const nums: number[] = [];
  for (const link of parseLinks(text)) {
    const m = /chapters\/(\d+)-/.exec(link.url);
    if (m) nums.push(Number(m[1]));
  }
  expect(nums.length).toBeGreaterThanOrEqual(18);
  // 00 前言, 01-16 正文, 99 附录 — strictly ascending, no gaps/misorder
  for (let i = 1; i < nums.length; i++) {
    expect(nums[i]).toBeGreaterThan(nums[i - 1]);
  }
  expect(nums[0]).toBe(0);
  expect(nums[nums.length - 1]).toBe(99);
});

// BK-DATA-005
test("【目录结构与 SUMMARY 解析 / DATA】 BK-DATA-005 SUMMARY 覆盖三部分骨架标题", () => {
  const summary = readText('agent/SUMMARY.md');
  for (const part of ['第一部分', '第二部分', '第三部分']) {
    expect(summary).toContain(part);
  }
  // structure aligns with README's 理论与方法 / 项目实践与对照 / 最佳实践与方法沉淀
  const readme = readText('agent/README.md');
  for (const theme of ['理论与方法', '项目实践与对照', '最佳实践与方法沉淀']) {
    expect(readme).toContain(theme);
    expect(summary).toContain(theme);
  }
  // each part entry is followed by at least one chapter link before EOF
  const idx1 = summary.indexOf('第一部分');
  const idx2 = summary.indexOf('第二部分');
  const idx3 = summary.indexOf('第三部分');
  expect(idx1).toBeGreaterThanOrEqual(0);
  expect(idx2).toBeGreaterThan(idx1);
  expect(idx3).toBeGreaterThan(idx2);
});

// BK-DATA-006
test("【目录结构与 SUMMARY 解析 / DATA】 BK-DATA-006 顶层三大文档集合目录均存在且非空", () => {
  const collections = ['agent', 'payment/docs', 'yeying'];
  for (const rel of collections) {
    const dir = abs(rel);
    expect(existsSync(dir)).toBe(true);
    const md = walk(dir).filter((f) => f.endsWith('.md'));
    expect(md.length).toBeGreaterThan(0);
  }
  // sanity on approximate sizes (agent ≈ 23, payment ≈ 160, yeying ≈ 39)
  expect(walk(abs('payment/docs')).filter((f) => f.endsWith('.md')).length).toBeGreaterThan(100);
  expect(allMarkdown().length).toBeGreaterThan(200);
});
