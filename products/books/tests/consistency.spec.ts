/**
 * books — 多集合索引一致性 (BK-DATA-029, 030, 031).
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { test, expect } from '../fixtures';
import { abs, readText, parseLinks, isInternalLink } from './helpers';

// BK-DATA-029
test("【多集合索引一致性 / DATA】 BK-DATA-029 yeying 总览表产品与单产品目录一一对应", () => {
  const overview = readText('yeying/社区文档总览.md');
  const tableFiles = new Set(
    parseLinks(overview)
      .map((l) => l.url)
      .filter((u) => u.includes('单产品/') && u.endsWith('.md'))
      .map((u) => basename(u)),
  );
  const diskFiles = new Set(readdirSync(abs('yeying/社区/产品/单产品')).filter((f) => f.endsWith('.md')));
  expect(diskFiles.size).toBe(8);
  // exact bijection — table entries and disk files are identical sets
  expect(tableFiles).toEqual(diskFiles);
});

// BK-DATA-030
test("【多集合索引一致性 / DATA】 BK-DATA-030 payment 发布导航版本链接齐全", () => {
  const acquiring = 'payment/docs/acquiring';
  const navs = readdirSync(abs(acquiring)).filter((f) => /^00-发布导航-v[\d.]+\.md$/.test(f));
  // v1.0 … v2.2 → 13 versioned navigation files
  expect(navs.length).toBeGreaterThanOrEqual(13);

  // acquiring README references the current v2.2 navigation, which exists
  const readme = readText(`${acquiring}/README.md`);
  expect(readme).toContain('00-发布导航-v2.2.md');
  expect(existsSync(abs(`${acquiring}/00-发布导航-v2.2.md`))).toBe(true);

  // links inside the current navigation resolve
  const navRel = `${acquiring}/00-发布导航-v2.2.md`;
  const navText = readText(navRel);
  const baseDir = dirname(abs(navRel));
  const missing: string[] = [];
  for (const link of parseLinks(navText)) {
    if (!isInternalLink(link.url)) continue;
    const path = link.url.split('#')[0];
    if (!path) continue;
    if (!existsSync(resolve(baseDir, decodeURIComponent(path)))) missing.push(link.url);
  }
  expect(missing).toEqual([]);
});

// BK-DATA-031
test("【多集合索引一致性 / DATA】 BK-DATA-031 payment 章节元信息/跨章索引引用一致", () => {
  const acquiring = 'payment/docs/acquiring';
  const missing: string[] = [];
  for (const rel of [`${acquiring}/章节元信息总表.md`, `${acquiring}/跨章索引.md`]) {
    const text = readText(rel);
    const baseDir = dirname(abs(rel));
    for (const link of parseLinks(text)) {
      if (!isInternalLink(link.url)) continue;
      const path = link.url.split('#')[0];
      if (!path) continue;
      if (!existsSync(resolve(baseDir, decodeURIComponent(path)))) missing.push(`${rel} -> ${link.url}`);
    }
  }
  expect(missing).toEqual([]);
});
