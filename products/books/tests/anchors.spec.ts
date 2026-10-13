/**
 * books — 锚点与交叉引用 (BK-DATA-019, 020, 021).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { test, expect } from '../fixtures';
import { abs, readText, allMarkdown, parseLinks, headings, slug, anchorSet, isInternalLink } from './helpers';

function relOf(file: string): string {
  return file.slice(abs('.').length + 1);
}

// BK-DATA-019
test("【锚点与交叉引用 / DATA】 BK-DATA-019 跨文件链接的锚点在目标文件内存在", () => {
  const broken: string[] = [];
  for (const file of allMarkdown()) {
    const text = readText(relOf(file));
    for (const link of parseLinks(text)) {
      if (!isInternalLink(link.url)) continue;
      const hash = link.url.indexOf('#');
      if (hash <= 0) continue; // skip pure-anchor (BK-DATA-020) and anchorless
      const path = link.url.slice(0, hash);
      const anchor = decodeURIComponent(link.url.slice(hash + 1));
      if (!anchor) continue;
      const target = resolve(dirname(file), decodeURIComponent(path));
      if (!existsSync(target) || !target.endsWith('.md')) continue; // dead link is BK-DATA-012's concern
      if (!anchorSet(readFileSync(target, 'utf8')).has(slug(anchor))) {
        broken.push(`${relOf(file)} -> ${link.url}`);
      }
    }
  }
  expect(broken).toEqual([]);
});

// BK-DATA-020
test("【锚点与交叉引用 / DATA】 BK-DATA-020 同文档内 #锚点 指向存在的标题", () => {
  const broken: string[] = [];
  for (const file of allMarkdown()) {
    const text = readText(relOf(file));
    const anchors = anchorSet(text);
    for (const link of parseLinks(text)) {
      if (!link.url.startsWith('#')) continue;
      const anchor = decodeURIComponent(link.url.slice(1));
      if (!anchor) continue;
      if (!anchors.has(slug(anchor))) broken.push(`${relOf(file)} -> ${link.url}`);
    }
  }
  expect(broken).toEqual([]);
});

// BK-DATA-021 — warning-level: report duplicate-heading anchor ambiguity, don't fail
test("【锚点与交叉引用 / DATA】 BK-DATA-021 标题重复导致的锚点歧义检测", () => {
  const ambiguous: string[] = [];
  for (const file of allMarkdown()) {
    const counts: Record<string, number> = {};
    for (const h of headings(readText(relOf(file)))) {
      const s = slug(h);
      counts[s] = (counts[s] || 0) + 1;
    }
    for (const s of Object.keys(counts)) {
      if (counts[s] > 1) ambiguous.push(`${relOf(file)} slug="${s}" x${counts[s]} (auto -1/-2 suffixes)`);
    }
  }
  // detection ran; findings are reported (warning-level only, not a failure)
  expect(Array.isArray(ambiguous)).toBe(true);
  if (ambiguous.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`BK-DATA-021 duplicate heading slugs (${ambiguous.length}):\n  ${ambiguous.join('\n  ')}`);
  }
});
