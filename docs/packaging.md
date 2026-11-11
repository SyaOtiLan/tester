# Tester 发布包

Tester 作为一个 `service` 单元交付：包内 Playwright 运行器、报告处理脚本与 Python 控制服务共同版本化。生成的 HTML、JUnit、截图、运行日志和凭据属于外置数据。代码接入与本地验收不表示服务器已迁移，也不会自动安装 cron、改 Nginx 或启用发布。

## 构建接口

构建要求 Linux x86_64、Python 3.10+、Node.js >=24.18 和 pnpm 9.15.0：

```bash
scripts/package.sh --ref "$RELEASE_COMMIT" --source-commit "$MAIN_COMMIT" --version 0.1.2 --output-dir "$EMPTY_OUTPUT"
```

从指定已提交版本提取临时源码，按 pnpm 锁文件安装依赖，下载对应 Chromium，输出版本化 tar.gz 和 release-manifest.json。包中带 node_modules 与浏览器，不需要运行机的开发缓存；Node、Python、Chromium 系统库，以及原测试执行脚本使用的 Bash/coreutils、flock、Xvfb 和 bubblewrap 由部署环境准备。构建不会 sudo、fetch、切换调用者分支、打 tag、推送、上传或部署。

package-api.json 声明四个统一参数。构建输入的 tag commit 与 main source commit 分开记录；归档名与清单身份采用 main source commit。输出目录必须为空，不覆盖已有不同字节的制品。可用 TESTER_BUILD_BROWSER_CACHE 指定构建缓存；安装器确认对应浏览器版本后完整复制入包，运行时仍不依赖该缓存。

独立的 scripts/tag.sh 在获批发布事件中调用，支持 --bump patch|minor|major、--unit-version tester=版本。它在临时 worktree 更新 package.json 与 artifact-versions.conf，仅推送 tag，不改 main。package.sh 不调用它。正式发布通过 Deployer 的 compile_packages.sh --publish；开发验收不需要推送任何真实 tag。

## 构建结果核对

验证发布链路时，以 PR 合并后的 main 提交为起点，核对构建日志与 `release-manifest.json` 中的 `source_commit`，并确认对应版本归档已生成、SHA-256 与清单一致。创建 tag 或出现“开始打包”日志不代表构建成功；是否自动触发，以发布节点的实际日志和制品为准。

## 目录与运行

从 config/*.template 创建 runtime.json、projects.json 和部署环境 .env.local，私有文件权限设为 600。runtime.json 中的值是部署环境配置，命令行显式 --config 与现有进程环境变量可覆盖。测试账号和飞书凭据只存受保护配置，不放入发布包。

模板使用：
- 稳定服务入口 /opt/deploy/tester，实际解包到独立版本目录。
- 报告 /data/test-results；私有状态 /data/tester/private；临时结果 /data/tester/runtime。
- PID /data/tester/control.pid；操作日志 /opt/logs/tester-control.log。
- 日志持续轮转：默认每份 1 MiB、保留 3 份备份；TESTER_LOG_MAX_BYTES、TESTER_LOG_BACKUPS 可调整。

```bash
scripts/starter.sh start
scripts/health-check.sh --level all --format json
scripts/test.sh --suite smoke --format json
scripts/starter.sh stop
```

start 检查监听端口及本次启动进程身份；stop 确认 PID 属于本版本的进程组后再发送信号，等待退出，必要时强制结束。restart 只有停止成功才启动。健康响应包含版本与源码 commit，避免把旧进程当作新版本成功。

artifact mode 固定执行包内版本，不拉取 Tester main 或部署产品源码。原源码模式保留。项目模板默认关闭源码部署轮询；模板中的源码路径不代表自动获得部署权限。

## 健康检查和测试

health-check.sh 支持 liveness、readiness、dependency、all，及 --timeout、--retries、--interval、--format、--quiet、--config、--base-url。仅健康检查可显式重试。

test.sh 无参数执行 unit，支持：
- unit：离线脚本测试。
- integration：使用包内 Chromium 完成本地页面断言，不访问产品。
- smoke：本服务健康/版本、状态读取和未授权排队请求拒绝。
- e2e：调用已有跨产品 Playwright 测试；必须提供明确的 TESTER_ENV_FILE，生产环境拒绝执行。
- all：依次执行上述适用套件，不能把未执行或全跳过当作成功。

统一参数：--suite、--timeout、--format text|json|junit、--output、可重复 --case、--fail-fast、--keep-data、--quiet、--help。另有 --environment、--config、--project、--base-url、--list-cases。用例 ID 不存在返回 2；失败返回 1、框架异常 3、超时 4、清理失败 5。测试失败不自动重试。--keep-data 仅供非生产本地 fixture 调试；跨产品 E2E 保持既有清理策略，拒绝该选项。

```bash
scripts/test.sh --suite smoke --list-cases
scripts/test.sh --suite smoke --case SMOKE-TESTER-002 --format json
scripts/test.sh --suite e2e --project router --environment test --timeout 600 --format junit --output /data/tester/runtime/router.xml
```

--case 的产品用例优先使用源码已有 ID，否则使用由项目、相对文件路径和标题计算的稳定 ID；执行前枚举和核对选择结果。跳过独立计数，全部跳过返回非零。JSON 标准输出仅包含报告，诊断进入 stderr。--timeout 是整次测试预算；超时和中断会停止本次子进程组并尝试清理临时数据。

需要已有网页报告、脱敏发布与飞书流程时，使用 scripts/run-tests.sh [--project router] --config 路径；它读取本版本配置后调用既有运行脚本。该操作会执行真实产品用例及配置的通知，不能当作无副作用健康检查。

## 升级与回退

scripts/upgrade.sh 提供 prepare、copy-config、post-copy、finalize 四阶段；仅复制缺失配置，不覆盖目标已配置值或外置结果。通用升级器负责停止旧服务、启动新版本、检查健康与切换稳定链接；smoke 独立执行。失败时先停止新版本，再从旧目录启动并重新执行健康和 smoke，最后恢复链接。

首次接入前需确认浏览器系统库、Xvfb/bubblewrap、受保护报告路由、数据目录权限、账号与调度配置。现有 GPU 测试环境不会因这次开发自动迁移。TypeScript 全量检查仍有与原 main 相同的既有错误；接入审计必须保留这一项，不能声称所有仓库检查已通过。

停止等待使用规范变量 STOP_TIMEOUT_SECONDS（默认 30）与 FORCE_STOP_TIMEOUT_SECONDS（默认 5）；兼容旧的 TESTER_STOP_TIMEOUT 和 TESTER_FORCE_STOP_TIMEOUT，规范变量优先。两者也可写入 runtime.json，必须为非负整数字符串。
