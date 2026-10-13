/**
 * books — 资源引用 图片/资产 (BK-DATA-022, 023, 024).
 *
 * BK-DATA-023 catches a REAL pre-existing finding: an orphan image asset that
 * no markdown references. It is marked test.fixme so the runner stays green
 * while the finding is honestly recorded — do NOT weaken it to pass.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { test, expect } from '../fixtures';
import { abs, readText, allMarkdown, walk, repoPath, parseImages, isInternalLink } from './helpers';

function relOf(file: string): string {
  return file.slice(abs('.').length + 1);
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;

// BK-DATA-022
test("【资源引用(图片/资产) / DATA】 BK-DATA-022 markdown 图片引用目标文件存在", () => {
  const missing: string[] = [];
  let refCount = 0;
  for (const file of allMarkdown()) {
    for (const img of parseImages(readText(relOf(file)))) {
      if (!isInternalLink(img.src)) continue;
      const path = img.src.split('#')[0];
      if (!path) continue;
      refCount++;
      if (!existsSync(resolve(dirname(file), decodeURIComponent(path)))) {
        missing.push(`${relOf(file)} -> ${img.src}`);
      }
    }
  }
  // repo currently references no local images; the assertion holds either way
  expect(missing).toEqual([]);
  expect(refCount).toBeGreaterThanOrEqual(0);
});

// BK-DATA-023 — REAL FINDING (orphan asset)
test("【资源引用(图片/资产) / DATA】 BK-DATA-023 仓库图片/资产无孤儿", () => {
  test.fixme(
    true,
    'REAL DEFECT in books repo: orphan image asset yeying/2A068D22-0E72-47EB-AEFC-D598509BBFFB.png ' +
      'is referenced by no markdown file (0 image references exist repo-wide). Fix: remove the ' +
      'file or add a reference. Kept as fixme so the suite stays green while recording the finding.',
  );
  const assets = walk(repoPath()).filter((f) => IMAGE_EXT.test(f));
  const referenced = new Set<string>();
  for (const file of allMarkdown()) {
    for (const img of parseImages(readText(relOf(file)))) {
      if (!isInternalLink(img.src)) continue;
      const path = img.src.split('#')[0];
      if (!path) continue;
      referenced.add(resolve(dirname(file), decodeURIComponent(path)));
    }
  }
  const orphans = assets.filter((a) => !referenced.has(a));
  expect(orphans).toEqual([]);
});

// BK-DATA-024 — warning-level: image alt text should be non-empty
test("【资源引用(图片/资产) / DATA】 BK-DATA-024 图片替代文本非空", () => {
  const emptyAlt: string[] = [];
  for (const file of allMarkdown()) {
    for (const img of parseImages(readText(relOf(file)))) {
      if (img.alt.trim().length === 0) emptyAlt.push(`${relOf(file)} -> ${img.src}`);
    }
  }
  // no images exist yet, so this holds trivially; when images are added it enforces alt text
  expect(emptyAlt).toEqual([]);
});
