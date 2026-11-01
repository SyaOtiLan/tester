# 钱包 Wallet — 端到端测试用例

> 测试人员视角整理的**应有** E2E 用例清单,作为实现依据。
> 状态说明:✅ 已实现(链接到 spec) / ⬜ 待实现 / 🐞 已实现但被真实产品缺陷阻塞(`test.fixme`,产品修复后即恢复真跑)。
> 形态:浏览器扩展(popup + service worker + dApp provider)。基于 MV3,名称「夜莺钱包 / YeYing Wallet」,rdns `io.github.yeying`。
> 最后更新:2026-10-29

## 覆盖总览

| 模块                     | 用例数 | 已实现 | 待实现 |
| ------------------------ | ------ | ------ | ------ |
| 一、钱包创建与初始化     | 5      | 5      | 0      |
| 二、钱包导入             | 6      | 6      | 0      |
| 三、账户管理             | 5      | 5      | 0      |
| 四、网络管理             | 5      | 5      | 0      |
| 五、安全与锁定恢复       | 5      | 5      | 0      |
| 六、转账与交易           | 9      | 9      | 0      |
| 七、消息签名与授权       | 5      | 5      | 0      |
| 八、dApp 连接与 Provider | 13     | 13     | 0      |
| 九、错误、异常与安全边界 | 4      | 4      | 0      |
| 十、云端密钥托管与恢复   | 12     | 12     | 0      |
| **合计**                 | **69** | **69** | **0**  |

> 文档与基线:wallet 云端密钥托管的可重复验收基线见钱包仓库 `docs/钱包测试/密钥托管验收标准.md`(CUST-001..072)。本节 11 条 CUST-001..071 用例覆盖离线配置、启停、密文和恢复校验；新增 CUST-073 通过 stub Node 授权与托管服务覆盖新设备 PKCE 恢复 UI、原 DID 恢复及身份登录签名。该用例验证 Wallet 客户端全链路，不替代真实 Node/Passkey 联调；CUST-010/020..023、CUST-031/032 实际服务联调、UCAN 权限边界 CUST-060..062 和远端删除 CUST-072 仍待真实 Node/托管服务环境。

> 编号说明:`WL-UI-*` 为 popup 内交互;`WL-DAPP-*` 为经 `window.ethereum` / 审批窗的 dApp 交互;`WL-E2E-*` 为跨真实链/网络的端到端流程。
> 通用前置(除特别说明外均适用):已通过 `WALLET_EXTENSION_PATH` 指向钱包源码目录;用 `loadWalletContext()` 启动带扩展的持久化 Chromium;`stubPublicEndpoints` 屏蔽 YeYing 公共端点以保证用例可离线运行。
> 现有 dApp 相关用例(WL-DAPP-006/007/008)在 node/router/warehouse 三个站点各有一份等价实现,链接列出三处;缺少对应站点环境变量(`NODE_BASE_URL` / `ROUTER_BASE_URL` / `WAREHOUSE_BASE_URL`)时自动跳过。

---

## 一、钱包创建与初始化

### WL-UI-001 欢迎页 → 新建钱包 → 设置密码 → 进入主页

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-create.spec.ts
- 前置条件:全新安装、无既有钱包。
- 步骤:
  1. 打开 `chrome-extension://<id>/html/popup.html`,标题应为「夜莺钱包」。
  2. `#welcomePage` 可见,`#welcomeCreateWalletBtn` 文案为「新建钱包」,点击。
  3. `#setPasswordPage` 可见,填写 `#setWalletName`,点击 `#setPasswordBtn`。
  4. 在 `#passwordPromptInput` 填入密码,点击 `#passwordPromptConfirm`。
- 预期结果:`#walletPage` 在 30s 内可见;`#accountAddress` 为截断地址形式 `0x1234…abcd`(`…` 或 `...`)。

### WL-UI-002 创建后关闭并重开弹窗仍停留主页(状态持久化)

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-create.spec.ts
- 前置条件:已按 WL-UI-001 创建钱包。
- 步骤:
  1. 关闭 popup 页面(不销毁浏览器上下文)。
  2. 重新打开 popup URL。
- 预期结果:直接落在 `#walletPage`,无需重新创建,说明钱包状态已持久化到 `chrome.storage`。

### WL-UI-003 设置密码页自动填充 `hd-NNNN` 钱包名且可编辑

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-create.spec.ts
- 前置条件:处于 `#setPasswordPage`。
- 步骤:
  1. 观察 `#setWalletName` 默认值,应匹配 `^hd-\d{4}$`。
  2. 覆盖填入自定义名称并继续。
- 预期结果:默认名格式正确;自定义名生效并沿用到主页账户名。

### WL-UI-004 popup 视口与上下文形态符合预期

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-create.spec.ts
- 前置条件:无。
- 步骤:
  1. 断言 popup 默认视口为 380×600。
  2. 断言 `loadWalletContext()` 返回的 `extensionId` 匹配 `^[a-z]{32}$`、`userDataDir` 含 `yeying-wallet-e2e-`、`context` 有效。
- 预期结果:形态稳定,契约不漂移。

### WL-UI-005 设置密码时两次输入不一致 / 空密码被拒绝

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-set-password-validation.spec.ts
- 前置条件:处于设置密码流程。
- 步骤:
  1. 提交空密码,或(若有确认框)两次输入不一致。
  2. 观察提示。
- 预期结果:不进入 `#walletPage`,给出明确错误提示(toast 或字段校验),密码未被设置。

---

## 二、钱包导入

### WL-UI-006 助记词导入并派生正确地址

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-import.spec.ts
- 前置条件:无既有钱包;使用已知助记词 `test test ... junk`(Hardhat/Anvil 账户 #0)。
- 步骤:
  1. 欢迎页点击 `#welcomeImportWalletBtn` 进入 `#importPage`。
  2. 确认默认 tab 为助记词(`.import-tab.active[data-type=mnemonic]`)。
  3. 填 `#importMnemonic`、`#importAccountName`、`#importWalletPassword`,点击 `#importBtn`。
- 预期结果:落在 `#walletPage`;`#accountAddress` 截断形式包含 `0xf39`…`92266`。

### WL-UI-007 私钥导入得到对应账户

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-import-privatekey.spec.ts
- 前置条件:准备一个已知私钥及其期望地址。
- 步骤:
  1. 进入 `#importPage`,点击「私钥」tab(`.import-tab[data-type=privateKey]`)。
  2. 在 `#importPrivateKey` 填入私钥,填账户名与密码,点击 `#importBtn`。
- 预期结果:落在 `#walletPage`,`#accountAddress` 为该私钥对应地址的截断形式。

### WL-UI-008 备份文件 / Keystore 导入

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-import-file.spec.ts
- 前置条件:准备一份包含钱包账户和 Wallet Identity 的加密备份文件及其解密口令。
- 步骤:
  1. 进入 `#importPage`,点击外层「备份文件」来源 tab(`.import-source-tab[data-source=file]`),`#fileImportSection` 显示。
  2. 选择备份文件、输入口令并提交(「导入备份」)。
  3. 在全新扩展上下文查询恢复后的 Wallet Identity。
- 预期结果:成功恢复其中账户,落在 `#walletPage`,账户列表与备份一致；`walletIdentityId` 与导出设备保持一致。
- **任务 239 回归**:导出会校验并重新包裹 Wallet Identity 私钥；历史 Identity 仍由旧钱包密码保护时可输入旧密码修复，旧密码不可得时允许仅恢复钱包账户并明确提示 Identity 未恢复。自动化用例覆盖正常的跨设备账户 + Wallet Identity 往返；旧密码修复和降级恢复由产品仓库单元/控制器测试覆盖。
- **恢复登录回归**:导入后通过 dApp 的 `wallet_requestPermissions` 授权 `identity.basic`，检查 Wallet Identity 登录 Presentation 的 audience、nonce、DID 文档签名和 Presentation 签名；锁定钱包后输入密码仍可继续身份登录。
- **修复记录(云端恢复改造回归,已修)**:导入页改为「来源 tab(助记词/私钥·备份文件·云端恢复)+ 方式 tab(助记词/私钥)」两级后,`import-wallet-controller.js:handleImportWallet` 曾只按 `.import-method-tab.active`(默认恒为 mnemonic)推导 `importType`,从不根据 `source==='file'` 路由 → 点击「导入备份」实际走了助记词分支,因助记词为空报「请输入助记词」并返回。修复:`importType = source === 'file' ? 'file' : <方式 tab 类型>`,文件导入分支已完整支持(`importAccountsFile`)。修复后本用例移除 `test.fixme` 恢复真跑,导出→导入整程通过。

### WL-UI-035 错误密码 / 篡改备份文件不得产生部分恢复

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-import-backup-integrity.spec.ts
- 前置条件:准备一份有效的加密备份及一份 AES-GCM 密文被修改的副本;导入设备为空。
- 步骤:依次使用错误密码导入有效文件、再以正确密码导入被篡改文件。
- 预期结果:两次都停留在导入页;不显示钱包主页、不创建钱包或身份，错误必须可见。

### WL-UI-009 导入非法助记词报错且不进入主页

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-import-negative.spec.ts
- 前置条件:无。
- 步骤:
  1. 助记词 tab 填入词数错误 / 含非 BIP-39 词的字符串,提交。
- 预期结果:停留在导入页,给出「助记词无效」类错误提示,不创建账户。

### WL-UI-010 导入非法私钥报错

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-import-negative.spec.ts:61
- 前置条件:无。
- 步骤:
  1. 私钥 tab 填入长度/格式非法的私钥,提交。
- 预期结果:停留在导入页并提示格式错误,不创建账户。

---

## 三、账户管理

### WL-UI-011 新增第二个 HD 派生账户并从顶部切换

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-accounts.spec.ts
- 前置条件:已创建 HD 钱包(仅 1 个账户)。
- 步骤:
  1. `#accountHeader` 打开切换菜单,确认仅 1 项;点击 `#manageAccountsBtn` 进 `#accountsPage`。
  2. 点击「添加账户」行,填 `#newAccountName`,`#confirmCreateAccount` 确认(如弹密码框则填密码)。
  3. 回主页后从 `#accountHeader` 切换到另一账户。
- 预期结果:账户列表出现 2 行;切换后 `#accountName` 变为另一账户名。

### WL-UI-012 账户详情页重命名并持久化

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-accounts.spec.ts
- 前置条件:至少 1 个账户。
- 步骤:
  1. 进 `#accountsPage`,点击账户项打开 `#accountDetailPage`。
  2. 点 `#editAccountNameBtn`,在 `#accountDetailNameInput` 填新名(≤20 字),点 `#saveAccountNameBtn`。
- 预期结果:`#accountDetailNameText` 显示新名并持久化。

### WL-UI-013 删除 / 移除账户

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-accounts.spec.ts
- 前置条件:至少 2 个账户(避免删除唯一账户)。
- 步骤:
  1. 触发删除,弹出 `#deleteAccountModal`,核对 `#deleteAccountName` / `#deleteAccountAddress`。
  2. 点 `#confirmDeleteAccount`(必要时输入密码)。
- 预期结果:该账户从列表移除;若删除的是当前账户则自动切到其他账户;取消(`#cancelDeleteAccount`)则不删除。

### WL-UI-014 账户详情展示收款二维码并复制地址

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-account-detail.spec.ts:33
- 前置条件:至少 1 个账户。
- 步骤:
  1. 进 `#accountDetailPage`,确认 `#accountDetailQr` 渲染二维码、`#accountDetailAddress` 显示完整地址。
  2. 点 `#copyAccountAddressBtn` 复制地址。
- 预期结果:二维码可见;复制后剪贴板为该账户完整地址,并有复制成功提示。

### WL-UI-015 导出账户

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-account-detail.spec.ts:94
- 前置条件:已创建钱包。
- 步骤:
  1. 在账户管理页点 `#accountsExportBtn`(或详情页 `#exportAccountQrBtn`),按需输入密码。
- 预期结果:生成可再导入的备份/二维码,内容与当前账户一致,且需密码校验。

---

## 四、网络管理

### WL-UI-016 新增自定义网络并切换

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-network.spec.ts
- 前置条件:已创建钱包;对自定义 RPC 地址提供 JSON-RPC 桩(返回 `eth_chainId` 等)。
- 步骤:
  1. 网络选择器 → `.network-option-manage` 进 `#networkManagePage`。
  2. `#networkAddBtn` → `#networkFormPage`,填名称/RPC/ChainId/符号,`#saveNetworkBtn`。
  3. 返回后在选择器中选中该网络。
- 预期结果:新网络出现在 `#networkManageList`;切换后 `.network-label` 显示其名称。

### WL-UI-017 编辑已有自定义网络

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-network.spec.ts:174
- 前置条件:已存在一个自定义网络。
- 步骤:
  1. 进 `#networkManagePage`,进入该网络编辑,修改名称/RPC/符号并保存。
- 预期结果:列表与选择器反映更新后的字段;切换后标签为新名称。

### WL-UI-018 删除自定义网络

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-network.spec.ts:256
- 前置条件:已存在一个自定义网络且当前未激活它。
- 步骤:
  1. 在 `#networkManagePage` 删除该网络并确认。
- 预期结果:该网络从列表与所有选择器移除;不影响默认网络。

### WL-UI-019 默认网络存在且可切换

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-network.spec.ts:309
- 前置条件:全新钱包(未加自定义网络)。
- 步骤:
  1. 打开网络选择器,查看内置网络。
  2. 在以太坊主网与 YeYing 主网之间切换。
- 预期结果:内置至少含「以太坊主网」与「YeYing 主网」;切换后标签与 `chainId` 相应变化。

### WL-UI-020 切换到不可达 RPC 网络时失败并回退

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-network.spec.ts
- 前置条件:添加一个 RPC 不可达(不打桩)的自定义网络。
- 步骤:
  1. 尝试切换到该网络(触发对新 RPC 的 `eth_chainId`)。
- 预期结果:切换失败并给出错误提示,当前网络回退为切换前的网络,不出现空白/卡死。

---

## 五、安全与锁定恢复

### WL-UI-021 输入密码查看助记词与私钥

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-security.spec.ts
- 前置条件:HD 钱包已解锁。
- 步骤:
  1. 账户管理页点 `.view-mnemonic-btn`,在 `#passwordPromptModal` 输入密码。
  2. `#secretDisplayValue` 展示 12/15/18/21/24 词助记词;关闭。
  3. 点 `.view-private-key-btn`,输入密码,`#secretDisplayValue` 展示 `0x`+64 hex 私钥。
- 预期结果:助记词词数合法、私钥格式正确;均需密码校验后才展示。

### WL-UI-022 修改密码后旧密码失效、新密码可解锁

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-security.spec.ts
- 前置条件:钱包已解锁。
- 步骤:
  1. 设置页 `#changePasswordBtn` → `#changePasswordModal`,填旧/新/确认密码,`#confirmChangePasswordBtn`。
  2. 锁定钱包;先用旧密码解锁,再用新密码解锁。
- 预期结果:旧密码无法解锁(停留 `#unlockPage`);新密码进入 `#walletPage`。

### WL-UI-023 锁定 → 解锁 → 错误密码 toast → SW 被杀恢复

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-lock-unlock.spec.ts
- 前置条件:钱包已创建并解锁,记录当前地址。
- 步骤:
  1. 菜单 `#lockWalletBtn` 锁定,重开弹窗落在 `#unlockPage`。
  2. 输错密码 → `#globalToast` 含「密码错误」;正确密码 → `#walletPage`。
  3. 经 CDP 关闭扩展 service worker,重开弹窗,再次用密码解锁。
- 预期结果:SW 被回收后仍能凭密码 + `chrome.storage` 恢复到**同一账户**;`#globalWaitingOverlay` 不卡住。

### WL-UI-024 使用错误密码查看私钥/助记词被拒绝

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-security.spec.ts
- 前置条件:钱包已解锁。
- 步骤:
  1. 触发查看私钥/助记词,在 `#passwordPromptModal` 输入**错误**密码确认。
- 预期结果:不展示 `#secretDisplayModal`,给出密码错误提示;敏感信息不泄露。

### WL-UI-025 修改密码时旧密码错误被拒绝

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-security.spec.ts
- 前置条件:钱包已解锁。
- 步骤:
  1. `#changePasswordModal` 中 `#oldPasswordInput` 填错误旧密码,新密码合法,提交。
- 预期结果:修改失败并提示旧密码错误;原密码仍有效(可用原密码解锁)。

---

## 六、转账与交易

### WL-UI-026 转账表单跨弹窗关闭/重开保留输入

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-transfer-form.spec.ts
- 前置条件:钱包已解锁。
- 步骤:
  1. `#transferBtn` 进 `#transferPage`,填 `#recipientAddress` 与 `#amount`。
  2. 关闭 popup 页面,重开。
- 预期结果:重开自动回到 `#transferPage` 且字段值保留;未触发重新锁定;后退返回 `#walletPage`。

### WL-E2E-001 Sepolia 真实广播交易并在活动列表与链上确认

- 优先级:P0
- 类型:E2E
- 状态:✅ 已实现 — products/wallet/tests/popup-send-tx.spec.ts
- 前置条件:**需真实网络**——Sepolia 公共 RPC 可达;导入的账户在 Sepolia 有足够余额(≥ 约 0.00003 ETH,不足则用例自动跳过);屏蔽 `*.yeying.pub` 与主网 RPC。
- 步骤:
  1. 导入 Hardhat 助记词(账户 #0)。
  2. 经 SW 消息 `ADD_CUSTOM_NETWORK` 注册 Sepolia,再经转账页选择器切换到 Sepolia。
  3. 收款填销毁地址 `0x00..01`、金额极小值,`#sendBtn` 提交,如弹密码框则填密码。
  4. 等 `#globalWaitingOverlay` 出现并消失。
- 预期结果:`#transactionList` 出现携带 `data-tx-hash`(`0x`+64 hex)的新交易;经 `eth_getTransactionByHash` 交叉校验 `from` 为该账户,交易确实上链。

### WL-UI-027 收款地址非法(EIP-55 校验和)被拒绝

- 优先级:P0
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-transfer-address-validation.spec.ts
- 前置条件:钱包已解锁并进入转账页。
- 步骤:
  1. `#recipientAddress` 填入混合大小写但校验和错误的地址(改动某一位),填合法金额,`#sendBtn`。
  2. 另测:填入长度错误/含非 hex 字符的地址。
- 预期结果:拒绝提交并提示地址无效;纯大小写(全大写/全小写)地址应放行,混合大小写强制 EIP-55 校验。

### WL-UI-028 金额超过余额 / 余额不足提示

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-send-insufficient.spec.ts
- 前置条件:钱包已解锁,已知当前余额(可对 `eth_getBalance` 打桩)。
- 步骤:
  1. 转账页填入大于余额的金额并提交。
- 预期结果:阻止发送并提示余额不足 / 无法覆盖金额+gas,不产生广播。

### WL-UI-029 交易详情页展示

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-tx-detail.spec.ts
- 前置条件:活动列表中至少有一笔交易。
- 步骤:
  1. 点击 `#transactionList` 中的交易项进入 `#transactionDetailPage`。
  2. 核对哈希、状态、from/to、网络、区块、时间与浏览器链接(`#txDetailHash` / `#txDetailStatus` / `#txDetailFrom` / `#txDetailTo` / `#txDetailNetwork` / `#txDetailExplorerLink` 等)。
- 预期结果:各字段与该交易一致;`#txDetailCopyHash` 等复制按钮可用;浏览器链接指向正确 explorer。

### WL-UI-030 清空交易历史

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-clear-transactions.spec.ts:33
- 前置条件:活动列表非空。
- 步骤:
  1. 点 `#clearTransactionsBtn` 并确认。
- 预期结果:`#transactionList` 清空(或仅清本地记录),操作有确认防误触。

### WL-UI-031 添加 ERC-20 代币并展示余额

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-token.spec.ts
- 前置条件:钱包已解锁;对代币合约的 `balanceOf`/元数据 RPC 打桩。
- 步骤:
  1. 代币 tab 点 `#tokenAddBtn` 进 `#tokenAddPage`,填 `#tokenAddressInput`(可自动带出 symbol/decimals),`#saveTokenBtn`。
- 预期结果:`#tokenList` 出现该代币并展示余额;`#cancelTokenBtn` 可取消不添加。

### WL-UI-032 转账 ERC-20 代币

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-token.spec.ts
- 前置条件:已添加一个 ERC-20 代币且账户持有余额(可打桩)。
- 步骤:
  1. 转账页将资产切换到该代币(`#transferTokenSymbol`),填收款地址与金额,提交。
- 预期结果:构造 ERC-20 `transfer` 调用而非原生转账,数额按 decimals 换算正确,进入待广播/审批流程。

### WL-UI-033 通讯录新增联系人并在转账中选用

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-contacts.spec.ts:24
- 前置条件:钱包已解锁。
- 步骤:
  1. 进 `#contactsPage`,`#openAddContactBtn` 打开 `#contactEditorModal`,填 `#contactNameInput` / `#contactAddressInput`,保存。
  2. 转账页经 `#contactSelectorBtn` 选中该联系人。
- 预期结果:联系人出现在 `#contactsList`;选用后 `#recipientAddress` 自动填入其地址。

---

## 七、消息签名与授权

### WL-DAPP-001 dApp `personal_sign` 审批通过返回 65 字节签名

- 优先级:P0
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/popup-signature.spec.ts
- 前置条件:钱包已创建解锁;在受控 https 源打开空白页,provider 已注入。
- 步骤:
  1. `eth_requestAccounts` → 审批窗 `#approveConnect` 批准。
  2. `personal_sign(msg, account)` → 审批窗(`type=sign_message`)`#signRequest` 可见 → `#approveSign`。
- 预期结果:dApp 收到 `0x`+130 hex(65 字节)签名。

### WL-DAPP-002 dApp `personal_sign` 用户拒绝返回 4001

- 优先级:P0
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-reject.spec.ts
- 前置条件:同 WL-DAPP-001,已连接。
- 步骤:
  1. 发起 `personal_sign`,在签名审批窗点 `#rejectSign`。
- 预期结果:dApp 侧 Promise 以 EIP-1193 `4001`(用户拒绝)reject;不产生任何签名。

### WL-DAPP-003 `eth_signTypedData_v4` 审批通过(EIP-712)

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-typed-data.spec.ts
- 前置条件:已连接。
- 步骤:
  1. 以合法 EIP-712 typed data 调 `eth_signTypedData_v4`。
  2. 审批窗(`type=sign_typed_data`)核对域/结构化字段后 `#approveSign`。
- 预期结果:返回合法 65 字节签名;审批窗对 typed data 做结构化展示而非原始串。

### WL-DAPP-004 SIWE(EIP-4361)消息结构化展示并签名

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-siwe.spec.ts
- 前置条件:已连接。
- 步骤:
  1. 以标准 SIWE 文本发起 `personal_sign`。
  2. 审批窗 `#siweSection` 展示 domain/address/nonce/uri/chainId/issuedAt/expiration 等(`#siweDomain` / `#siweNonce` / `#siweUri` …)。
  3. 核对后 `#approveSign`。
- 预期结果:SIWE 字段解析正确并逐项展示;必要时给出告警(`#siweWarnings`);签名有效。

### WL-DAPP-005 ReCap(EIP-5573)能力结构化展示

- 优先级:P2
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-recap.spec.ts:25
- 前置条件:已连接;SIWE 资源含 `urn:recap:` 能力串。
- 步骤:
  1. 发起带 ReCap 的 SIWE 签名请求。
  2. 审批窗 `#recapSection` 展示解析出的能力列表(`#recapList`)。
- 预期结果:ReCap 能力被结构化解析展示,原始串可查(`#recapRaw`),用户可据此判断授权范围。

---

## 八、dApp 连接与 Provider

### WL-DAPP-006 钱包向 dApp 注入 `window.ethereum`(YeYing provider)

- 优先级:P0
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-node.spec.ts、products/wallet/tests/dapp-router.spec.ts、products/wallet/tests/dapp-warehouse.spec.ts
- 前置条件:对应站点可达(否则跳过);钱包已解锁。
- 步骤:
  1. 新标签打开目标 SPA,等待内容脚本注入 provider。
  2. 读取 `window.ethereum` 的 `isYeYing` / `isMetaMask` / `chainId`。
- 预期结果:`isYeYing===true`、`isMetaMask` 假值、`chainId` 匹配 `^0x[0-9a-fA-F]+$`(默认 YeYing 0x1538),未被任何 shim 覆盖。

### WL-DAPP-007 EIP-6963 `announceProvider` 被 dApp 发现

- 优先级:P0
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-node.spec.ts、products/wallet/tests/dapp-router.spec.ts、products/wallet/tests/dapp-warehouse.spec.ts
- 前置条件:同上。
- 步骤:
  1. 页面派发 `eip6963:requestProvider`,监听 `eip6963:announceProvider`。
- 预期结果:收到 detail.info:`name==='YeYing Wallet'`、`rdns==='io.github.yeying'`、`uuid` 为 36 位、`icon` 为 `data:image/svg+xml`。

### WL-DAPP-008 `eth_requestAccounts` 弹审批窗并批准返回账户

- 优先级:P0
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-node.spec.ts、products/wallet/tests/dapp-router.spec.ts、products/wallet/tests/dapp-warehouse.spec.ts
- 前置条件:钱包已解锁;站点可达。
- 步骤:
  1. dApp 调 `eth_requestAccounts`。
  2. 捕获审批窗(`type=connect`),点 `#approveConnect`。
- 预期结果:dApp 收到长度 1 的账户数组,元素匹配 `^0x[\da-fA-F]{40}$`。

### WL-DAPP-009 连接请求被拒绝返回 4001

- 优先级:P0
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-reject.spec.ts
- 前置条件:钱包已解锁。
- 步骤:
  1. dApp 调 `eth_requestAccounts`,在审批窗点 `#rejectConnect`。
- 预期结果:dApp Promise 以 `4001` reject;`eth_accounts` 仍返回空;站点未被授权。

### WL-DAPP-010 EIP-2255 权限:request / get / revoke

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-permissions.spec.ts
- 前置条件:钱包已解锁。
- 步骤:
  1. `wallet_requestPermissions({ eth_accounts: {} })` → 审批批准。
  2. `wallet_getPermissions` 读取当前权限。
  3. `wallet_revokePermissions({ eth_accounts: {} })` 撤销后再读。
- 预期结果:批准后 getPermissions 含 `eth_accounts`;撤销后不再包含,`eth_accounts` 回到空。

### WL-DAPP-011 `wallet_switchEthereumChain`(EIP-3326)审批 + chainChanged

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-chain.spec.ts
- 实现说明:当前实现由后台 `chain-handler.js` 直接处理,不弹审批窗(无 `#addChainRequest` 等 UI);已知链静默切换并广播 `chainChanged`,未知链返回 4902。用例据实断言该行为。
- 前置条件:已连接;目标链已存在于钱包。
- 步骤:
  1. dApp 监听 `chainChanged`,调 `wallet_switchEthereumChain({ chainId })`。
  2. 审批窗批准。
- 预期结果:切换成功;dApp 收到 `chainChanged` 且 `ethereum.chainId` 更新为目标链;切换未知链应返回 4902。

### WL-DAPP-012 `wallet_addEthereumChain`(EIP-3085)审批

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-chain.spec.ts
- 实现说明:当前实现由后台 `chain-handler.js` 直接处理,不弹 `#addChainRequest` 审批窗;校验参数后静默添加并切换到新链,广播 `chainChanged`。用例据实断言该行为。
- 前置条件:已连接;目标链尚未添加。
- 步骤:
  1. dApp 调 `wallet_addEthereumChain(params)`。
  2. 审批窗 `#addChainRequest` 展示 `#chainName` / `#chainId` / `#chainRpcUrl` / `#chainSymbol` / `#chainExplorer`,点 `#approveAddChain`。
- 预期结果:新链加入钱包网络列表;字段与请求一致;`#rejectAddChain` 则不添加。

### WL-DAPP-013 `wallet_watchAsset`(EIP-747)审批

- 优先级:P2
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-watch-asset.spec.ts:65
- 前置条件:已连接。
- 步骤:
  1. dApp 调 `wallet_watchAsset`(ERC-20)。
  2. 审批窗 `#watchAssetRequest` 展示 `#assetAddress` / `#assetSymbol` / `#assetDecimals` / `#assetImage`,点 `#approveWatchAsset`。
- 预期结果:代币加入代币列表;`#rejectWatchAsset` 则不加入并返回 false。

### WL-DAPP-014 `eth_sendTransaction` 从 dApp 触发交易审批窗

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-send-tx.spec.ts
- 前置条件:已连接;对 RPC 打桩或使用测试链。
- 步骤:
  1. dApp 调 `eth_sendTransaction(tx)`。
  2. 审批窗(`type=transaction`)`#transactionRequest` 展示 `#txTo` / `#txValue` / `#txGasLimit` / `#txGasPrice` / `#txData`,点 `#approveTx`。
- 预期结果:批准后返回交易哈希并广播;`#rejectTx` 返回 4001 且不广播。

### WL-DAPP-015 已连接站点管理:查看与撤销授权

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-sites.spec.ts
- 前置条件:已至少授权一个 dApp 源。
- 步骤:
  1. 进 `#sitesPage`,`#authorizedSitesList` 含该源;打开 `#siteDetailModal` 核对 `#siteDetailOrigin` / `#siteDetailAddress`(及 UCAN 会话信息)。
  2. 点 `#revokeSiteDetailBtn` 撤销。
- 预期结果:撤销后该源从列表移除;该站点后续请求需重新走连接审批。

### WL-DAPP-016 钱包锁定时 dApp 请求触发解锁审批窗

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-unlock.spec.ts
- 前置条件:已授权站点,但钱包当前处于锁定态。
- 步骤:
  1. dApp 发起需私钥的请求(如 `personal_sign`)。
  2. 出现解锁审批窗(`type=unlock`),`#unlockReason` 说明来源/方法,填 `#unlockPassword` 点 `#approveUnlock`。
- 预期结果:解锁后原请求继续完成;`#cancelUnlock` 则原请求以拒绝/错误返回。

### WL-DAPP-017 连接后切换账户触发 accountsChanged

- 优先级:P2
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-accounts.spec.ts:77
- 前置条件:dApp 已连接,钱包有 ≥2 账户。
- 步骤:
  1. dApp 监听 `accountsChanged`;在 popup 切换当前账户。
- 预期结果:dApp 收到 `accountsChanged`,新数组首项为切换后的账户地址。

### WL-DAPP-018 未连接时 `eth_accounts` 返回空数组

- 优先级:P2
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-accounts.spec.ts:58
- 前置条件:钱包已解锁但该源未授权。
- 步骤:
  1. dApp 直接调 `eth_accounts`(不先 requestAccounts)。
- 预期结果:返回 `[]`,不弹审批窗,不泄露地址。

---

## 九、错误、异常与安全边界

### WL-DAPP-019 链不匹配的提示与处理

- 优先级:P1
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-chain.spec.ts
- 前置条件:已连接;dApp 期望链与钱包当前链不同。
- 步骤:
  1. dApp 在链 A 状态下请求属于链 B 的操作(或 SIWE 带不同 chainId)。
- 预期结果:钱包给出链不匹配提示或引导切链(`wallet_switchEthereumChain`),不静默在错误链上签名/发交易。

### WL-DAPP-020 审批窗关闭/超时视为拒绝

- 优先级:P2
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-approval-lifecycle.spec.ts:44
- 前置条件:已解锁。
- 步骤:
  1. dApp 发起需审批的请求,不点批准/拒绝,直接关闭审批窗(或等待超时)。
- 预期结果:dApp Promise 以用户拒绝/超时错误 reject,不留下悬挂请求,后续请求可正常发起。

### WL-DAPP-021 同源并发/重复请求复用同一审批窗

- 优先级:P2
- 类型:DAPP
- 状态:✅ 已实现 — products/wallet/tests/dapp-approval-lifecycle.spec.ts:86
- 前置条件:已解锁(对应钱包审批复用回归)。
- 步骤:
  1. 同一源短时间内连续发起两次需审批请求。
- 预期结果:复用同一审批窗(不叠开多窗);处理一个后另一个按序处理或合并,不产生错乱/丢失。

### WL-UI-034 连续多次错误解锁密码的处理

- 优先级:P2
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/popup-lock-unlock.spec.ts:116
- 前置条件:钱包已锁定。
- 步骤:
  1. 在 `#unlockPage` 连续多次输入错误密码。
- 预期结果:每次均提示「密码错误」且不清空输入;不因多次失败泄露信息或误解锁;如有节流/延迟策略则按策略生效。

---

## 十、云端密钥托管与恢复

> 对应钱包仓库验收基线 `docs/钱包测试/密钥托管验收标准.md`。CUST-001..071 的 11 条用例通过 `helpers/custody.ts:stubCustody` 经 `context.route` 拦截托管服务，托管密文由扩展自己的 `encryptObject` 生成；恢复读取完整性通过 `sendSw` 驱动 service worker。CUST-073 额外覆盖导出加密托管、Node 恢复授权/PKCE、记录选择、解密恢复原 DID，再由真实注入 Provider 完成身份登录并本地验证 DID 文档和 Presentation 的 Ed25519 签名。Node 与托管服务均为可验证请求体和 PKCE 的 stub，不需要外部密钥或真实 Passkey。

### CUST-001 默认配置

- 优先级:P0
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-config.spec.ts:33
- 前置条件:全新安装、无既有钱包。
- 步骤:
  1. `sendSw('CUSTODY_GET_SETTINGS')` 读取默认托管配置。
- 预期结果:`endpoint==='https://node.yeying.pub'`;`ucanResource==='custody'`、`ucanAction==='write'` 固定;`enabled===false`;`lastBackupAt===''`、`lastStatus===null`(未开启)。

### CUST-002 地址校验(配置弹窗)

- 优先级:P1
- 类型:UI
- 状态:✅ 已实现 — products/wallet/tests/custody-config.spec.ts:55
- 前置条件:钱包已创建并解锁。
- 步骤:
  1. 设置页 → `#custodyDetailBtn` → `#custodyConfigBtn` 打开 `#custodyConfigModal`。
  2. `#custodyEndpointInput` 填非法 URL(`not a valid url`),`#custodySaveBtn` 保存。
  3. 填合法且带多余末尾斜杠的 URL(`https://custody.example.com///`)保存。
- 预期结果:非法 URL 被 `readCustodyForm`(`new URL()`)拒绝,弹窗保持打开、存储 endpoint 不变;合法 URL 保存后经 SW `normalizeEndpoint` 去除末尾 `/`(`https://custody.example.com`),弹窗关闭;`ucanResource/ucanAction` 不随地址编辑改变。

### CUST-011 未绑定通行证开启被拒

- 优先级:P0
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-enable-disable.spec.ts:45
- 前置条件:钱包已解锁;stub 托管状态 `passkeyBound:false`。
- 步骤:
  1. `sendSw('CUSTODY_ENABLE', { password, endpoint })`。
- 预期结果:`success:false` 且错误含「打开托管服务前，请先绑定通行证」;**不发生** `POST /custody/secrets`(不上传密文);`settings.enabled` 保持 false。

### CUST-012 锁定 + 错误密码开启被拒

- 优先级:P0
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-enable-disable.spec.ts:68
- 前置条件:钱包已解锁后 `LOCK_WALLET` 锁定(清空 keyring 与密码缓存)。
- 步骤:
  1. 以**错误**密码 `sendSw('CUSTODY_ENABLE', { password, endpoint })`。
- 预期结果:在读取密钥阶段即失败(`createWalletInstance` 解密失败),`success:false` 且错误为规范化「Invalid password / 密码错误」;托管主机**零 HTTP 请求**(证明本地 UCAN/解密门槛拦截,而非 stub-miss);`settings.enabled` 保持 false。
- 备注:钱包解锁态下 keyring 会缓存已解锁账户,`getUnlockedCoordinatorSigningAccount` 不再校验密码,故错误密码用例必须先锁定钱包方能复现。

### CUST-030 读取托管记录(恢复令牌)

- 优先级:P0
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-recovery-integrity.spec.ts:59
- 前置条件:stub `GET /custody/recovery/secrets` 返回 1 条记录 + `identityDid`。
- 步骤:
  1. `sendSw('CUSTODY_LIST_SECRETS', { endpoint, recoveryToken })`。
- 预期结果:`success:true`,`secrets.records` 含该 `walletId`,`identityDid` 透传;作为 stub 拦截 SW fetch 的正向对照。

### CUST-050 密码错误恢复被拒

- 优先级:P0
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-recovery-integrity.spec.ts:83
- 前置条件:以正确口令加密的有效 HD 密文置于恢复记录。
- 步骤:
  1. 以**错误**密码 `sendSw('CUSTODY_RESTORE_SECRET', { walletId, password, endpoint, recoveryToken })`。
- 预期结果:`success:false` 且错误匹配 `/Invalid password or corrupted data/`(证明密文已取回并真正进入解密且失败,而非网络/stub-miss);不导入任何钱包(`GET_CURRENT_ACCOUNT` 地址为空)。

### CUST-051 密文篡改被拒

- 优先级:P0
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-recovery-integrity.spec.ts:110
- 前置条件:对有效密文中部翻转一字符(破坏 AES-GCM 认证)。
- 步骤:
  1. 以正确密码对被篡改密文发起恢复。
- 预期结果:`success:false` 且错误匹配 `/Invalid password or corrupted data/`(GCM 认证失败同错误面);不导入任何钱包。

### CUST-052 未知版本 / 字段缺失被拒

- 优先级:P1
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-recovery-integrity.spec.ts:141
- 前置条件:构造 5 种结构缺陷密文(均以正确口令加密,能解密但结构非法)。
- 步骤:
  1. 逐一恢复:错误 version / 缺 wallet / 缺 accounts / 缺 identities / 缺 mnemonic。
- 预期结果:前四者错误匹配 `/托管记录格式不受支持/`,缺 mnemonic 匹配 `/托管记录缺少助记词/`(证明 `validateCustodySecret` 真正执行);均不导入钱包。

### CUST-053 地址不匹配被拒

- 优先级:P1
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-recovery-integrity.spec.ts:179
- 前置条件:助记词有效但记录首账户地址填成另一地址(派生结果不匹配)。
- 步骤:
  1. 以正确密码发起恢复。
- 预期结果:`success:false` 且错误含「地址校验失败」;不导入钱包。

### CUST-073 新设备云端恢复后以原 Wallet Identity 登录

- 优先级:P0
- 类型:端到端(UI + 托管服务 + dApp Provider)
- 状态:✅ 已实现 — products/wallet/tests/custody-identity-login-recovery.spec.ts
- 前置条件:设备 A 使用 HD 助记词创建 Wallet Identity；设备 B 为干净扩展上下文；Node 授权与托管 HTTP 使用 `stubCustody`。
- 步骤:
  1. 设备 A 创建 HD 钱包和 Wallet Identity，通过 `CUSTODY_ENABLE` 向 stub 上传加密快照；检查上传请求不包含明文助记词或 DID。
  2. 设备 B 从欢迎页选择云端恢复，完成 `identity.basic` + `custody.recovery` 授权请求、PKCE callback/exchange，并确认记录显示原 DID。
  3. 输入原钱包密码恢复钱包，在 `IDENTITY_LIST` 检查原 DID 被选中且控制公钥存在。
  4. dApp 请求 `wallet_identity` 权限并发起身份登录。
- 预期结果:账户地址和 DID 与设备 A 完全一致；Presentation 的 audience、nonce、scope 与请求一致，身份文档和 Presentation 两份签名均通过 Ed25519 验证，响应不泄露私钥或助记词。
- 边界:Node/托管接口由 stub 验证客户端协议，不代表真实 Node、Passkey 或生产环境联调已通过。

### CUST-070 正常关闭托管

- 优先级:P0
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-enable-disable.spec.ts:95
- 前置条件:钱包已解锁;先 `CUSTODY_UPDATE_SETTINGS { enabled:true }`;stub `DELETE /custody/secrets/{walletId}` 返回 200。
- 步骤:
  1. `sendSw('CUSTODY_DISABLE', { endpoint })`。
- 预期结果:`success:true`;`settings.enabled` 翻转为 false;恰好发生 1 次 `DELETE /custody/secrets/{walletId}`。

### CUST-071 删除失败保留开启

- 优先级:P1
- 类型:API(SW)
- 状态:✅ 已实现 — products/wallet/tests/custody-enable-disable.spec.ts:117
- 前置条件:同 CUST-070,但 stub `DELETE` 返回 500。
- 步骤:
  1. 先置 `enabled:true`,再 `CUSTODY_DISABLE`。
- 预期结果:`success:false`;`settings.enabled` **保持 true**(远端删除失败不得伪装为已关闭);失败的 `DELETE` 请求确已发出。
