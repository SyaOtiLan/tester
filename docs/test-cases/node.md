# 节点 Node — 端到端测试用例

> 测试人员视角整理的**应有** E2E 用例清单,作为实现依据。
> 状态说明:✅ 已实现(链接到 spec) / ⬜ 待实现。
> 端点:前后端同源,均由 8100 的 Express 实例托管(8991 为约定配置端口,非独立服务);API 前缀 `/api/v1/public/*`;EIP-4361 SIWE 登录
> 最后更新:2026-09-17

## 覆盖总览

| 模块 | 用例数 | 已实现 | 待实现 |
| --- | --- | --- | --- |
| 一、健康检查与就绪 | 4 | 3 | 1 |
| 二、SIWE 认证与会话 | 11 | 11 | 0 |
| 三、前端首页与导航 | 5 | 5 | 0 |
| 四、应用市场浏览 | 4 | 4 | 0 |
| 五、开发者应用生命周期 | 15 | 13 | 2 |
| 六、应用审核 | 2 | 1 | 1 |
| 七、申请使用应用 | 1 | 1 | 0 |
| 八、身份能力(TOTP/Passkey/授权码) | 4 | 4 | 0 |
| 九、通知中心 | 6 | 6 | 0 |
| 十、会话与鉴权守卫 | 2 | 2 | 0 |
| **合计** | **54** | **50** | **4** |

> 说明:后端与前端由同一 Express 实例托管,API 根路径统一为 `/api/v1/public/*`;响应统一信封 `{code, message, data, timestamp}`(成功 `code=0`)。写操作(建应用、发布、下线、删除、配置)均需在请求体内携带 `personal_sign` 的**签名动作信封**(action 分别为 `application_create` / `application_update` / `application_publish` / `application_unpublish` / `application_delete` / `application_config_upsert`)。剩余 4 个待实现均为**降级跳过**(依赖管理员审批或非破坏性造 DB 断连,环境不具备),已在对应 spec 中以 `test.skip` + 明确原因落地,绝不伪造通过。

---

## 一、健康检查与就绪

### ND-API-001 健康检查返回 ok
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:Node 后端已启动(API 8100)。
- 步骤:
  1. GET `/api/v1/public/health`。
- 预期结果:HTTP 200;`code=0`;`data.status === "ok"`,含 `data.timestamp`。

### ND-API-002 就绪检查确认数据库
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:后端已启动,数据库连接可用。
- 步骤:
  1. GET `/api/v1/public/ready`。
- 预期结果:数据库可用时 HTTP 200 且 `data.database === "ok"`;不可用时 HTTP 503 且信息为 `Database is not ready`。

### ND-API-003 健康检查向后兼容别名
- 优先级:P2
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts:199
- 前置条件:后端已启动。
- 步骤:
  1. GET `/api/v1/public/healthCheck`。
- 预期结果:HTTP 200;`data.status === "ok"`,与 `/health` 行为一致(向后兼容别名)。

### ND-API-004 数据库不可用时就绪返回 503
- 优先级:P1
- 类型:API
- 状态:⬜ 待实现(降级跳过)— products/node/tests/api.spec.ts(无法在共享实例上非破坏性地制造数据库断连,`ready` 的 200 分支已由 ND-API-002 覆盖)
- 前置条件:可模拟数据库未初始化/断连(如停库或断开连接的测试实例)。
- 步骤:
  1. 在数据库不可用状态下 GET `/api/v1/public/ready`。
- 预期结果:HTTP 503;信封 `code=503`,`message` 提示数据库未就绪;`/health` 仍返回 200(存活与就绪相互独立)。

---

## 二、SIWE 认证与会话

### ND-API-005 challenge 返回 EIP-4361 消息
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:后端已启动。
- 步骤:
  1. POST `/api/v1/public/auth/challenge`,body `{ address, chainId: 1 }`。
- 预期结果:HTTP 200;`data` 含 `challenge/nonce/domain/uri/version/chainId/issuedAt/expiresAt`;`version === "1"`;`chainId === 1`;`challenge` 文本内嵌入该地址;`nonce` 为 `[A-Za-z0-9_-]{8,}`。

### ND-API-006 challenge 缺少 address 返回 400
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:后端已启动。
- 步骤:
  1. POST `/api/v1/public/auth/challenge`,body 为空对象或缺 `address`。
- 预期结果:HTTP 400;`message` 为 `Missing address`。

### ND-API-007 verify 校验签名并签发绑定钱包的 JWT
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:已获取 challenge;持有测试钱包私钥。
- 步骤:
  1. 用 `personal_sign` 对 challenge 文本签名。
  2. POST `/api/v1/public/auth/verify`,body `{ address, signature, nonce }`。
- 预期结果:HTTP 200;`data.token` 为标准 JWT(三段式);`data.address` 与钱包地址一致(小写);返回 `expiresAt/refreshExpiresAt`;`Set-Cookie` 写入 HttpOnly refresh cookie。

### ND-API-008 verify 拒绝错误私钥的签名
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts:216
- 前置条件:已获取地址 A 的 challenge。
- 步骤:
  1. 用地址 B(不同私钥)对 A 的 challenge 签名。
  2. POST `/api/v1/public/auth/verify`,body `{ address: A, signature: 用B签名, nonce }`。
- 预期结果:HTTP 401;`message` 为 `Invalid signature`;不签发 token。

### ND-API-009 verify 拒绝过期/未知 nonce
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:后端已启动。
- 步骤:
  1. 使用一个从未签发或已消费(challenge 一次性)或已过期的 `nonce` 调 verify。
- 预期结果:HTTP 400;`message` 为 `Challenge expired`;同一 challenge 无法被重复消费(重放防护)。

### ND-API-010 verify 缺字段返回 400
- 优先级:P2
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts:246
- 前置条件:后端已启动。
- 步骤:
  1. POST `/api/v1/public/auth/verify`,分别缺 `address` / `signature` / `nonce`。
- 预期结果:HTTP 400;`message` 为 `Missing address, nonce or signature`。

### ND-API-011 profile/me 携带有效 JWT 返回身份
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:已完成 SIWE 登录并持有 access token。
- 步骤:
  1. GET `/api/v1/public/profile/me`,`Authorization: Bearer <token>`。
- 预期结果:HTTP 200;`data.address` 与登录地址一致(小写);响应含 `data.isAdmin` 等主体信息。

### ND-API-012 profile/me 缺少 JWT 被拒绝
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:后端已启动。
- 步骤:
  1. 不带 Authorization GET `/api/v1/public/profile/me`。
- 预期结果:HTTP 401 或 403,不返回身份数据。

### ND-API-013 无 refresh cookie 时 refresh 返回 401
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:全新请求上下文(无 refresh cookie)。
- 步骤:
  1. POST `/api/v1/public/auth/refresh`,body `{}`,不携带 cookie。
- 预期结果:HTTP 401;`message` 为 `Missing refresh token`。

### ND-API-014 携带 refresh cookie 刷新出新 access token
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:同一 cookie jar 内完成过 verify,已持有 refresh cookie。
- 步骤:
  1. POST `/api/v1/public/auth/refresh`,携带 verify 下发的 HttpOnly cookie。
- 预期结果:HTTP 200;返回新的 `token` 与新的过期时间;下发轮换后的 refresh cookie;旧 refresh token 失效(一次性消费)。

### ND-API-015 logout 撤销并清除 refresh cookie
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/api.spec.ts
- 前置条件:已登录并持有 refresh cookie。
- 步骤:
  1. POST `/api/v1/public/auth/logout`(携带 cookie)。
  2. 再次用同一 refresh cookie 调 `/auth/refresh`。
- 预期结果:logout 返回 200 且 `data.logout === true`,响应清除 refresh cookie;步骤 2 返回 401(refresh token 已撤销)。

---

## 三、前端首页与导航

### ND-UI-001 首页正常渲染
- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/smoke.spec.ts;products/node/tests/user-flow.spec.ts
- 前置条件:前端可访问(UI 8991)。
- 步骤:
  1. 打开 `/`。
- 预期结果:`body` 可见,渲染真实内容(非空白/非 404),正文长度 > 50。

### ND-UI-002 主导航包含预期入口
- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/smoke.spec.ts;products/node/tests/user-flow.spec.ts
- 前置条件:首页已加载。
- 步骤:
  1. 打开 `/`,统计 `a[href] / [role=link] / [role=menuitem]` 数量。
- 预期结果:至少存在一个可导航入口(应用中心/市场等)。

### ND-UI-003 登录/连接钱包入口可发现
- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/user-flow.spec.ts
- 前置条件:首页已加载。
- 步骤:
  1. 打开 `/`,查找按钮/输入/链接类可交互元素。
- 预期结果:DOM 中存在鉴权或连接钱包相关可交互控件。

### ND-UI-004 落地页呈现节点控制面真实内容
- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/user-flow.spec.ts
- 前置条件:前端可访问。
- 步骤:
  1. 打开 `/`,读取 `body` 文本。
- 预期结果:呈现控制面首页内容(标题/描述区),文本非空。

### ND-UI-005 界面语言切换(i18n)
- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/i18n.spec.ts:33
- 前置条件:前端提供中英文语言包。
- 步骤:
  1. 切换语言选择器至英文/中文。
- 预期结果:导航与页面文案随语言切换;刷新后语言选择保持。

---

## 四、应用市场浏览

### ND-UI-006 应用市场网格渲染
- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/market.spec.ts
- 前置条件:已注入 SIWE 会话(JWT 写入 localStorage)。
- 步骤:
  1. 打开 `/market`。
- 预期结果:`.app-center` 网格容器可见(卡片数可能为 0,仍应正常渲染)。

### ND-UI-007 卡片打开详情页
- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/market.spec.ts
- 前置条件:市场存在至少一个应用卡片;已注入会话。
- 步骤:
  1. 打开首张卡片的菜单 → 点击「详情」。
- 预期结果:URL 跳转到 `/market/detail`;`.detail` 可见;展示「基本信息」区块。

### ND-UI-008 我的应用页展示创建/申请两个页签与创建按钮
- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/market.spec.ts
- 前置条件:已注入会话。
- 步骤:
  1. 打开 `/market/dev/my-apps`。
- 预期结果:出现「我创建的」「我申请的」两个 tab;默认「我创建的」页签下展示「创建应用」按钮。

### ND-UI-009 应用检索/筛选
- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/market.spec.ts:82
- 前置条件:市场已发布若干应用。
- 步骤:
  1. 在市场页按名称/分类进行检索或筛选。
- 预期结果:结果集随条件变化;无匹配时呈现空态,网格容器仍正常渲染。

---

## 五、开发者应用生命周期

### ND-E2E-001 建草稿应用 → 出现在「我创建的」→ 删除
- 优先级:P0
- 类型:E2E
- 状态:✅ 已实现 — products/node/tests/app-lifecycle.spec.ts
- 前置条件:注入一次性随机钱包并 seed SIWE 会话;注入无弹窗签名器。
- 步骤:
  1. 打开 `/market/dev/apply-edit`,填写名称/描述/位置/源码并选择分类。
  2. 点击「保存草稿」触发签名建应用 POST `/api/v1/public/applications`。
  3. 跳转 `/market/dev/my-apps`,在「我创建的」看到新行。
  4. 行内「删除」→ 弹窗「确定」。
- 预期结果:创建响应 `code=0` 且返回 `data.uid`;新行可见;删除后该行消失。

### ND-API-016 建应用缺 did/version 返回 400
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:已登录并持有有效签名信封。
- 步骤:
  1. POST `/api/v1/public/applications`,缺 `did` 或 `version` 非数字。
- 预期结果:HTTP 400;`message` 为 `Missing did or version`。

### ND-API-017 建应用 owner 与登录地址不符返回 403
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:已登录。
- 步骤:
  1. POST `/api/v1/public/applications`,body `owner` 设为其他地址。
- 预期结果:HTTP 403;`message` 为 `Owner mismatch`。

### ND-API-018 建应用未登录返回 401
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:后端已启动。
- 步骤:
  1. 不带 JWT POST `/api/v1/public/applications`。
- 预期结果:HTTP 401;`message` 为 `Missing access token`。

### ND-API-019 应用列表仅返回可见范围
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:两个不同地址各自创建了草稿应用。
- 步骤:
  1. 以地址 A 登录 GET `/api/v1/public/applications`。
- 预期结果:HTTP 200;返回 `items` 与 `page` 分页;仅包含对 A 可见的应用(自建 + 已上线),不泄露他人未发布草稿。

### ND-API-020 应用详情对不可见者返回 404
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:地址 B 创建了未发布草稿,记录其 uid;地址 A 登录。
- 步骤:
  1. 以 A GET `/api/v1/public/applications/:uid`(B 的草稿 uid)。
  2. 以 B GET 同一 uid。
- 预期结果:对 A 返回 404(不可见即视为不存在);对 owner B 返回 200 且 `data` 为应用记录。

### ND-API-021 更新应用非属主返回 403
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:地址 B 拥有某应用;地址 A 登录并构造 `application_update` 签名信封。
- 步骤:
  1. 以 A PATCH `/api/v1/public/applications/:uid`(B 的应用)。
- 预期结果:HTTP 403;`message` 为 `Owner mismatch`;应用不被修改。属主自更新则返回 200 并落库(可用 ND-E2E-002 覆盖 UI 侧)。

### ND-E2E-002 编辑草稿并保存持久化
- 优先级:P1
- 类型:E2E
- 状态:✅ 已实现 — products/node/tests/apply-flow.spec.ts
- 前置条件:已存在一条自建草稿;注入会话与签名器。
- 步骤:
  1. 进入该应用编辑页,修改名称/描述/分类。
  2. 保存(触发 `application_update` 签名)。
  3. 返回「我创建的」查看该行。
- 预期结果:PATCH 返回 `code=0`;列表行展示更新后的名称/描述;刷新后仍保持。

### ND-API-022 发布未通过审核的应用返回 403
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:自建应用尚无「审批通过」记录;构造 `application_publish` 签名信封。
- 步骤:
  1. POST `/api/v1/public/applications/:uid/publish`。
- 预期结果:HTTP 403;`message` 为 `Audit not approved`;应用状态不变为上线。

### ND-E2E-003 审核通过后发布并出现在市场
- 优先级:P0
- 类型:E2E
- 状态:⬜ 待实现(降级跳过)— products/node/tests/admin-audit.spec.ts(需管理员审批能力,无法真跑;反向边界「未过审无法发布」由 ND-API-022 覆盖)
- 前置条件:应用已提交审核并被管理员审批通过(见 ND-E2E-004)。
- 步骤:
  1. 在「我创建的」对该应用点击「发布」并完成签名。
  2. 打开 `/market` 应用中心。
- 预期结果:发布 POST 返回 `code=0`;应用状态变为上线(`BUSINESS_STATUS_ONLINE`);市场网格中出现该应用卡片。

### ND-API-023 下线应用恢复为离线
- 优先级:P1
- 类型:API
- 状态:⬜ 待实现(降级跳过)— products/node/tests/app-write-api.spec.ts(需先有已上线应用,而上线依赖管理员审批,同 ND-E2E-003/004 无法真跑;他人已上线应用无法下线—Owner mismatch)
- 前置条件:应用已上线;构造 `application_unpublish` 签名信封。
- 步骤:
  1. POST `/api/v1/public/applications/:uid/unpublish`。
- 预期结果:HTTP 200;状态变为 `BUSINESS_STATUS_OFFLINE`;应用从市场公开网格移除;属主仍可在「我创建的」看到。

### ND-API-024 删除他人应用返回 403
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:地址 B 拥有应用;地址 A 登录并构造 `application_delete` 签名信封。
- 步骤:
  1. 以 A DELETE `/api/v1/public/applications/:uid`(B 的应用)。
- 预期结果:HTTP 403;`message` 为 `Owner mismatch`;应用仍存在。

### ND-API-025 写操作缺失/无效签名信封被拒
- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:已登录但请求体不含合法签名动作信封。
- 步骤:
  1. 对建应用/发布/删除任一写接口发起请求,省略或伪造签名。
- 预期结果:返回签名校验失败对应的错误状态(4xx),操作不执行;错误经 `executeSignedAction` 的签名校验映射。

### ND-API-026 应用授权配置读取与写入
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:登录用户对应用可见;构造 `application_config_upsert` 签名信封。
- 步骤:
  1. PUT `/api/v1/public/applications/:uid/config`,body 携带 `config` 数组与签名。
  2. GET `/api/v1/public/applications/:uid/config`。
- 预期结果:PUT 返回 `code=0`;GET 返回 `data.config` 为刚写入的配置(按 applicant 维度隔离);对不可见应用返回 404。

### ND-API-027 保存草稿前的重名检查
- 优先级:P2
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts:208
- 前置条件:已存在同名自建应用。
- 步骤:
  1. POST `/api/v1/public/applications/search`,condition 含相同 `name`。
- 预期结果:HTTP 200;返回命中的同名应用列表(前端据此提示重名),不误报为服务器错误。

---

## 六、应用审核

### ND-E2E-004 管理员审核:提交 → 审批通过 → 可发布
- 优先级:P0
- 类型:E2E
- 状态:⬜ 待实现(降级跳过)— products/node/tests/admin-audit.spec.ts(需管理员审批能力,无法真跑)
- 前置条件:管理员地址(命中 vault `ADMIN_DIDS` 或 `USER_ROLE_OWNER`)已登录;存在一条待审核应用。
- 步骤:
  1. 开发者提交应用送审(POST `/api/v1/public/audits`)。
  2. 管理员进入审批页 `/market/dev/approval`,对该记录选择「审批通过」。
  3. 开发者对应用执行发布。
- 预期结果:审批状态变为「审批通过」;`hasApprovedAudit` 为真;发布成功(呼应 ND-E2E-003 / ND-API-022 的反向用例)。

### ND-API-028 非管理员审核检索被限定范围
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/app-write-api.spec.ts
- 前置条件:普通用户已登录。
- 步骤:
  1. POST `/api/v1/public/audits/search`,尝试检索非本人相关的审核记录。
- 预期结果:非管理员越权检索返回 HTTP 403(`Audit search scope denied`);仅可检索本人 applicant 维度的记录。

---

## 七、申请使用应用

### ND-E2E-005 申请使用已上线应用
- 优先级:P1
- 类型:E2E
- 状态:✅ 已实现 — products/node/tests/apply-flow.spec.ts
- 前置条件:市场存在一个已上线应用;非属主用户登录。
- 步骤:
  1. 在应用详情/卡片点击「申请使用」,提交申请信息并签名(创建 audit)。
  2. 打开 `/market/dev/my-apps` 的「我申请的」页签。
- 预期结果:申请提交成功;「我申请的」出现该应用及其申请状态(待审批/通过/驳回),状态随审批推进变化。

---

## 八、身份能力(TOTP/Passkey/授权码)

### ND-API-029 身份状态查询
- 优先级:P2
- 类型:API
- 状态:✅ 已实现 — products/node/tests/identity-api.spec.ts:37
- 前置条件:已登录。
- 步骤:
  1. GET `/api/v1/public/identity/status`(及 `/identity/totp/status`)。
- 预期结果:HTTP 200;返回当前身份能力启用状态(是否绑定 TOTP、Passkey 等)。

### ND-API-030 TOTP 绑定与校验闭环
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/identity-api.spec.ts
- 前置条件:已登录且未绑定 TOTP。
- 步骤:
  1. POST `/identity/totp/setup` 获取密钥/二维码。
  2. POST `/identity/totp/confirm` 提交验证码完成绑定。
  3. POST `/identity/totp/verify` 用当前验证码校验;`/identity/totp/revoke` 解绑。
- 预期结果:setup 返回密钥;正确验证码 confirm/verify 成功;错误验证码被拒;revoke 后状态回到未绑定。

### ND-API-031 Passkey 注册请求与确认
- 优先级:P2
- 类型:API
- 状态:✅ 已实现 — products/node/tests/passkey.spec.ts:104(用 Chromium CDP 虚拟认证器 `WebAuthn.addVirtualAuthenticator` 产出真实 `none` 证明,跑通 请求→创建凭证→确认→列表→撤销 全闭环,非硬件但真验证)
- 前置条件:已登录。
- 步骤:
  1. POST `/identity/passkeys/register/request` 获取注册挑战。
  2. POST `/identity/passkeys/register/confirm` 提交凭证完成注册。
  3. POST `/identity/passkeys/list` 查看已注册凭证。
- 预期结果:注册成功后列表可见新凭证;`/identity/passkeys/revoke` 可撤销。

### ND-API-032 应用授权码(PKCE)请求 → 批准 → 兑换
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/identity-api.spec.ts
- 前置条件:已登录;第三方应用有效的 client 与 redirect。
- 步骤:
  1. POST `/identity/authorize/request` 发起授权请求,GET `/identity/authorize/request/:requestId` 查询。
  2. POST `/identity/authorize/approve`(或前端 `/identity/authorize` 页 Passkey 批准)。
  3. POST `/identity/authorize/exchange` 用 code + PKCE verifier 兑换令牌。
- 预期结果:批准后返回 `redirectTo` 及授权码;正确 verifier 兑换成功;错误/重复兑换被拒(一次性)。

---

## 九、通知中心

### ND-UI-010 通知中心页面渲染
- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/node/tests/notifications.spec.ts
- 前置条件:已注入会话。
- 步骤:
  1. 打开 `/market/dev/notifications`。
- 预期结果:通知中心正常渲染;展示通知列表或空态;未读数正确显示。

### ND-API-033 通知列表、未读数与标记已读
- 优先级:P2
- 类型:API
- 状态:✅ 已实现 — products/node/tests/notifications.spec.ts
- 前置条件:已登录;账户存在若干通知(如建应用/发布触发的通知)。
- 步骤:
  1. GET `/api/v1/public/notifications` 与 `/notifications/unread-count`。
  2. POST `/api/v1/public/notifications/:uid/read`(或 `/notifications/read-all`)。
- 预期结果:列表分页返回;标记已读后未读数相应减少;`read-all` 清零未读。

### ND-API-034 通用 Webhook 投递闭环(签名校验)
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/notification-delivery.spec.ts
- 前置条件:node 服务运行;配置 `NODE_WALLET_PRIVATE_KEY`;可选 `NODE_CALLBACK_HOST`(默认 127.0.0.1)。
- 步骤:
  1. 全新钱包登录;在本机起一个临时 HTTP 回调服务器。
  2. POST `/api/v1/public/notifications/webhooks` 注册 `format=generic` 的 webhook(带 secret、events=['application.created'])。
  3. 创建应用触发 `application.created` 通知,扇出生成投递记录,后台 worker 回调本地服务器。
  4. 轮询 `/webhooks/:uid/deliveries` 直到该通知的投递到达终态。
- 预期结果:回调命中,携带正确的 `x-yeying-*` 头与合法 HMAC-SHA256 签名(`sha256=` + HMAC(secret, `${timestamp}.${rawBody}`));投递记录 `channel=webhook`、`status=delivered`。

### ND-API-035 钉钉机器人真实投递(需配置)
- 优先级:P2
- 类型:API
- 状态:✅ 已实现 — products/node/tests/notification-delivery.spec.ts(未配置 `NODE_DINGTALK_WEBHOOK_URL`/`_SECRET` 时跳过)
- 前置条件:node 服务运行;提供真实钉钉群机器人 URL(需在平台白名单 `oapi.dingtalk.com`)与加签 secret。
- 步骤:
  1. 全新钱包登录,注册 `format=dingtalk` 的 webhook(URL + 加签 secret)。
  2. 创建应用触发通知,轮询投递记录直到终态。
- 预期结果:投递记录 `channel=dingtalk`、`status=delivered`(钉钉返回 errcode=0);钉钉群实际收到消息。

### ND-API-036 飞书机器人真实投递(需配置)
- 优先级:P2
- 类型:API
- 状态:✅ 已实现 — products/node/tests/notification-delivery.spec.ts(未配置 `NODE_FEISHU_WEBHOOK_URL`/`_SECRET` 时跳过)
- 前置条件:node 服务运行;提供真实飞书群机器人 URL(需在平台白名单 `open.feishu.cn`)与加签 secret。
- 步骤:
  1. 全新钱包登录,注册 `format=feishu` 的 webhook(URL + 加签 secret)。
  2. 创建应用触发通知,轮询投递记录直到终态。
- 预期结果:投递记录 `channel=feishu`、`status=delivered`(飞书返回 code/StatusCode=0);飞书群实际收到消息。

### ND-API-037 通知中心 SSE 实时推送闭环
- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/node/tests/notification-delivery.spec.ts
- 前置条件:node 服务运行;配置 `NODE_WALLET_PRIVATE_KEY`。
- 步骤:
  1. 全新钱包登录,用 Node `fetch` + `Authorization: Bearer` 打开 `/api/v1/public/notifications/stream`(EventSource 无法设置鉴权头)。
  2. 等待 `ready` 握手帧(校验 recipient 为本人地址)。
  3. 创建应用触发通知。
- 预期结果:握手后实时收到 `notification.created` 事件,`notificationUid` 与新建应用的通知一致。

---

## 十、会话与鉴权守卫

### ND-E2E-006 通过真实钱包完成 SIWE 登录
- 优先级:P0
- 类型:E2E
- 状态:✅ 已实现 — products/node/tests/auth-flow.spec.ts
- 前置条件:注入 YeYing 钱包 provider(window.ethereum),持有测试私钥。
- 步骤:
  1. 首页点击连接钱包 → 授权账户。
  2. 触发 challenge → `personal_sign` 签名 → verify。
- 预期结果:登录成功,JWT 写入前端会话;`profile/me` 返回本人地址;可进入受保护路由(市场/我的应用)。

### ND-E2E-007 未登录访问受保护路由被重定向,登出后守卫生效
- 优先级:P1
- 类型:E2E
- 状态:✅ 已实现 — products/node/tests/auth-flow.spec.ts
- 前置条件:前端可访问。
- 步骤:
  1. 在无有效会话时直接访问 `/market/dev/my-apps`。
  2. 登录后再登出,重复访问受保护路由。
- 预期结果:无会话时被路由守卫 `beforeEach` 重定向回首页 `/`;登出后受保护路由再次被拦截,首页与 `meta.public` 页面仍可访问。
