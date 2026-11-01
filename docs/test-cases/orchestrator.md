# Orchestrator 控制面 — 端到端测试用例

> 测试人员视角整理的**应有** E2E 用例清单,作为实现依据。
> 状态说明:✅ 已实现(链接到 spec) / ⬜ 待实现。
> 端点:前端 5174 · API 3900(uvicorn)。登录用例在测试进程内生成一次性钱包，不需要提交私钥。
> 鉴权说明:采用钱包 SIWE 挑战→签名→验证,会话以 HttpOnly Cookie `hub_session` 承载(非 Bearer JWT);API 前缀 `/api/v1/public`,内部运维接口前缀 `/api/v1/internal`(需内部令牌)。
> 说明:一条逻辑用例可能对应多个 spec;"已实现"以逻辑用例是否被现有 spec 覆盖为准,而非 spec 中的 test 块数量。
> 最后更新:2026-10-28

## 覆盖总览

| 模块                       | 用例数 | 已实现 | 待实现 |
| -------------------------- | ------ | ------ | ------ |
| 一、健康检查与版本         | 3      | 2      | 1      |
| 二、钱包鉴权与会话(SIWE)   | 11     | 4      | 7      |
| 三、登录页与钱包连接 UI    | 5      | 5      | 0      |
| 四、导航与应用外壳         | 4      | 2      | 2      |
| 五、智能体目录与能力       | 5      | 0      | 5      |
| 六、Messenger 实例生命周期 | 11     | 0      | 11     |
| 七、Messenger 工作台 UI    | 3      | 0      | 3      |
| 八、Trader 工作台          | 8      | 0      | 8      |
| 九、内部运维 API           | 4      | 0      | 4      |
| 十、错误与异常             | 4      | 0      | 4      |
| **合计**                   | **58** | **13** | **45** |

---

## 一、健康检查与版本

### OR-API-001 公共健康检查返回存活

- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:uvicorn 后端在 3900 可用
- 步骤:
  1. `GET /api/v1/public/health`
- 预期结果:返回 200,响应体 `{ok: true, service: "orchestrator"}`
- 备注:测试请求公共健康检查路由并校验响应体。

### OR-API-002 版本信息接口

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:后端可用
- 步骤:
  1. `GET /api/v1/public/version`
- 预期结果:返回 200,响应体 `{name: "orchestrator", version, runtime: "python"}`

### OR-UI-001 首页渲染 Orchestrator 控制台

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/orchestrator/tests/smoke.spec.ts
- 前置条件:前端 5174 可用
- 步骤:
  1. 访问首页 `/`
  2. 观察页面主体
- 预期结果:页面正常挂载并显示"登录运行控制台"标题

---

## 二、钱包鉴权与会话(SIWE)

### OR-API-003 challenge 需要 checksum 钱包地址

- 优先级:P0
- 类型:API
- 状态:⬜ 待实现
- 前置条件:后端可用(无需私钥)
- 步骤:
  1. `POST /api/v1/public/auth/wallet/challenge`,传入非法/全小写非 checksum 的 `wallet_id`
- 预期结果:返回 400,提示 `invalid wallet_id`(地址经 `to_checksum_address` 规范化失败)

### OR-API-004 challenge 返回 SIWE 消息与挑战令牌

- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:准备一个合法 checksum 地址
- 步骤:
  1. `POST /api/v1/public/auth/wallet/challenge` 传入 checksum `wallet_id`(可带 `chain_id`)
- 预期结果:返回 `{wallet_id, chain_id, auth_type: "wallet_plugin", challenge, challenge_token, issued_at, expires_at}`;`challenge` 文本含 `wants you to sign in with your Ethereum account`、`Sign in to Orchestrator.`、`Nonce:` 等 SIWE 字段

### OR-API-005 challenge→签名→verify 换取会话 Cookie

- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:测试进程生成的一次性钱包
- 步骤:
  1. 用私钥对应地址获取 challenge 与 `challenge_token`
  2. 用私钥对 `challenge` 文本做 `personal_sign`
  3. `POST /api/v1/public/auth/wallet/verify` 提交 `{wallet_id, chain_id, challenge, challenge_token, signature}`
- 预期结果:返回 200 与 `AuthSessionView`;响应写入 `Set-Cookie: hub_session=...`(HttpOnly),后续携带该 Cookie 可访问受保护接口

### OR-API-006 verify 拒绝错误签名

- 优先级:P0
- 类型:API
- 状态:⬜ 待实现
- 前置条件:测试进程生成的一次性钱包
- 步骤:
  1. 获取地址 A 的 challenge
  2. 用另一把私钥 B 对该 challenge 签名
  3. `POST /auth/wallet/verify` 提交(wallet_id 仍为 A)
- 预期结果:返回 401,提示 `signature does not match wallet`,不下发会话 Cookie

### OR-API-007 verify 拒绝钱包地址不匹配

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:测试进程生成的一次性钱包
- 步骤:
  1. 用地址 A 获取 challenge_token
  2. `POST /auth/wallet/verify` 中提交与 challenge_token 内地址不同的 `wallet_id`
- 预期结果:返回 401,提示 `wallet mismatch`

### OR-API-008 verify 挑战一次性 / 防重放

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:测试进程生成的一次性钱包并完成一次成功 verify
- 步骤:
  1. 复用同一 `challenge` + `challenge_token` + `signature` 再次 `POST /auth/wallet/verify`
- 预期结果:返回 401,提示 `challenge already used`(token 摘要已记入 consumed 列表)

### OR-API-009 verify 拒绝过期挑战

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:测试进程生成的一次性钱包;可将 `HUB_CHALLENGE_TTL_SECONDS` 调小或等待过期
- 步骤:
  1. 获取 challenge 后等待其 `expires_at` 过期
  2. 再对其签名并 `POST /auth/wallet/verify`
- 预期结果:返回 401,提示 `challenge expired`

### OR-API-010 verify 拒绝被篡改的 challenge_token

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:后端可用
- 步骤:
  1. 获取合法 challenge_token 后改动其载荷或签名部分
  2. `POST /auth/wallet/verify` 提交篡改后的 token
- 预期结果:返回 401,提示 `invalid challenge token`(HMAC 校验失败)

### OR-API-011 auth/me 未登录返回 401

- 优先级:P0
- 类型:API
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:无(不携带 `hub_session` Cookie)
- 步骤:
  1. `GET /api/v1/public/auth/me`
- 预期结果:返回 401,提示 `not logged in`

### OR-API-012 auth/me 登录后返回会话信息

- 优先级:P1
- 类型:API
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:测试进程生成的一次性钱包且已完成 verify 取得 Cookie
- 步骤:
  1. 携带 `hub_session` Cookie `GET /api/v1/public/auth/me`
- 预期结果:返回 200 与 `AuthSessionView`(含 `wallet_id`、`auth_type`、`expires_at` 等)

### OR-API-013 logout 清除会话 Cookie

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录取得 Cookie
- 步骤:
  1. `POST /api/v1/public/auth/logout`
  2. 观察响应并再次 `GET /auth/me`
- 预期结果:返回 `{ok: true}` 并下发删除 `hub_session` 的 Set-Cookie;随后 `/auth/me` 返回 401

---

## 三、登录页与钱包连接 UI

### OR-UI-002 登录页渲染钱包登录入口

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:前端 5174 可用
- 步骤:
  1. 访问首页 `/`
  2. 观察登录区
- 预期结果:渲染"连接钱包"按钮等可点击入口(存在 button/[role=button])

### OR-UI-003 首页存在可交互入口(冒烟)

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:前端 5174 可用
- 步骤:
  1. 访问首页
  2. 统计 input/button/a/[role] 元素
- 预期结果:至少存在一个可交互元素,页面非空白

### OR-UI-004 点击连接钱包驱动签名流程并优雅报错

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:未注入钱包(无 `window.ethereum`)或注入 EIP-1193 shim
- 步骤:
  1. 点击"使用钱包登录"
  2. 观察状态提示与错误区
- 预期结果:显示"正在请求钱包签名..."后,在无钱包时展示错误提示(如"未检测到钱包扩展"),页面无 JS 崩溃

### OR-UI-005 未登录访问受保护路由重定向登录页

- 优先级:P1
- 类型:E2E
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:无有效 `hub_session` 会话
- 步骤:
  1. 直接访问 `/runtime`
- 预期结果:AppShell 校验会话失败,自动重定向回登录页 `/`(期间显示"正在校验会话...")

### OR-UI-006 已认证会话进入运行概览与实例页

- 优先级:P0
- 类型:E2E
- 状态:✅ 已实现 — products/orchestrator/tests/auth-flow.spec.ts
- 前置条件:在浏览器中播种有效 `hub_session` Cookie(经 SIWE verify 获得,使用测试进程生成的一次性钱包)
- 步骤:
  1. 登录后确认进入 `/overview`
  2. 导航至 `/runtime`
- 预期结果:两个受保护页面均渲染 AppShell，不被重定向到登录页。

---

## 四、导航与应用外壳

### OR-UI-007 侧栏渲染三个导航项

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/orchestrator/tests/user-flow.spec.ts
- 前置条件:已认证会话
- 步骤:
  1. 观察左侧导航
- 预期结果:渲染"运行概览 / 运行时实例 / 应用工作台 / 交易员 / 信使"五个导航项

### OR-UI-008 导航项间 SPA 内切换并高亮

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/orchestrator/tests/user-flow.spec.ts
- 前置条件:已认证会话
- 步骤:
  1. 点击"运行时实例"
- 预期结果:主区域通过 SPA 切换到 `/runtime`,当前导航项标记 `aria-current="page"`

### OR-UI-009 顶栏渲染钱包徽章与会话协议标识

- 优先级:P2
- 类型:UI
- 状态:⬜ 待实现
- 前置条件:已认证会话
- 步骤:
  1. 观察顶栏右侧
- 预期结果:显示钱包短地址徽章与协议标识(`UCAN` 或 `Wallet`),并有"退出"按钮

### OR-UI-010 点击退出注销并回到登录页

- 优先级:P1
- 类型:E2E
- 状态:⬜ 待实现
- 前置条件:已认证会话
- 步骤:
  1. 点击"退出"
  2. 观察跳转
- 预期结果:调用登出清除会话并跳回登录页 `/`;再次访问 `/agents` 被重定向

---

## 五、智能体目录与能力

### OR-API-014 未登录访问智能体目录返回 401

- 优先级:P0
- 类型:API
- 状态:⬜ 待实现
- 前置条件:无会话 Cookie
- 步骤:
  1. `GET /api/v1/public/agents`
- 预期结果:返回 401,提示 `not logged in`(所有智能体接口均要求会话)

### OR-API-015 已登录列出智能体目录

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话(使用测试进程生成的一次性钱包)
- 步骤:
  1. 携带 Cookie `GET /api/v1/public/agents`
- 预期结果:返回 `{items: [...]}`,每项含 `key`(如 trader/messenger)、`display_name`、`category`、`available`

### OR-API-016 agent/types 返回受支持渠道类型

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话
- 步骤:
  1. `GET /api/v1/public/agent/types`
- 预期结果:返回 `{agentTypes: [...]}`,含 `whatsapp`(requires manual_pairing)与 `dingtalk`(requires client_id/client_secret)

### OR-API-017 router/models 返回可选模型列表

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话
- 步骤:
  1. `GET /api/v1/public/router/models`
- 预期结果:返回 `{models: [...]}`,包含默认模型(如 `gpt-5.3-codex`)

### OR-UI-011 智能体列表页渲染卡片与统计

- 优先级:P1
- 类型:UI
- 状态:⬜ 待实现
- 前置条件:已认证会话
- 步骤:
  1. 进入 `/agents`
  2. 观察统计卡与列表
- 预期结果:渲染"智能体总数/可用智能体/待接入智能体"统计卡,并列出智能体卡片(可用/不可用徽章、分类),点击可跳转对应工作台

---

## 六、Messenger 实例生命周期

### OR-API-018 创建 messenger 实例

- 优先级:P0
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话(使用测试进程生成的一次性钱包)
- 步骤:
  1. `POST /api/v1/public/agent/instances` 提交 `{kind: "whatsapp", name, model?}`
- 预期结果:返回 `BotInstanceView`,含 `id`、`status`、`owner_wallet`(为当前会话钱包)、`port` 等;实例归属当前用户

### OR-API-019 列出自有实例(按 owner 过滤)

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话,已创建至少一个实例
- 步骤:
  1. `GET /api/v1/public/agent/instances`
- 预期结果:返回 `{defaultModel, items: [...]}`,仅含 `owner_wallet` 匹配当前会话的实例

### OR-API-020 获取单个实例详情

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已创建实例
- 步骤:
  1. `GET /api/v1/public/agent/instances/{id}`
- 预期结果:返回该实例 `BotInstanceView` 详情

### OR-API-021 访问他人/不存在实例返回 404

- 优先级:P0
- 类型:API
- 状态:⬜ 待实现
- 前置条件:实例不属于当前会话钱包,或 id 不存在
- 步骤:
  1. 携带用户 A 会话 `GET /agent/instances/{非本人或不存在的 id}`
- 预期结果:返回 404,提示 `instance not found`(越权访问以 404 屏蔽,不泄露存在性)

### OR-API-022 更新实例模型(PATCH)

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已创建实例
- 步骤:
  1. `PATCH /api/v1/public/agent/instances/{id}/model` 提交 `{model}`
- 预期结果:返回更新后的 `BotInstanceView`;模型不在 allowlist 时返回 400

### OR-API-023 启动 / 停止实例

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已创建实例
- 步骤:
  1. `POST /agent/instances/{id}/start`
  2. `POST /agent/instances/{id}/stop`
- 预期结果:两步均返回 `BotInstanceActionResponse`(含 message 与更新后的 instance),状态相应变化

### OR-API-024 运行中实例删除返回 409

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:实例处于运行状态
- 步骤:
  1. `DELETE /api/v1/public/agent/instances/{id}`
- 预期结果:返回 409,提示 `instance is running, stop it before delete`

### OR-API-025 停止后删除实例

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:实例已停止
- 步骤:
  1. `POST /agent/instances/{id}/stop`
  2. `DELETE /agent/instances/{id}`
  3. `GET /agent/instances`
- 预期结果:删除成功;列表不再含该实例

### OR-API-026 WhatsApp 配对触发返回二维码/日志

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已创建 `kind=whatsapp` 实例
- 步骤:
  1. `POST /api/v1/public/agent/instances/{id}/pair-whatsapp`
- 预期结果:返回 `BotInstancePairResponse`(含 `pair_pid`、`pair_log`);对非 whatsapp 实例返回 400

### OR-API-027 读取实例日志

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已创建实例
- 步骤:
  1. `GET /api/v1/public/agent/instances/{id}/logs?lines=120`
- 预期结果:返回 `BotInstanceLogsResponse`(gateway_log/pair_log/pair_qr_ascii/pair_status 等)

### OR-API-028 实例诊断(可选自动恢复)

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已创建实例
- 步骤:
  1. `GET /api/v1/public/agent/instances/{id}/diagnose?auto_recover=false`
- 预期结果:返回 `BotInstanceDiagnoseResponse`(gateway_reachable、pair_status、router_api_key_present、recommended_action 等诊断证据)

---

## 七、Messenger 工作台 UI

### OR-UI-012 信使工作台渲染指标与创建表单

- 优先级:P1
- 类型:UI
- 状态:⬜ 待实现
- 前置条件:已认证会话
- 步骤:
  1. 进入 `/agents/messenger`
  2. 观察指标卡与实例创建表单
- 预期结果:渲染工作台指标卡、实例列表区与创建表单(kind/name/model 等字段)

### OR-UI-013 创建实例后列表刷新

- 优先级:P1
- 类型:E2E
- 状态:⬜ 待实现
- 前置条件:已认证会话,后端实例创建可用
- 步骤:
  1. 在创建表单填写名称并提交
  2. 观察实例列表
- 预期结果:创建成功后列表出现新实例,状态与模型正确展示

### OR-UI-014 WhatsApp 配对展示二维码

- 优先级:P2
- 类型:UI
- 状态:⬜ 待实现
- 前置条件:已创建 whatsapp 实例
- 步骤:
  1. 触发配对
  2. 观察二维码/配对日志区
- 预期结果:展示配对二维码(ASCII)与配对状态提示

---

## 八、Trader 工作台

### OR-API-029 trader 工作台摘要

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话
- 步骤:
  1. `GET /api/v1/public/agents/trader/summary`
- 预期结果:返回 `AgentWorkspaceSummaryResponse`(available、running、strategies、recent_signals/orders/runs、diagnostics 等)

### OR-API-030 更新 trader 配置(PUT config)

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话,trader 能力可用
- 步骤:
  1. `PUT /api/v1/public/agents/trader/config` 提交 `{broker, strategy, strategy_id?}`
- 预期结果:返回 `{saved: true, broker, strategyCount}`;能力不存在返回 404,非法参数返回 400

### OR-API-031 trader run-once 动作

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话,trader 能力可用
- 步骤:
  1. `POST /api/v1/public/agents/trader/actions/run-once`
- 预期结果:返回 `{executed, action: "run_once", stdout}`

### OR-API-032 trader start / stop 动作

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话,trader 能力可用
- 步骤:
  1. `POST /agents/trader/actions/start`
  2. `POST /agents/trader/actions/stop`
- 预期结果:两步均返回 `AgentWorkspaceActionResponse`,action 分别为 start/stop

### OR-API-033 unlock-order 订单守卫解锁

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话,trader 支持订单守卫
- 步骤:
  1. `POST /agents/trader/actions/unlock-order` 提交 `{trading_day, strategy_id, symbol, side, reason}`
- 预期结果:返回执行结果;不支持该能力的智能体返回 405

### OR-API-034 未知 agent_key 返回 404

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:已登录会话
- 步骤:
  1. `GET /api/v1/public/agents/does-not-exist/summary`
- 预期结果:返回 404,提示 `agent capability not found`

### OR-UI-015 交易员工作台渲染摘要与动作

- 优先级:P1
- 类型:UI
- 状态:⬜ 待实现
- 前置条件:已认证会话
- 步骤:
  1. 进入 `/agents/trader`
  2. 观察摘要与动作按钮
- 预期结果:渲染交易员工作台摘要(策略/信号/订单)及"运行一次/启动/停止"动作按钮

### OR-UI-016 交易员策略与记录页导航

- 优先级:P2
- 类型:UI
- 状态:⬜ 待实现
- 前置条件:已认证会话,存在策略/记录
- 步骤:
  1. 从工作台进入 `/agents/trader/{strategyId}`
  2. 再进入某条记录 `/agents/trader/{strategyId}/records/{recordId}`
- 预期结果:策略页与记录页正常渲染,SPA 内导航无整页刷新

---

## 九、内部运维 API

### OR-API-035 缺少内部令牌被拒

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:后端可用
- 步骤:
  1. 不带 `Authorization`/`token` 头 `GET /api/v1/internal/installed`
- 预期结果:未配置内部令牌时返回 503(`internal token is not configured`);已配置但令牌错误时返回 401(`invalid internal token`)

### OR-API-036 installed 列出已安装智能体

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:内部令牌已配置
- 步骤:
  1. `GET /api/v1/internal/installed`,携带 `Authorization: Bearer <HUB_INTERNAL_TOKEN>`
- 预期结果:返回 `{code: 200, message, data}`,列出已安装项

### OR-API-037 install/upgrade/uninstall 生命周期任务

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:内部令牌已配置
- 步骤:
  1. `POST /api/v1/internal/install`(可带 `X-Yeying-Instance` 头与 JSON 载荷)
  2. 同理 `POST /upgrade`、`POST /uninstall`
- 预期结果:各返回 `{code: 200, data: {task}}`;非法载荷返回 `{code: 400}`

### OR-API-038 hooks 事件记录

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:内部令牌已配置
- 步骤:
  1. `POST /api/v1/internal/hooks/{action}` 携带令牌与载荷
- 预期结果:返回 `{code: 200, data: {event}}`,事件被记录

---

## 十、错误与异常

### OR-API-039 未知 API 路由返回 404

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:后端可用
- 步骤:
  1. `GET /api/v1/public/does-not-exist`
- 预期结果:返回 404(以 `api/` 开头的路径不落入 SPA 回退)

### OR-API-040 challenge 缺少必填字段返回 422

- 优先级:P1
- 类型:API
- 状态:⬜ 待实现
- 前置条件:后端可用
- 步骤:
  1. `POST /api/v1/public/auth/wallet/challenge` 提交空 body(缺少 `wallet_id`)
- 预期结果:返回 422,FastAPI 请求体校验失败

### OR-API-041 verify 非法 body 返回 422

- 优先级:P2
- 类型:API
- 状态:⬜ 待实现
- 前置条件:后端可用
- 步骤:
  1. `POST /api/v1/public/auth/wallet/verify` 缺少 `challenge_token`/`signature` 等必填字段
- 预期结果:返回 422,请求体校验失败

### OR-UI-017 SPA 未知前端路径回退首页

- 优先级:P2
- 类型:UI
- 状态:⬜ 待实现
- 前置条件:后端以静态方式托管前端(生产 3900)
- 步骤:
  1. 直接访问一个不存在的前端路径(非 `api/`、非静态文件)
- 预期结果:返回 `index.html`,前端路由接管并展示应用(未知路由由 SPA 处理)
