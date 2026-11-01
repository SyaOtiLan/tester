# 端到端测试用例总览

以测试人员视角整理的各产品**应有** E2E 测试用例,作为自动化实现的依据。
每个产品一份文档,用例按功能模块分组,标注优先级(P0/P1/P2)、类型(UI/API/DAPP/DATA/E2E)、
状态(✅ 已实现并链接到 spec / ⬜ 待实现)与完整的前置条件·步骤·预期结果。

## 进度总览

| 产品 | 文档 | 用例数 | ✅ 已实现 | ⬜ 待实现 | 完成度 |
| --- | --- | ---: | ---: | ---: | ---: |
| 仓库 Warehouse | [warehouse.md](warehouse.md) | 91 | 91 | 0 | 100% |
| 节点 Node | [node.md](node.md) | 50 | 46 | 4 | 92% |
| 路由 Router | [router.md](router.md) | 109 | 95 | 14 | 87% |
| 钱包 Wallet | [wallet.md](wallet.md) | 67 | 67 | 0 | 100% |
| 对话 Chat | [chat.md](chat.md) | 92 | 69 | 23 | 75% |
| 社交 Social | [social.md](social.md) | 87 | 81 | 6 | 93% |
| 项目 Project | [project.md](project.md) | 141 | 138 | 3 | 98% |
| 知识库 Knowledge | [knowledge.md](knowledge.md) | 110 | 5 | 105 | 5% |
| 编排控制面 Orchestrator | [orchestrator.md](orchestrator.md) | 58 | 13 | 45 | 22% |
| 应用市场 Marketplace | [marketplace.md](marketplace.md) | 59 | 59 | 0 | 100% |
| 文档 Books | [books.md](books.md) | 35 | 32 | 3 | 91% |
| **合计** | | **899** | **696** | **203** | **77%** |

## 使用方式

- **实现测试时**:挑一个产品文档,从 P0 的 ⬜ 待实现用例做起;每落地一条,把状态改为
  ✅ 并补上对应 spec 路径,同步更新该文档的覆盖总览表与本页进度表的计数。
- **状态口径**:「已实现」以*逻辑用例*是否被现有 spec 覆盖为准(一条逻辑用例可能对应多个
  spec test 块,也可能多条逻辑用例合并进一个 spec)。本目录是用例的唯一事实来源:记录
  「每个产品应该有哪些用例、还差哪些」,而 `products/<name>/tests/*.spec.ts` 是这些用例的
  自动化实现。

## 各产品重点缺口

**Warehouse** — P0 + P1 + P2 全量覆盖(91/91)。logout/邮箱验证码/UCAN 会话、WebDAV COPY/OPTIONS/404、AccessKey 追加绑定、清空回收站、二次分享/audiences、配额百分比/无限标记、通知整片、分组 CRUD/成员、管理员改删用户、文件预览/排序/重命名/冲突/大文件上传 UI 均已落地。个别用例按环境条件跳过并在满足条件时真跑:邮箱验证码通道(后端 500)、UCAN、管理员改删(需地址在 Security.AdminAddresses)、前端 5173 未起时 UI 用例整体跳过。

**Node** — P0 + P1 + P2 已补齐(46/50):healthCheck 别名、verify 负路径、身份状态、Passkey 注册(CDP 虚拟认证器跑真实 WebAuthn 仪式)、i18n 与应用检索 UI。剩余 4 条受阻:就绪 503(需非破坏性地制造共享 DB 故障)、下线恢复(需先有已审核上线的应用)、审核发布全链路 ND-E2E-003/004(需管理员审批人 ADMIN_DIDS)。

**Router** — P0 + P1 + P2 已补齐(82/99):refresh 换发、大小写不敏感登录、充值余额汇总/批次/兑换记录、套餐预览、中继未实现边界 + 路由日志、侧栏/语言/模型/额度/套餐/账户设置 UI、改名与改密 E2E。**新增模块十一「个人供应商路由(BYOK)」(9 条 API,用户级、`ROUTER_WALLET_PRIVATE_KEY` 即可真跑)**:连接 CRUD 且凭证只写不回显(断言响应体无明文 key、无 `api_key`/`key` 字段)、Base URL SSRF 七类拒绝(HTTPS/localhost/内网/用户信息/查询串/片段各断言精确报文)、协议白名单、名称/模型/畸形 JSON 校验、模型路由 upsert/list/delete + 非法策略「路由策略无效」/范围外「模型不在当前账号可用范围内」/重复删除 `personal_model_route_not_found`、routing-quota 无限次请求计量形态、缺失连接受控 not-found、未鉴权 401。**新增模块十二「渠道与供应商管理(管理员)」(7 条 API,需 `ROUTER_ADMIN_PRIVATE_KEY` 在 `bootstrap.root_wallet_address`)**:渠道 CRUD(全程用 `status:2` 停用态+`finally` 硬删,零路由爆炸半径)且 key 读取脱敏、删除幂等、标识空/重名/畸形 JSON 校验、列表分页与 compact 四字段投影、测试「未找到可用于测试的模型」/刷新「不支持的刷新动作」/模型与测试子资源空页契约、缺失渠道 not-found、供应商目录与缺失「供应商不存在」、普通用户 200「权限不足」+ 匿名 401 的鉴权边界。整套新增 16 条在本地 router 上 `PWWORKERS=2` 全绿(个人供应商 9 + 渠道 7)。剩余 ⬜:RT-API-058 经个人供应商中继补全(**发现产品边界:合成个人渠道未持久化 `meta.ChannelModelConfigs`,`resolveChannelTextUpstream` 返回 503 `unsupported_channel_endpoint`,已如实记录待产品确认**)、RT-API-061 渠道启用态选路(共享服务爆炸半径,暂缓),以及原有受阻的外部支付/令牌 UI/DISABLE_OPENAI_COMPAT/限流/死代码页等。**router 前端 2026-09-24 大改导致的 7 条既有 UI spec 回归已同日全部修复**:workspace-nav 侧栏 4 项标签按现 i18n 改用 `可用模型 / 令牌 / 我的供应商 / 额度`,`/workspace/entry` 因账户有套餐/余额落到 `/workspace/topup?tab=quota` 而非旧定价页;workspace 额度卡片现 5 张(断言 `>=3` 可见)、新增令牌存在「页头 + 空表 CTA」两枚按钮故统一 `.first()`、用户态 `/workspace/log` 不再渲染管理员专属的「路由异常概览」标题改断言 `.router-log-table`、支付记录由独立链接变页内 tab → 改 `getByRole('tab', ...)`;user-account 「账户信息 / 修改密码」i18n 实为小写 `Account info / Change password` 已加 `/i`;token-lifecycle 同上 `.first()` 收紧。整套 `--project=router` 在 `PWWORKERS=2` 下 76 通过 / 15 跳过 / 0 失败,跨多轮重跑确定。**新增模块十三「钱包身份登录(真实 Node + Mailpit)」RT-API-067(P0,API+扩展)**:用真实 MV3 钱包扩展跑通「web3 产品用钱包登录 → 钱包身份」的全栈闭环 —— 脚本化真实入网(`IDENTITY_CREATE` → account-link 签发 WalletAccountCredential → email/username 验证经 Node 发信、从 Mailpit `:8025` 读取 6 位验证码 confirm 签发 Email/Username 凭证,断言三类凭证齐备),再经注入的 EIP-1193 provider 连接(`#approveConnect`)后 `wallet_identity_presentation` 凭 30s 连接窗静默授权直接产出 Ed25519 VP(无二次审批窗),最后 `POST /auth/identity/login/verify` 由 Router 用 `trust_dir` 信任材料校验 VP 并签发 token,断言 `data.did` / `data.user.wallet_identity_did` 与 DID 一致、`walletAddress` 与账户地址一致;Node `:8100` 不可达时据实跳过。本地真实 Node + Mailpit + Router 全栈下多轮重跑确定绿。**RT-API-067 每次跑均为全新 HD 种子 → 全新 EVM 地址 + 全新 DID + 唯一用户名,对 Router 三者皆未见过,故只能命中 `autoCreateWalletIdentityUser` 自动建号分支(断言落库 DID/地址/用户名 + `role===1` 普通用户)—— 等价于「全新用户仅凭钱包身份注册并登录」的证明**(本部署 `AutoRegisterEnabled=true`;`has_password` 不断言:repo `Create()` 见非空 Password 即置 true)。**新增 RT-API-068(P0 负路径,⬜ 降级跳过)**:同一套真实入网 + VP,断言自动注册关闭时未关联身份被受控拒绝「未找到钱包身份关联的账户,请先绑定或由管理员开启自动注册」;本部署自动注册开启故该分支不可达,verify 成功即据实降级跳过(与 auth-negative 的 SIWE 自动注册探测同一套路)。**新增模块十四~十六「管理员站点级令牌 + 渠道账务快照 + 渠道告警中心」(9 条 API,需 `ROUTER_ADMIN_PRIVATE_KEY`,补齐 router 近期后台管理新功能的 P0 覆盖)**:①站点级令牌(`/api/v1/admin/token/*`)可读写任意用户令牌——列表带归属 `username` + `meta` 分页、按 id/search 检索、`?status_only` 局部更新与整字段改名、删除后再读/再删受控 not-found「令牌不存在或无权访问」+`code:token_not_found`、普通用户 200「权限不足」+ 匿名 401 鉴权边界(被测令牌经用户端创建,受归属账号权益约束,本部署普通/管理账号均「暂无可用模型」无法创建 → 令牌 CRUD 三条据实条件跳过、仅鉴权边界真跑);②渠道账务人工采购快照(`/admin/channel/:id/billing/snapshots`)创建→列表→更新→删除全程(父渠道 `status:2` 停用态 + `finally` 硬删,零路由爆炸半径;CREATE 仅回 `channel_id`、新 id 从列表回读)与请求校验「采购币种不能为空 / 实付金额必须大于 0 / 请至少填写一条权益项」+ 缺失渠道 `record not found`;③渠道告警中心(`/admin/channel/alerts`|`/billing/alerts`|`/:id/billing/alerts`)读取信息流分页 + `summary` 契约、确认→解决幂等 upsert 状态机(始终用合成 `alert_key` 绑停用渠道、绝不触碰真实运营告警)+ 「告警参数无效」校验(状态机用例在部署未迁移 `channel_alert_states` 表时据实跳过,本部署即处此态)。整套 `--project=router` 在 `PWWORKERS=2` 下 **81 通过 / 21 跳过 / 0 失败**(新增 9 条中 5 条真跑绿:令牌鉴权边界、快照 CRUD、快照校验、告警读取、告警校验;4 条按环境前提条件跳过:令牌 CRUD 三条需账号权益、告警状态机需表迁移)。**2026-09-27 用户为两个 router 账号赠额度后,令牌全链真绿**:模块十四令牌 CRUD 三条(RT-069/070/071)由真实套餐/权益路径跑通(RT-070 并据实校验后端设计——整字段更新分支只写 Name/配额/模型等、**不写 status**,状态仅经 `?status_only` 变更);**新增 RT-API-078** 用 `?provider=personal_provider` 过滤隔离,以合成模型名独立证明 BYOK 自助解锁路径(BYOK 连接的模型进入账号可用集并单独满足 `validateTokenModelEntitlement`),与套餐/权益路径正交、零真实路由爆炸半径。**同时修复了赠额度后暴露的 4 条既有令牌 spec 陈旧断言(均非产品缺陷,系无额度时代的过时假设 + web 重构)**:token-api RT-026 改以「名称过长(>30)」作确定性参数校验边界(后端 `validateToken` 接受空 name、且在模型门槛前触发)、RT-031 断言 API 原始 key 为 48 位**无 `sk-` 前缀**(`sk-` 仅前端渲染附加);token-lifecycle 创建成功卡片标题改语言无关的 heading 角色匹配 `令牌已创建|Token created`;token-ui 编辑页现为详情态(名称字段需点「编辑」进入编辑态方可改),并改用 `mintOwnToken` 铸造专属令牌以规避共享账号并发竞争。整套 `--project=router` 在 `PWWORKERS=2` 下 **90 通过 / 13 跳过 / 0 失败**,跨并发 + `--repeat-each` 重跑确定绿(RT-076 告警状态机仍待后端迁移 `channel_alert_states` 表)。

**Wallet** — P0 + P1 + P2 全量覆盖(67/67):非法私钥导入报错、收款二维码/导出账户、自定义网络增改删与默认网络切换、清空历史、通讯录、连续错误解锁的锁定处理;dApp 侧 ReCap(EIP-5573)/watchAsset(EIP-747)/accountsChanged、未连接 eth_accounts 返回空、审批窗关闭即视为拒绝、同源并发复用同一审批窗。**新增云端密钥托管与恢复(模块十,11 条,CUST-\*)**:自定义托管服务经 `context.route` 拦截扩展 service-worker 的 fetch,密文由扩展自身 `encryptObject` 在页面内构造(与 SW `decryptObject` 字节对齐),经 `sendSw` 驱动 SW 总线,全部离线确定跑通——默认配置口径、配置弹窗地址校验(非法拒绝/合法去尾斜杠)、未绑通行证/锁定+错误密码开启被拒(证明上传前拦截、零 HTTP)、恢复令牌读取记录、错误密码/密文篡改/未知版本字段缺失/地址不匹配四类完整性拒绝(均断言具体错误消息以防 stub-miss 造成假绿)、正常关闭发出恰一次 DELETE、删除失败保留 enabled=true 的回滚语义。整链联调用例(已绑通行证开启、HD/私钥整链恢复、新设备通行证恢复、UCAN 权限边界)因需真实 Node/托管服务,仍 ⬜。**修复了 1 处真实回归缺陷(直接改钱包仓库,已授权)**:WL-UI-008 备份文件导入 —— 导入页改为「来源 tab + 方式 tab」两级后,`import-wallet-controller.js:handleImportWallet` 曾只按方式 tab(默认恒为 mnemonic)推导 `importType`、从不根据 `source==='file'` 路由;改为 `importType = source==='file' ? 'file' : <方式 tab 类型>` 后,导出→导入整程通过,`test.fixme` 已移除恢复真跑。整套 `--project=wallet` 在 `PWWORKERS=2` 下 73 通过/2 跳过/0 失败(另有既有的真实 Sepolia 广播用例按余额条件跳过)。

**Chat**(NextChat 定制版)— P0 + P1 + P2 大批补齐(69/92):健康/配置探针、钱包 SIWE→UCAN 登录准入与重定向/登出、侧栏/新建会话/技能 UI、会话列表/切换/搜索、Provider 代理边界、设置(主题/地址/重置/清除)、云同步与 WebDAV 代理白名单/透传、Router 令牌列表/选择/用量/充值跳转、发现/技能编辑器/插件/工具市场、图像页/历史、artifacts 分享边界。真实 SIWE→UCAN 登录成功进入应用外壳;无 provider key 且 Router 未充值时模型目录为空,授权用户落到 `/setup`,如实断言、未伪造流式回复。整套 `--project=chat` 在 `PWWORKERS=2` 下 52 通过/42 跳过/0 失败。剩余 23 条受阻:LLM 会话需真实 key/令牌(spec 就绪、有 key 即真跑);会话级置顶/访问码/自定义模型/系统提示模板等本构建特性缺失或位置不同;`needCode`/`HIDE_USER_API_KEY`/`ENABLE_TOOLS` 配置固定致触发态不可复现;UCAN 外部授权、STABILITY 出图、ShareGPT 外发需外部系统。**发现 2 处真实产品缺陷**(诚实断言边界、未修改产品仓库):① `app/api/[provider]` 与 `app/api/artifacts` 误用 `dynamic="force-static"` 却读请求 → 所有已识别 provider 与 artifacts POST/GET 均 500(仅未知 provider 分支正常);② WebDAV 代理未放行 PROPFIND(返回 403,与文档不符)。另记一处并发健壮性问题:共享钱包并发同步同一 WebDAV workspace 会偶发 WorkspaceSyncError(可恢复,已在 helper 重试)。

**Social** — P0 + P1 + P2 已补齐(81/87):refresh 负路径、改密旧码错误、解绑钱包、注销、终端在线状态、好友/群免打扰、已读指针/群消息已读用户、超大文件上传拒绝、AI 改写/建议/摘要(本地 provider 真跑)、RTC 系统配置、钱包登录无插件优雅提示与注册页 UI。剩余 6 条受阻:过期 accessToken(需服务端 HMAC 密钥伪造合法过期串)、1:1 通话信令与通话面板(需在线 WS 对端 + 摄像头/麦克风)、二维码登录轮询(需外部 passport 审批)、图片/文件/语音发送(getUserMedia)、群聊 @ 成员(IM WebSocket 花名册未握手)。注:web3-graph/incentive 后端为空壳,未纳入。

**Project**(夜莺/DooTask)— P0 + P1 + P2 已补齐(138/141):图形验证码、token 临近过期轮换、passport 轮询、项目移交/置顶/排序、复制任务/任务聊天室/协助人上限、删除工作流、标签上限、文件内容保存 + 共享、消息与群组、汇报标记与模板、改邮箱/设备登出/删号、令牌审计 + AK/SK 头 + 建令牌 UI、会员/联系人/文件/消息搜索、404 页。剩余 3 条为管理员受阻(站点 admin 账号被验证码锁,无法用临时账号驱动 `auth("admin")`):部门只读视角、令牌审计记录、部门列表增删改。注:该套件写单个共享 MySQL,默认 5 worker 会因争用出现轮换性客户端超时(非缺陷,后端全程 200、无 OOM);须以 `PWWORKERS=2 npx playwright test --project=project` 跑得确定性 0 失败(136 通过/8 跳过/0 失败,0 flaky)。

**Knowledge** — SIWE 登录换双令牌、受保护接口 401 基线、知识库创建、Search Lab 三模式检索对比、
面向 Agent 的服务检索(`X-Service-Api-Key`)。实为完整知识运营系统,17 个模块业务链路全待建。

**Orchestrator** — 钱包 challenge/sign/verify、Cookie 会话校验、未登录重定向、运行概览/实例页访问及登录后的侧栏导航切换已覆盖；错误签名拒绝、重放保护、实例生命周期与内部运维 API 仍待实现。

**Marketplace** — 全量覆盖(59/59)。技能包与 Tool Server 的完整 schema 校验(必填字段、kebab-case/semver、name/description localizedText、launch/instructions 的 oneOf、icon/permissions/release 枚举、additionalProperties=false),index↔packages 一致性与版本对齐、tools/index↔tools/packages 对齐、path/toolServers[].id 引用全部落到真实文件、(id,lang) 唯一、统一 Skill 一级目录入口可识别、Agent-only Skill 不进入 Chat 清单、确定性排序、npx @yeying-community 本地源码存在,以及未设 BASE_URL 时的磁盘回退与非法/空/缺失输入的边界(临时 fixture,不改真实仓库)。纯文件校验,无需服务。未发现数据缺陷。

**Books** — P2 数据校验已补齐(32/35):SUMMARY 结构/编号、死链与仓库内相对路径扫描、章节孤儿双向校验、跨文件与文内 #锚点解析及重复歧义、图片/资产孤儿与 alt、UTF-8/代码围栏成对/CRLF、总览↔单产品目录一致、"纯 SUMMARY 目录型仓库"构建契约。纯文件校验,无需服务。**发现 2 处真实缺陷(以 `test.fixme` 如实标记,未弱化断言、未修改产品仓库)**:① `agent/README.md:26` 的 SUMMARY 链接写成机器绝对路径且缺 `opensource/` 段 → 死链(应改相对 `./SUMMARY.md`);② `yeying/2A068D22-…​.png` 为无任何 markdown 引用的孤儿图片资产。剩余 3 条 ⬜ 即这两处缺陷对应用例(BK-DATA-009/012/023)。
