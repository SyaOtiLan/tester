# 测试机按项目触发测试

这是 Linux 测试机上的可选控制模块。报告仍在 `/report/`；受保护的 `/report/control/` 页面可以选择“全量测试”或一个项目，手动测试**当前已部署的环境**。手动测试不会拉取或部署产品代码。

控制服务每 5 分钟检查一次已启用项目和 Tester 的上游 `main`。产品有新提交时，先按目标 SHA 更新隔离测试实例或源码，再运行该项目；Tester 本身有新提交时，在独立 worktree 中检出该提交并运行全量测试。每日 03:00 的全量计划保持不变。所有入口共用一把运行锁，避免并发测试或部署。

目前已验证自动更新适配器的项目为 `books`、`chat`、`marketplace`、`router`、`wallet`。`orchestrator` 的新 `backend/web` 目录尚未完成隔离部署适配，和 `node`、`project`、`social`、`warehouse` 一样在配置中保持禁用；仍可在控制页手动测试当前环境，但不能把该结果解释为“最新 main 已部署”。

## 测试机配置

1. 检查 `scripts/tester-control-projects.json` 中的仓库路径、启用状态和禁用理由。自动部署只允许已验证的项目。
2. 检查 `scripts/tester-control.service` 的工作目录、Node 路径、运行用户和端口；作为 systemd 服务安装。控制程序默认只监听 `127.0.0.1:18082`。
3. 在 HTTPS 站点的 Nginx `server` 块加入 `scripts/nginx-control-location.conf` 的 `location`。先用 `htpasswd` 交互式创建 `/etc/nginx/.htpasswd-tester-control`，再运行 `nginx -t` 并重载 Nginx。不要把口令或哈希提交到仓库。
4. `TESTER_CONTROL_ORIGIN` 要与用户打开页面的 HTTPS 域名一致。路径、端口、轮询间隔、报告目录和锁文件可通过 `TESTER_*` 环境变量调整；不要把凭证写在 systemd 单元、命令行或报告中。

Nginx 的 Basic Auth、服务的本机监听、同源检查和页面 CSRF token 共同保护写操作。部署前确认整个 `/report/control/` 前缀都受 Basic Auth 保护，`/report/` 的公开只读报告不能直接代理到控制接口。

## 报告与源码

全量报告仍发布到 `/report/` 及 `/report/runs/<run>/`。单项目报告单独发布到 `/report/projects/<project>/`，摘要记录触发来源、目标提交和报告链接。失败或跳过不会写成“通过”；部署失败时不会发布该提交的测试成功报告。

`scripts/test-tester-main.sh` 默认使用 `/root/code/tester-upstream` 作为受管理的独立 worktree，保留运行控制服务的 `/root/code/tester` 工作树及其本地修改。它只接受上游 `main` 的提交，并检查目录标记、仓库归属及前置依赖；现有目录不符合条件时会拒绝覆盖。其他路径可通过 `TESTER_UPSTREAM_CHECKOUT` 指定。

## 定向验证

```bash
python3 -m unittest scripts.test_tester_control -v
python3 -m unittest discover -s scripts/tests -v
bash -n scripts/run-full-on-test-machine.sh scripts/test-tester-main.sh scripts/deploy-and-test-*.sh
bash scripts/test_deploy_source_project.sh
bash scripts/test_tester_main.sh
```

部署后还要检查控制页匿名访问返回 401、认证后能读取状态，手动选择单个项目会生成对应项目报告；确认 `/etc/cron.d/yeying-tester-full` 仍在每日 03:00 调用 `test-tester-main.sh`。产品用例自身的失败应在报告中单独处理，不作为控制服务单测通过的证明。
