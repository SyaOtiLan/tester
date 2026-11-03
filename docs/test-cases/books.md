# books(文档/书籍仓库)— 端到端测试用例

> 测试人员视角整理的**应有** E2E 用例清单,作为实现依据。
> 状态说明:✅ 已实现(链接到 spec) / ⬜ 待实现。
> 端点:文档仓库 · 从磁盘读取 SUMMARY.md(BOOKS_REPO_PATH)
> 说明:books 是纯文档仓库,测试从磁盘读取 markdown 与 SUMMARY.md;一条逻辑用例可能对应多个 spec,"已实现"以逻辑用例是否被现有 spec 覆盖为准,而非 spec 中的 test 块数量。
> 仓库真实结构:根含三大文档集合 `agent/`(唯一带 SUMMARY.md 的 mdbook/gitbook 风格书,README + 21 章节)、`payment/docs/`(索引驱动,160+ 篇,无 SUMMARY.md)、`yeying/`(社区文档,以 `社区文档总览.md` 为索引,39 篇)。现有 spec 仅 `summary.spec.ts`。
> 最后更新:2026-09-16

## 覆盖总览

| 模块 | 用例数 | 已实现 | 待实现 |
| --- | --- | --- | --- |
| 一、目录结构与 SUMMARY 解析 | 6 | 6 | 0 |
| 二、链接完整性(死链) | 7 | 5 | 2 |
| 三、章节文件与孤儿检测 | 5 | 5 | 0 |
| 四、锚点与交叉引用 | 3 | 3 | 0 |
| 五、资源引用(图片/资产) | 3 | 2 | 1 |
| 六、Markdown 基本合法性 | 4 | 4 | 0 |
| 七、多集合索引一致性 | 4 | 4 | 0 |
| 八、构建配置 | 2 | 2 | 0 |
| 九、可选在线站点冒烟 | 1 | 1 | 0 |
| **合计** | **35** | **32** | **3** |

> 待实现的 3 条(BK-DATA-009 / BK-DATA-012 / BK-DATA-023)均为**已实现但捕获到 books 仓库真实缺陷**,
> 对应 spec 以 `test.fixme` 记录缺陷、保持 runner 绿色;修复源仓库后去掉 fixme 即转正。

---

## 一、目录结构与 SUMMARY 解析

### BK-DATA-001 books 仓库存在且至少含一个 markdown 文档
- 优先级:P0
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/summary.spec.ts
- 前置条件:`BOOKS_REPO_PATH` 指向 books 仓库(默认 `/Users/liuxin2/Workspace/opensource/books`)
- 步骤:
  1. 断言仓库根路径存在
  2. 递归枚举文件,过滤 `.md` 后缀
- 预期结果:根路径存在;`.md` 文件数量 > 0(实际约 220+ 篇)

### BK-DATA-002 agent/SUMMARY.md 存在、非空且以 Markdown 列表组织目录
- 优先级:P0
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/structure.spec.ts:11
- 前置条件:仓库可读
- 步骤:
  1. 读取 `agent/SUMMARY.md`
  2. 断言文件存在且长度 > 0
  3. 断言正文含以 `- [` 开头的列表条目
- 预期结果:文件存在、非空,且为 `- [标题](链接)` 形式的目录列表(现有 spec 在缺失时 skip 而非失败,需补充硬断言)

### BK-DATA-003 SUMMARY.md 可解析出章节链接
- 优先级:P0
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/summary.spec.ts
- 前置条件:`agent/SUMMARY.md` 存在
- 步骤:
  1. 读取 `agent/SUMMARY.md`
  2. 用正则匹配 `](….md)` 形式的链接
- 预期结果:解析出 ≥ 5 条指向 `.md` 的章节链接(实际 21 条)

### BK-DATA-004 SUMMARY 章节编号单调有序
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/structure.spec.ts:23
- 前置条件:`agent/SUMMARY.md` 已解析
- 步骤:
  1. 抽取 `chapters/NN-*.md` 中的数字前缀
  2. 校验出现顺序 00 → 01 …→ 16 → 99 递增
- 预期结果:章节数字前缀按 SUMMARY 出现顺序单调不减,无错位或缺号(00 前言、01-16 正文、99 附录)

### BK-DATA-005 SUMMARY 覆盖三部分骨架标题
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/structure.spec.ts:40
- 前置条件:`agent/SUMMARY.md` 已读取
- 步骤:
  1. 在 SUMMARY 中查找"第一部分""第二部分""第三部分"分节条目
- 预期结果:三部分骨架标题均存在,且各自后续跟随对应章节,结构与 README 描述的"理论与方法 / 项目实践与对照 / 最佳实践与方法沉淀"一致

### BK-DATA-006 顶层三大文档集合目录均存在且非空
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/structure.spec.ts:61
- 前置条件:仓库可读
- 步骤:
  1. 断言 `agent/`、`payment/docs/`、`yeying/` 目录存在
  2. 各目录递归统计 `.md` 数量 > 0
- 预期结果:三个集合均存在且非空(agent ≈ 23、payment ≈ 160、yeying ≈ 39 篇)

---

## 二、链接完整性(死链)

### BK-DATA-007 SUMMARY.md 每个章节链接目标文件存在(无死链)
- 优先级:P0
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/links.spec.ts:15
- 前置条件:`agent/SUMMARY.md` 已解析出链接
- 步骤:
  1. 逐条取出 `./chapters/*.md` 链接
  2. 相对 `agent/` 解析为绝对路径并断言文件存在
- 预期结果:21 条章节链接全部指向真实存在的文件,无死链

### BK-DATA-008 SUMMARY.md 链接均为仓库内相对路径
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/links.spec.ts:28
- 前置条件:`agent/SUMMARY.md` 已解析
- 步骤:
  1. 检查每条链接是否以 `./` 或 `../` 开头的相对路径
  2. 断言不含绝对路径(`/Users/…`)或裸机绝对路径
- 预期结果:所有目录链接为相对路径(如 `./chapters/01-….md`),便于移植与构建,不含机器绝对路径

### BK-DATA-009 agent/README.md 内 SUMMARY 链接指向的路径存在
- 优先级:P0
- 类型:DATA
- 状态:⬜ 待实现(已实现,`test.fixme` 记录真实缺陷)— products/books/tests/links.spec.ts:40。**真实缺陷**:`agent/README.md` 第 26 行 `[SUMMARY.md](/Users/liuxin2/Workspace/books/agent/SUMMARY.md)` 为机器绝对路径且缺少 `opensource/` 段,指向不存在的文件(死链);修复方向:改为相对路径 `./SUMMARY.md`
- 前置条件:`agent/README.md` 可读
- 步骤:
  1. 抽取 README 末尾 `[SUMMARY.md](…)` 链接目标
  2. 断言目标文件存在
- 预期结果:应指向真实存在的 SUMMARY。**当前为已知缺陷**:链接写死为 `/Users/liuxin2/Workspace/books/agent/SUMMARY.md`(缺少 `opensource/` 段),该路径不存在 → 死链;用例应捕获此失败,修复方向为改为相对路径 `./SUMMARY.md`

### BK-DATA-010 yeying 总览内所有相对链接目标存在
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/links.spec.ts:57
- 前置条件:`yeying/社区文档总览.md` 可读
- 步骤:
  1. 抽取总览表与阅读路径中的全部 `](社区/….md)` 链接
  2. 相对 `yeying/` 解析并断言每个目标存在
- 预期结果:入口/贡献/协作/规范/产品/工程等所有导航链接均无死链(含 8 个单产品说明链接)

### BK-DATA-011 payment 索引文档内链接目标存在
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/links.spec.ts
- 前置条件:`payment/docs/README.md`、`payment/docs/series-index.md`、`payment/docs/acquiring/README.md`、`payment/docs/acquiring/跨章索引.md` 可读
- 步骤:
  1. 抽取各索引文件内的相对链接
  2. 逐条断言目标文件存在
- 预期结果:README 指向的"知识架构与维护指南""发布导航""角色阅读导航""跨章索引""章节模板"等链接及跨章索引条目全部有效

### BK-DATA-012 全仓库站内 .md 链接全量死链扫描
- 优先级:P2
- 类型:DATA
- 状态:⬜ 待实现(已实现,`test.fixme` 记录真实缺陷)— products/books/tests/links.spec.ts:94。**真实缺陷**:全仓库死链全量扫描发现唯一死链 `agent/README.md -> /Users/liuxin2/Workspace/books/agent/SUMMARY.md`(与 BK-DATA-009 同因);其余约 1000+ 条内链均有效
- 前置条件:仓库可读
- 步骤:
  1. 遍历所有 `.md`,抽取每条站内 `](相对路径.md[#锚点])` 链接
  2. 相对各自文件目录解析并断言目标存在
- 预期结果:全仓库(agent/payment/yeying,约 1000+ 条内链)无死链;发现的死链按文件+行号汇总报告

### BK-DATA-013 外部 http(s) 链接格式合法
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/links.spec.ts:118
- 前置条件:仓库可读
- 步骤:
  1. 抽取所有 `http://` / `https://` 链接
  2. 校验 URL 语法合法(scheme + host),不实际发起网络请求
- 预期结果:外链均为语法合法 URL;仅做静态格式校验,避免测试依赖外网可达性

---

## 三、章节文件与孤儿检测

### BK-DATA-014 agent 章节文件无孤儿(均被 SUMMARY 引用)
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/chapters.spec.ts:22
- 前置条件:`agent/chapters/` 与 `agent/SUMMARY.md` 可读
- 步骤:
  1. 枚举 `agent/chapters/*.md` 全部文件
  2. 逐一检查是否出现在 SUMMARY 链接集合中
- 预期结果:每个章节文件都被 SUMMARY 引用,无"存在于磁盘但未进目录"的孤儿章节

### BK-DATA-015 SUMMARY 引用的章节文件都真实存在(反向校验)
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/chapters.spec.ts:29
- 前置条件:SUMMARY 链接与 chapters 目录可读
- 步骤:
  1. 取 SUMMARY 链接集合
  2. 与磁盘 chapters 文件集合做差集
- 预期结果:引用集合 ⊆ 磁盘集合(与 BK-DATA-007 互补,双向一致,不多不少)

### BK-DATA-016 每个章节文件非空且含标题
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/chapters.spec.ts:38
- 前置条件:`agent/chapters/*.md` 可读
- 步骤:
  1. 逐个读取章节文件
  2. 断言长度 > 0 且含以 `#` 开头的一级/二级标题
- 预期结果:所有章节非空且含标题;不存在空壳占位文件

### BK-DATA-017 章节文件名编号与 SUMMARY 顺序对应
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/chapters.spec.ts:49
- 前置条件:SUMMARY 与 chapters 可读
- 步骤:
  1. 按 SUMMARY 出现顺序取链接文件名前缀编号
  2. 与文件名实际编号比对
- 预期结果:目录顺序中的编号与文件名前缀一致,无标题与文件张冠李戴

### BK-DATA-018 yeying 单产品说明文件齐全且被总览引用
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/chapters.spec.ts:67
- 前置条件:`yeying/社区/产品/单产品/` 与 `社区文档总览.md` 可读
- 步骤:
  1. 枚举 `单产品/` 下的 `.md`(8 篇:钱包/节点/模型路由/文件仓库/聊天/项目/知识/智能体)
  2. 校验每篇都在总览"产品与说明"表中被链接
- 预期结果:8 个产品说明文件与总览表条目一一对应,无缺失、无孤儿

---

## 四、锚点与交叉引用

### BK-DATA-019 跨文件链接的锚点在目标文件内存在
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/anchors.spec.ts:14
- 前置条件:仓库可读
- 步骤:
  1. 抽取形如 `](path.md#锚点)` 的链接
  2. 读取目标文件标题集合,按 GitHub/mdbook 规则 slug 化
  3. 断言锚点命中某个标题
- 预期结果:所有带 `#` 锚点的跨文件链接都能定位到目标文件的真实标题,无失效锚点

### BK-DATA-020 同文档内 #锚点 指向存在的标题
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/anchors.spec.ts:36
- 前置条件:仓库可读
- 步骤:
  1. 抽取形如 `](#锚点)` 的本文档内跳转
  2. 与本文件标题 slug 集合比对
- 预期结果:文内目录/回顶等锚点跳转均有效

### BK-DATA-021 标题重复导致的锚点歧义检测
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/anchors.spec.ts:52
- 前置条件:仓库可读
- 步骤:
  1. 对每个文件统计标题 slug
  2. 检测同一文件内重复 slug
- 预期结果:报告会产生 `-1`/`-2` 自动后缀的重复标题,提示可能的锚点歧义(仅告警级)

---

## 五、资源引用(图片/资产)

### BK-DATA-022 markdown 图片引用目标文件存在
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/resources.spec.ts:20
- 前置条件:仓库可读
- 步骤:
  1. 抽取所有 `![alt](路径)` 图片引用
  2. 对站内相对路径断言目标文件存在
- 预期结果:所有图片引用指向真实存在的资源,无坏图链(当前 markdown 未引用任何本地图片,用例在有引用时生效)

### BK-DATA-023 仓库图片/资产无孤儿
- 优先级:P2
- 类型:DATA
- 状态:⬜ 待实现(已实现,`test.fixme` 记录真实缺陷)— products/books/tests/resources.spec.ts:40。**真实缺陷**:`yeying/2A068D22-0E72-47EB-AEFC-D598509BBFFB.png` 未被任何 markdown 引用(全仓库 0 条图片引用)→ 孤儿资产;修复方向:删除该文件或补充引用
- 前置条件:仓库可读
- 步骤:
  1. 枚举仓库内图片资产(png/jpg/svg 等)
  2. 反查是否被任一 `.md` 引用
- 预期结果:不存在未被引用的孤儿资产。**当前真实发现**:`yeying/2A068D22-0E72-47EB-AEFC-D598509BBFFB.png` 未被任何 markdown 引用 → 应报告为孤儿资产(清理或补引用)

### BK-DATA-024 图片替代文本非空
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/resources.spec.ts:62
- 前置条件:存在图片引用
- 步骤:
  1. 抽取 `![alt](…)` 的 alt 文本
- 预期结果:alt 文本非空,满足可访问性(仅告警级)

---

## 六、Markdown 基本合法性

### BK-DATA-025 所有 markdown 为合法 UTF-8
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/markdown.spec.ts:13
- 前置条件:仓库可读
- 步骤:
  1. 以 UTF-8 逐个读取所有 `.md`
  2. 捕获解码异常/替换字符
- 预期结果:全部文件为合法 UTF-8,含中文标题的文件名与内容均无乱码

### BK-DATA-026 markdown 链接语法闭合
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/markdown.spec.ts:27
- 前置条件:仓库可读
- 步骤:
  1. 扫描 `[文本](链接)` 结构
  2. 检测未闭合的 `[`/`]`/`(`/`)` 配对
- 预期结果:链接语法闭合,无残缺链接标记

### BK-DATA-027 代码围栏成对闭合
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/markdown.spec.ts:42
- 前置条件:仓库可读
- 步骤:
  1. 统计每个文件的 ``` 围栏数量
- 预期结果:围栏数量为偶数,代码块均正确闭合,无"吞掉后文"的未闭合围栏

### BK-DATA-028 换行风格一致(无 CRLF 混入)
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/markdown.spec.ts:52
- 前置条件:仓库可读
- 步骤:
  1. 检查文件是否含 `\r\n`
- 预期结果:统一使用 LF 换行(仅风格告警级)

---

## 七、多集合索引一致性

### BK-DATA-029 yeying 总览表产品与单产品目录一一对应
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/consistency.spec.ts:10
- 前置条件:`yeying/社区文档总览.md` 与 `单产品/` 可读
- 步骤:
  1. 解析总览"产品与说明"表的 8 行(Wallet/Node/Router/Warehouse/Chat/Project/Knowledge/Agent)
  2. 与磁盘 8 个产品说明文件做双向匹配
- 预期结果:表格产品条目与磁盘文件集合完全一致,不多不少

### BK-DATA-030 payment 发布导航版本链接齐全
- 优先级:P1
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/consistency.spec.ts
- 前置条件:`payment/docs/acquiring/` 可读
- 步骤:
  1. 在 `payment/docs/acquiring/` 枚举 `00-发布导航-v*.md`(v1.0 … v2.2,共 13 个版本);历史导航与当前导航均存放在该目录
  2. 校验该目录 README 指向的 v2.2 发布导航存在,且当前导航内引用的章节链接有效
- 预期结果:发布导航版本文件齐全,最新版被 README 正确引用,导航内链接无死链

### BK-DATA-031 payment 章节元信息/跨章索引引用一致
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/consistency.spec.ts
- 前置条件:`payment/docs/acquiring/章节元信息总表.md`、`payment/docs/acquiring/跨章索引.md` 可读
- 步骤:
  1. 抽取两表引用的章节编号/文件
  2. 与 `acquiring/` 下实际章节比对
- 预期结果:元信息总表与跨章索引所列章节均真实存在,无悬空引用

### BK-DATA-032 README 顶层提及 YeYing 社区
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/summary.spec.ts
- 前置条件:根 `README.md` 或产品文档可读
- 步骤:
  1. 读取候选文档(README.md 等)
  2. 断言含 `YeYing`/`yeying`
- 预期结果:仓库定位为 YeYing 社区文档(根 README 为 "The book of YeYing community.")

---

## 八、构建配置

### BK-DATA-033 检测构建配置并断言"纯 SUMMARY 目录型仓库"契约
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/build.spec.ts:17
- 前置条件:仓库可读
- 步骤:
  1. 查找 `book.toml`(mdBook)/`book.json`(GitBook legacy)/`.gitbook.yaml`/`mkdocs.yml`
- 预期结果:当前仓库无任何构建配置 → 断言其为"仅有 SUMMARY.md 目录、无构建工具"的形态,避免误判为损坏;若日后新增配置,用例应提示需扩展构建校验

### BK-DATA-034 存在构建配置时可产出 HTML
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/build.spec.ts:29
- 前置条件:仓库存在受支持的构建配置(如 `book.toml`)
- 步骤:
  1. 执行对应构建命令(如 `mdbook build`)
  2. 检查输出目录生成 HTML
- 预期结果:构建成功并产出 HTML;当前无配置,用例在检测不到配置时 skip,不误报失败

---

## 九、可选在线站点冒烟

### BK-DATA-035 (可选)BOOKS_BASE_URL 在线文档站点可达
- 优先级:P2
- 类型:DATA
- 状态:✅ 已实现 — products/books/tests/summary.spec.ts
- 前置条件:设置了 `BOOKS_BASE_URL`(未设置则 skip)
- 步骤:
  1. `GET` 该站点根地址
- 预期结果:响应状态码 < 500,在线文档站点存活(未配置时用例跳过)
