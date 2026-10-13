/**
 * marketplace — data validation (MP-DATA-004 .. MP-DATA-050).
 *
 * No live service: every case is a hard assertion against the on-disk repo at
 * MARKETPLACE_REPO_PATH. Style follows index.spec.ts (existsSync + JSON.parse).
 * See docs/test-cases/marketplace.md for the per-case 前置条件/步骤/预期结果.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { test, expect } from '../fixtures';
import {
  KEBAB,
  SEMVER,
  abs,
  exists,
  readJson,
  readIndex,
  readPackages,
  allSkillPackages,
  readToolsIndex,
  readToolsPackages,
  readSkillSchema,
  readToolSchema,
  isLocalizedText,
  unknownTopLevelKeys,
  parentFolder,
  label,
  repoPath,
} from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// 一、文件与解析 (MP-DATA-004 .. 007)
// ─────────────────────────────────────────────────────────────────────────────

test("【文件与解析 / DATA】 MP-DATA-004 tools/index.json 存在且为合法 JSON 数组", () => {
  expect(exists('tools/index.json'), 'tools/index.json missing').toBe(true);
  const tools = readToolsIndex();
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBeGreaterThan(0);
});

test("【文件与解析 / DATA】 MP-DATA-005 tools/packages.json 存在且为合法 JSON 数组", () => {
  const pkgs = readToolsPackages();
  expect(Array.isArray(pkgs)).toBe(true);
  expect(pkgs.length).toBe(readToolsIndex().length);
});

test("【文件与解析 / DATA】 MP-DATA-006 schemas 目录含两个 JSON Schema 且合法", () => {
  for (const rel of ['schemas/skill.schema.json', 'schemas/tool-server.schema.json']) {
    expect(exists(rel), `${rel} missing`).toBe(true);
    const schema = readJson<Record<string, unknown>>(rel);
    expect(schema['$schema'], `${rel} $schema`).toBeDefined();
    expect(schema['type'], `${rel} type`).toBe('object');
    expect(Array.isArray(schema['required']), `${rel} required[]`).toBe(true);
  }
});

test("【文件与解析 / DATA】 MP-DATA-007 templates 起始模板存在且为合法 JSON", () => {
  const skillSchema = readSkillSchema();
  const skillTpl = readJson<Record<string, unknown>>('templates/skill.json');
  for (const field of skillSchema.required as string[]) {
    expect(skillTpl[field], `templates/skill.json missing ${field}`).toBeDefined();
  }
  const toolSchema = readToolSchema();
  const toolTpl = readJson<Record<string, unknown>>('templates/tool-server.json');
  for (const field of toolSchema.required as string[]) {
    expect(toolTpl[field], `templates/tool-server.json missing ${field}`).toBeDefined();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 二、Schema 校验:技能包 (MP-DATA-008 .. 020) — packages.json cn/en groups
// ─────────────────────────────────────────────────────────────────────────────

test("【Schema 校验:技能包 / DATA】 MP-DATA-008 技能包含全部必填字段", () => {
  const required = readSkillSchema().required as string[];
  for (const { pkg } of allSkillPackages()) {
    for (const field of required) {
      expect(pkg[field], `skill ${label(pkg)} missing ${field}`).toBeDefined();
    }
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-009 schemaVersion 恒为 \"1.0\"", () => {
  for (const { pkg } of allSkillPackages()) {
    expect(pkg.schemaVersion, `skill ${label(pkg)}`).toBe('1.0');
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-010 id 符合 kebab-case 正则", () => {
  for (const { pkg } of allSkillPackages()) {
    expect(pkg.id, `skill ${label(pkg)}`).toMatch(KEBAB);
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-011 version 符合 semver 正则", () => {
  for (const { pkg } of allSkillPackages()) {
    expect(pkg.version, `skill ${label(pkg)}`).toMatch(SEMVER);
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-012 name / description 为 localizedText", () => {
  for (const { pkg } of allSkillPackages()) {
    expect(isLocalizedText(pkg.name), `skill ${label(pkg)} name`).toBe(true);
    if (pkg.description !== undefined) {
      expect(isLocalizedText(pkg.description), `skill ${label(pkg)} description`).toBe(true);
    }
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-013 launch 满足 oneOf 约束", () => {
  for (const { pkg } of allSkillPackages()) {
    const launch = pkg.launch;
    expect(launch, `skill ${label(pkg)} launch`).toBeDefined();
    expect(['chat', 'workspace', 'external']).toContain(launch.type);
    const keys = Object.keys(launch).sort();
    if (launch.type === 'chat') expect(keys).toEqual(['type']);
    if (launch.type === 'workspace') {
      expect(typeof launch.target).toBe('string');
      expect(keys).toEqual(['target', 'type']);
    }
    if (launch.type === 'external') {
      expect(typeof launch.url).toBe('string');
      expect(keys).toEqual(['type', 'url']);
    }
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-014 instructions 满足 oneOf 约束", () => {
  for (const { pkg } of allSkillPackages()) {
    const ins = pkg.instructions;
    expect(ins, `skill ${label(pkg)} instructions`).toBeDefined();
    expect(['inline', 'file']).toContain(ins.type);
    if (ins.type === 'inline') {
      expect(typeof ins.content, `skill ${label(pkg)} inline content`).toBe('string');
      expect(ins.content.length).toBeGreaterThan(0);
    } else {
      expect(typeof ins.path, `skill ${label(pkg)} file path`).toBe('string');
      expect(ins.path.length).toBeGreaterThan(0);
    }
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-015 icon 结构合法", () => {
  for (const { pkg } of allSkillPackages()) {
    if (pkg.icon === undefined) continue;
    expect(['emoji', 'builtin', 'url'], `skill ${label(pkg)} icon.type`).toContain(pkg.icon.type);
    expect(typeof pkg.icon.value, `skill ${label(pkg)} icon.value`).toBe('string');
    expect(pkg.icon.value.length).toBeGreaterThan(0);
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-016 visibility.scope 属枚举", () => {
  for (const { pkg } of allSkillPackages()) {
    if (pkg.visibility === undefined) continue;
    expect(['private', 'organization', 'public'], `skill ${label(pkg)}`).toContain(
      pkg.visibility.scope,
    );
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-017 permissions 含必填四字段", () => {
  for (const { pkg } of allSkillPackages()) {
    if (pkg.permissions === undefined) continue;
    const p = pkg.permissions;
    expect(typeof p.network, `skill ${label(pkg)} network`).toBe('boolean');
    expect(typeof p.filesystem, `skill ${label(pkg)} filesystem`).toBe('boolean');
    expect(typeof p.wallet, `skill ${label(pkg)} wallet`).toBe('boolean');
    expect(Array.isArray(p.externalTools), `skill ${label(pkg)} externalTools`).toBe(true);
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-018 release.status / review 属枚举", () => {
  for (const { pkg } of allSkillPackages()) {
    if (pkg.release === undefined) continue;
    expect(['draft', 'published', 'deprecated', 'removed'], `skill ${label(pkg)} status`).toContain(
      pkg.release.status,
    );
    if (pkg.release.review !== undefined) {
      expect(['pending', 'approved', 'rejected'], `skill ${label(pkg)} review`).toContain(
        pkg.release.review,
      );
    }
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-019 toolServers[] 结构与 transport 枚举", () => {
  for (const { pkg } of allSkillPackages()) {
    for (const ts of pkg.toolServers ?? []) {
      expect(typeof ts.id, `skill ${label(pkg)} toolServer id`).toBe('string');
      expect(ts.name, `skill ${label(pkg)} toolServer name`).toBeDefined();
      expect(['stdio', 'http', 'sse'], `skill ${label(pkg)} transport`).toContain(ts.transport);
      expect(typeof ts.required, `skill ${label(pkg)} required`).toBe('boolean');
    }
  }
});

test("【Schema 校验:技能包 / DATA】 MP-DATA-020 技能包无未知字段(additionalProperties=false)", () => {
  const schema = readSkillSchema();
  for (const { pkg } of allSkillPackages()) {
    expect(unknownTopLevelKeys(pkg, schema), `skill ${label(pkg)} unknown keys`).toEqual([]);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 三、Schema 校验:Tool Server 包 (MP-DATA-021 .. 027) — tools/packages.json
// ─────────────────────────────────────────────────────────────────────────────

test("【Schema 校验:Tool Server 包 / DATA】 MP-DATA-021 Tool Server 含全部必填字段", () => {
  const required = readToolSchema().required as string[];
  for (const pkg of readToolsPackages()) {
    for (const field of required) {
      expect(pkg[field], `tool ${pkg.id} missing ${field}`).toBeDefined();
    }
  }
});

test("【Schema 校验:Tool Server 包 / DATA】 MP-DATA-022 Tool Server id 符合 kebab-case", () => {
  for (const pkg of readToolsPackages()) {
    expect(pkg.id).toMatch(KEBAB);
  }
});

test("【Schema 校验:Tool Server 包 / DATA】 MP-DATA-023 configurable 为布尔", () => {
  for (const pkg of readToolsPackages()) {
    expect(typeof pkg.configurable, `tool ${pkg.id}`).toBe('boolean');
  }
});

test("【Schema 校验:Tool Server 包 / DATA】 MP-DATA-024 release.status / review 属 Tool Server 枚举", () => {
  for (const pkg of readToolsPackages()) {
    expect(['published', 'draft', 'removed'], `tool ${pkg.id} status`).toContain(pkg.release.status);
    expect(['approved', 'pending', 'rejected'], `tool ${pkg.id} review`).toContain(
      pkg.release.review,
    );
  }
});

test("【Schema 校验:Tool Server 包 / DATA】 MP-DATA-025 command 非空且 baseArgs 为字符串数组", () => {
  for (const pkg of readToolsPackages()) {
    expect(typeof pkg.command, `tool ${pkg.id} command`).toBe('string');
    expect(pkg.command.length).toBeGreaterThan(0);
    expect(Array.isArray(pkg.baseArgs), `tool ${pkg.id} baseArgs`).toBe(true);
    for (const a of pkg.baseArgs) expect(typeof a, `tool ${pkg.id} baseArg`).toBe('string');
  }
});

test("【Schema 校验:Tool Server 包 / DATA】 MP-DATA-026 configurable=true 时提供 configSchema", () => {
  for (const pkg of readToolsPackages()) {
    if (pkg.configurable !== true) continue;
    expect(pkg.configSchema, `tool ${pkg.id} configSchema`).toBeDefined();
    expect(pkg.configSchema.properties, `tool ${pkg.id} configSchema.properties`).toBeDefined();
    expect(Object.keys(pkg.configSchema.properties).length).toBeGreaterThan(0);
  }
});

test("【Schema 校验:Tool Server 包 / DATA】 MP-DATA-027 Tool Server 无未知字段", () => {
  const schema = readToolSchema();
  for (const pkg of readToolsPackages()) {
    expect(unknownTopLevelKeys(pkg, schema), `tool ${pkg.id} unknown keys`).toEqual([]);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 四、条目唯一性与一致性 (MP-DATA-029 .. 037) — 028 already in index.spec.ts
// ─────────────────────────────────────────────────────────────────────────────

test("【条目唯一性与一致性 / DATA】 MP-DATA-029 index 条目含 version/path/release", () => {
  for (const e of readIndex()) {
    expect(typeof e.version, `entry ${e.id} version`).toBe('string');
    expect(typeof e.path, `entry ${e.id} path`).toBe('string');
    expect(e.release, `entry ${e.id} release`).toBeDefined();
    expect(typeof e.release?.status, `entry ${e.id} release.status`).toBe('string');
  }
});

test("【条目唯一性与一致性 / DATA】 MP-DATA-030 (id, lang) 组合唯一", () => {
  const seen = new Set<string>();
  for (const e of readIndex()) {
    const key = `${e.lang}:${e.id}`;
    expect(seen.has(key), `duplicate ${key}`).toBe(false);
    seen.add(key);
  }
});

test("【条目唯一性与一致性 / DATA】 MP-DATA-031 同一 lang 内 id 不重复", () => {
  for (const lang of ['cn', 'en']) {
    const ids = readIndex()
      .filter((e) => e.lang === lang)
      .map((e) => e.id);
    expect(new Set(ids).size, `duplicate id within lang ${lang}`).toBe(ids.length);
  }
});

test("【条目唯一性与一致性 / DATA】 MP-DATA-032 lang 取值属 {cn, en}", () => {
  for (const e of readIndex()) {
    expect(['cn', 'en'], `entry ${e.id}`).toContain(e.lang);
  }
});

test("【条目唯一性与一致性 / DATA】 MP-DATA-033 index 的 version 符合 semver", () => {
  for (const e of readIndex()) {
    expect(e.version, `entry ${e.id}`).toMatch(SEMVER);
  }
});

test("【条目唯一性与一致性 / DATA】 MP-DATA-034 index.id 与源文件父目录名一致", () => {
  for (const e of readIndex()) {
    expect(parentFolder(e.path), `entry ${e.id} path ${e.path}`).toBe(e.id);
  }
});

test("【条目唯一性与一致性 / DATA】 MP-DATA-035 index 与 packages 一致", () => {
  const index = readIndex();
  const groups = readPackages();
  // Every index entry has a matching package with the same version.
  for (const e of index) {
    const group = groups[e.lang as 'cn' | 'en'] ?? [];
    const pkg = group.find((p) => p.id === e.id);
    expect(pkg, `no package for ${e.lang}:${e.id}`).toBeDefined();
    expect(pkg!.version, `version mismatch for ${e.lang}:${e.id}`).toBe(e.version);
  }
  // Reverse: every package appears in the index (no orphan packages).
  for (const lang of ['cn', 'en'] as const) {
    for (const pkg of groups[lang] ?? []) {
      const entry = index.find((e) => e.lang === lang && e.id === pkg.id);
      expect(entry, `orphan package ${lang}:${pkg.id}`).toBeDefined();
    }
  }
});

test("【条目唯一性与一致性 / DATA】 MP-DATA-036 tools/index id 唯一且与 tools/packages 一致", () => {
  const idx = readToolsIndex();
  const pkgs = readToolsPackages();
  const ids = idx.map((t) => t.id);
  expect(new Set(ids).size, 'duplicate tool id in tools/index.json').toBe(ids.length);
  for (const t of idx) {
    const pkg = pkgs.find((p) => p.id === t.id);
    expect(pkg, `no tool package for ${t.id}`).toBeDefined();
    expect(pkg!.version, `tool version mismatch for ${t.id}`).toBe(t.version);
  }
  for (const pkg of pkgs) {
    expect(idx.find((t) => t.id === pkg.id), `orphan tool package ${pkg.id}`).toBeDefined();
  }
});

test("【条目唯一性与一致性 / DATA】 MP-DATA-037 codex 技能不进入 index / packages", () => {
  const codexDir = abs('skills/codex');
  if (!existsSync(codexDir)) {
    test.skip(true, 'skills/codex absent');
    return;
  }
  const codexIds = readdirSync(codexDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  expect(codexIds.length).toBeGreaterThan(0);
  const indexIds = new Set(readIndex().map((e) => e.id));
  const pkgIds = new Set(allSkillPackages().map(({ pkg }) => pkg.id));
  for (const cid of codexIds) {
    expect(indexIds.has(cid), `codex skill ${cid} leaked into index.json`).toBe(false);
    expect(pkgIds.has(cid), `codex skill ${cid} leaked into packages.json`).toBe(false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 五、引用与资源完整性 (MP-DATA-038 .. 045)
// ─────────────────────────────────────────────────────────────────────────────

test("【引用与资源完整性 / DATA】 MP-DATA-038 index.path 指向真实存在的源文件", () => {
  for (const e of readIndex()) {
    expect(existsSync(abs(e.path)), `dangling index path ${e.path}`).toBe(true);
  }
});

test("【引用与资源完整性 / DATA】 MP-DATA-039 tools/index.path 指向真实存在的文件", () => {
  for (const t of readToolsIndex()) {
    expect(existsSync(abs(t.path)), `dangling tool path ${t.path}`).toBe(true);
  }
});

test("【引用与资源完整性 / DATA】 MP-DATA-040 技能 toolServers[].id 引用真实存在的 Tool Server", () => {
  const toolIds = new Set(readToolsIndex().map((t) => t.id));
  for (const { pkg } of allSkillPackages()) {
    for (const ts of pkg.toolServers ?? []) {
      expect(toolIds.has(ts.id), `skill ${label(pkg)} references unknown tool ${ts.id}`).toBe(true);
    }
  }
});

test("【引用与资源完整性 / DATA】 MP-DATA-041 permissions.externalTools 与工具依赖一致", () => {
  for (const { pkg } of allSkillPackages()) {
    const external: string[] = pkg.permissions?.externalTools ?? [];
    if (external.length === 0) continue;
    const declared = new Set<string>([
      ...(pkg.tools ?? []).map((t: { id: string }) => t.id),
      ...(pkg.toolServers ?? []).map((t: { id: string }) => t.id),
    ]);
    for (const id of external) {
      expect(declared.has(id), `skill ${label(pkg)} externalTool ${id} not declared`).toBe(true);
    }
  }
});

test("【引用与资源完整性 / DATA】 MP-DATA-042 icon.type=url 时 value 可解析", () => {
  let seen = 0;
  for (const { pkg } of allSkillPackages()) {
    if (pkg.icon?.type !== 'url') continue;
    seen++;
    expect(() => new URL(pkg.icon.value), `skill ${label(pkg)} icon url`).not.toThrow();
  }
  test.skip(seen === 0, 'no icon.type=url skills (future data guard)');
});

test("【引用与资源完整性 / DATA】 MP-DATA-043 icon.type=emoji 时 value 为合法 unicode 码点", () => {
  let seen = 0;
  for (const { pkg } of allSkillPackages()) {
    if (pkg.icon?.type !== 'emoji') continue;
    seen++;
    const value: string = pkg.icon.value;
    expect(value, `skill ${label(pkg)} emoji hex`).toMatch(/^[0-9a-fA-F]+(-[0-9a-fA-F]+)*$/);
    for (const cp of value.split('-')) {
      const n = parseInt(cp, 16);
      expect(Number.isFinite(n) && n >= 0 && n <= 0x10ffff, `bad code point ${cp}`).toBe(true);
      expect(() => String.fromCodePoint(n)).not.toThrow();
    }
  }
  test.skip(seen === 0, 'no icon.type=emoji skills');
});

test("【引用与资源完整性 / DATA】 MP-DATA-044 instructions.type=file 时 path 指向存在文件", () => {
  let seen = 0;
  for (const { pkg } of allSkillPackages()) {
    if (pkg.instructions?.type !== 'file') continue;
    seen++;
    // Resolve relative to the skill package directory when known, else repo root.
    const idxEntry = readIndex().find((e) => e.id === pkg.id);
    const base = idxEntry ? resolve(repoPath(), idxEntry.path, '..') : repoPath();
    expect(existsSync(resolve(base, pkg.instructions.path)), `dangling instruction file`).toBe(true);
  }
  test.skip(seen === 0, 'all instructions are inline (future data guard)');
});

test("【引用与资源完整性 / DATA】 MP-DATA-045 npx @yeying-community 包有本地源码", () => {
  let seen = 0;
  for (const pkg of readToolsPackages()) {
    if (pkg.command !== 'npx') continue;
    const arg = (pkg.baseArgs as string[]).find((a) => a.startsWith('@yeying-community/'));
    if (!arg) continue;
    seen++;
    const name = arg.slice('@yeying-community/'.length);
    const dir = abs(`tools/packages/${name}`);
    expect(existsSync(dir), `missing local source dir ${dir}`).toBe(true);
    expect(existsSync(resolve(dir, 'package.json')), `missing package.json in ${dir}`).toBe(true);
  }
  expect(seen, 'expected at least one @yeying-community tool package').toBeGreaterThan(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 六、分类、标签与排序 (MP-DATA-046 .. 050)
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_CATEGORIES = new Set(['productivity', 'finance', 'research']);

test("【分类、标签与排序 / DATA】 MP-DATA-046 category 为非空字符串且属已知集合", () => {
  for (const e of readIndex()) {
    expect(typeof e.category, `entry ${e.id} category type`).toBe('string');
    expect((e.category ?? '').length).toBeGreaterThan(0);
    expect(KNOWN_CATEGORIES.has(e.category ?? ''), `entry ${e.id} unknown category ${e.category}`).toBe(
      true,
    );
  }
});

test("【分类、标签与排序 / DATA】 MP-DATA-047 tags 为字符串数组且元素唯一", () => {
  const check = (tags: unknown, who: string) => {
    if (tags === undefined) return;
    expect(Array.isArray(tags), `${who} tags`).toBe(true);
    const arr = tags as unknown[];
    for (const t of arr) expect(typeof t, `${who} tag`).toBe('string');
    expect(new Set(arr as string[]).size, `${who} duplicate tags`).toBe(arr.length);
  };
  for (const e of readIndex()) check(e.tags, `index ${e.id}`);
  for (const { pkg } of allSkillPackages()) check(pkg.tags, `package ${label(pkg)}`);
});

test("【分类、标签与排序 / DATA】 MP-DATA-048 packages.json 按 cn/en 分组且每组为数组", () => {
  const groups = readPackages() as Record<string, unknown>;
  expect(typeof groups, 'packages.json top-level').toBe('object');
  expect('cn' in groups, 'cn group').toBe(true);
  expect('en' in groups, 'en group').toBe(true);
  expect(Array.isArray(groups['cn']), 'cn array').toBe(true);
  expect(Array.isArray(groups['en']), 'en array').toBe(true);
});

test("【分类、标签与排序 / DATA】 MP-DATA-049 index 条目按 id 稳定排序", () => {
  const chatDir = abs('skills/chat');
  const folders = readdirSync(chatDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const expected: string[] = [];
  for (const folder of folders) {
    for (const lang of ['cn', 'en']) {
      if (existsSync(resolve(chatDir, folder, `${lang}.json`))) expected.push(`${lang}:${folder}`);
    }
  }
  const actual = readIndex().map((e) => `${e.lang}:${e.id}`);
  expect(actual).toEqual(expected);
});

test("【分类、标签与排序 / DATA】 MP-DATA-050 tools/index 按文件名稳定排序", () => {
  const files = readdirSync(abs('tools/servers'))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const expected = files.map((f) => basename(f, '.json'));
  const actual = readToolsIndex().map((t) => t.id);
  expect(actual).toEqual(expected);
});
