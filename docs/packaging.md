# Tester 打包接入（开发草案）

Tester 作为一个 `service` 单元交付：测试执行器、报告发布脚本和真实存在的 Python 报告控制服务共同版本化。测试产生的 HTML、JUnit、截图、历史结果和私有凭据不进入发布包；它们是运行数据。此草案不表示测试机或生产环境已经迁移。

## 构建

要求 Linux x86_64、Python 3.10+、Node.js >=24.18、pnpm 9.15.0。需要访问依赖及 Playwright 浏览器下载源。使用已提交源码：

```bash
scripts/package.sh --ref "$RELEASE_COMMIT" --source-commit "$MAIN_COMMIT" --version 0.1.1 --output-dir "$EMPTY_OUTPUT"
```

脚本从指定 commit 提取临时源码，按 pnpm 锁文件安装依赖并下载对应 Chromium；产出 `tester-v版本-源码短SHA.tar.gz` 和 `release-manifest.json`。不会 fetch、切换调用者分支、创建 tag、推送、上传、部署或清理调用者文件。包内带 node_modules 和浏览器，不依赖开发机 pnpm store 或浏览器缓存。Node/Python 和浏览器所需 Linux 系统库由部署环境预先安装，构建不执行 sudo 或修改系统。

## 部署目录和配置

首次解包到独立版本目录，从 `config/*.template` 创建本地配置。修改 runtime.json 中的目录；示例稳定入口为 `/opt/deploy/tester`。测试凭据只填入包外部署配置，权限 600；飞书配置继续通过 `TESTER_FEISHU_CONFIG` 指定，不打入包。报告默认 `/data/test-results`，私有状态默认 `/data/tester/private`，操作日志 `/opt/logs/tester-control.log`。

```bash
scripts/starter.sh start
scripts/health-check.sh --level all --format json
scripts/test.sh --suite smoke --format json
scripts/starter.sh stop
```

服务包使用 artifact mode：不从 Git main 取回另一份 Tester 代码；手动测试直接执行包内版本，原源码检出模式保留。默认项目模板关闭源码部署与 main 轮询。按发布规范升级 Tester 制品，不混淆“源码 main 有提交”与“发布了新制品”。

健康检查核对本服务和包内运行器；smoke 为本服务的版本/健康、状态查询和未授权请求拒绝，均不启动产品全量用例或发送飞书。无参数 test.sh 运行离线脚本测试。跨产品 E2E 继续使用已有 Playwright/报告入口，不能冒充本服务自身的 smoke。

## 当前边界

这是新增打包接入，尚不应加入服务器升级清单。独立 tag/version 入口已提供；所有统一健康/测试参数、日志持续轮转、包外完整浏览器 E2E、目标服务器首次部署、健康及失败回退需逐项验收；不以声明文件存在或 fixture 通过代替完整验收。Linux 系统库与 Chromium 可启动性必须在实际目标平台确认。不会自动安装 cron、改 Nginx、启用升级、迁移线上数据或重启 GPU 测试服务。
