/**
 * books — 章节文件与孤儿检测 (BK-DATA-014, 015, 016, 017, 018).
 */
import { readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { test, expect } from '../fixtures';
import { abs, readText, parseLinks } from './helpers';

function summaryChapterFiles(): string[] {
  const text = readText('agent/SUMMARY.md');
  return parseLinks(text)
    .map((l) => l.url)
    .filter((u) => u.includes('chapters/') && u.endsWith('.md'))
    .map((u) => basename(u));
}

function diskChapterFiles(): string[] {
  return readdirSync(abs('agent/chapters')).filter((f) => f.endsWith('.md'));
}

// BK-DATA-014
test("【章节文件与孤儿检测 / DATA】 BK-DATA-014 agent 章节文件无孤儿(均被 SUMMARY 引用)", () => {
  const referenced = new Set(summaryChapterFiles());
  const orphans = diskChapterFiles().filter((f) => !referenced.has(f));
  expect(orphans).toEqual([]);
});

// BK-DATA-015
test("【章节文件与孤儿检测 / DATA】 BK-DATA-015 SUMMARY 引用的章节文件都真实存在(反向校验)", () => {
  const onDisk = new Set(diskChapterFiles());
  const dangling = summaryChapterFiles().filter((f) => !onDisk.has(f));
  expect(dangling).toEqual([]);
  // and the two sets are identical — no more, no less
  expect(new Set(summaryChapterFiles())).toEqual(onDisk);
});

// BK-DATA-016
test("【章节文件与孤儿检测 / DATA】 BK-DATA-016 每个章节文件非空且含标题", () => {
  const emptyOrTitleless: string[] = [];
  for (const f of diskChapterFiles()) {
    const text = readText(`agent/chapters/${f}`);
    if (text.trim().length === 0) emptyOrTitleless.push(`${f} (empty)`);
    else if (!/^\s{0,3}#{1,2}\s+\S/m.test(text)) emptyOrTitleless.push(`${f} (no heading)`);
  }
  expect(emptyOrTitleless).toEqual([]);
});

// BK-DATA-017
test("【章节文件与孤儿检测 / DATA】 BK-DATA-017 章节文件名编号与 SUMMARY 顺序对应", () => {
  const summaryNums = summaryChapterFiles()
    .map((f) => /^(\d+)-/.exec(f))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => Number(m[1]));
  // ascending in SUMMARY order, no swapped titles/files
  for (let i = 1; i < summaryNums.length; i++) {
    expect(summaryNums[i]).toBeGreaterThan(summaryNums[i - 1]);
  }
  // numbered SUMMARY chapters == numbered disk chapters (same set)
  const diskNums = diskChapterFiles()
    .map((f) => /^(\d+)-/.exec(f))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => Number(m[1]));
  expect(new Set(summaryNums)).toEqual(new Set(diskNums));
});

// BK-DATA-018
test("【章节文件与孤儿检测 / DATA】 BK-DATA-018 yeying 单产品说明文件齐全且被总览引用", () => {
  const dir = 'yeying/社区/产品/单产品';
  const files = readdirSync(abs(dir)).filter((f) => f.endsWith('.md'));
  expect(files.length).toBe(8);
  const overview = readText('yeying/社区文档总览.md');
  const orphans = files.filter((f) => !overview.includes(`单产品/${f}`));
  expect(orphans).toEqual([]);
});
