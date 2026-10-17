# 0.6.129 控制台及 Gateway 0.6.41 部署记录

2026-10-01 按授权 `control-deploy-20261001-user-1850`，使用项目现有 `Update-InstalledGateway.ps1` 更新现有安装目标 `C:\Users\YeJianbo\.codex\tools\local-console\gateway`。先核对本轮增量和已有修复，再部署当前源码构建结果；没有重新实现或覆盖整个仓库。

部署前确认依赖网关执行的活动任务与待完成 RPC 均为 0。只重启网关，桌面 app-server、exec-server、原控制台、服务监督器和公网入口保持运行；更新后桌面共享连接恢复，`running=true`、`initialized=true`、`transport=desktop`。部署包装脚本已准备失败时恢复旧程序并重新连接；本次部署成功，没有执行回滚。

## 实际运行检查

- 健康接口返回 `ok=true`、Gateway `0.6.41`；WebSocket 实际握手返回 `connected`、`serverVersion=0.6.41`、协议版本 1。
- 控制台 HTML、JS、CSS 均 HTTP 200，内容 SHA256 与当前源码一致。安装目录及独立桌面桥接目录共 70 个运行文件与源码、交付包一致。
- APK 下载接口 HTTP 200，提供 Android `0.6.129 /152`，2,488,944 字节，SHA256 `9FE863390913F5F80A0DCC09F1423B78E72C250ACA85FDC8655E071D26800E57`。
- 两条现有提交回执及对应消息确认接口均成功读取，状态均为 `accepted`。没有提交、继续或停止测试模型任务。
- 正式库云快照数量为 0，无法在正式数据中验证快照正文。安装目录代码的隔离测试验证了同时间戳正文修正、只读来源、历史分页、完整负载去重、未知结果查询和明确拒绝重试。
- 安装目录的 AGY 完整性、快照与回执测试 20/20；使用模拟 CLI 子进程、WebSocket、SQLite 的六组测试 6/6。测试使用临时存储，不调用付费模型。AGY 检查覆盖 stdout 排空后的一致尾文补齐、不一致失败、失败或取消不补齐，以及 Web 完整长输出保留；Android 验证沿用本轮已完成的构建和回归报告。
- 现有公网入口、隧道健康；未认证和伪造代理头访问受保护接口均返回 401。CLI 后端发现正常，账号状态保持未检查，没有调用模型验证账号。
- `server.json`、`public-access.json`、`cloudflared.yml`、桌面桥接配置和已有 CLI 入口设置保持一致，设备 ID 与撤销状态保持一致。

## 恢复点与证据

旧版 Gateway 0.6.40、Android 0.6.128 下载文件和相关程序已保存到 [旧程序恢复包](../artifacts/control-deploy-20261001-user-1850/before-local-console-gateway-0.6.40.zip)，SHA256 `9E691B9761B98A4E87CDA9FD71296586F76627FEA8910C55023BFD46AB6C4BD9`。恢复包不含数据库或认证配置；恢复时保留当前数据和认证状态。[恢复脚本](../artifacts/control-deploy-20261001-user-1850/restore-program.py) 会先核对归档哈希和目标路径，仅恢复程序文件。实际恢复仍需先检查活动任务、停止网关并在完成后恢复服务，不能在运行中直接覆盖。

部署中重启窗口出现两次短暂 `ECONNREFUSED`，随后连接恢复。验证脚本首次路径假设不正确，两次只读探测退出 1（资源路由、公开健康接口的认证预期）；修正探测后实际检查退出 0。文件核对首次错误地将桌面桥接程序归入网关 scripts，按现有安装流程的独立目录核对后 70/70 一致。原始失败记录保留，没有为验证结果更改路由或认证。

已退出的部署启动命令因后台进程持有输出句柄而留有外层 shell，随后仅关闭该 shell；网关等服务进程保留，再次正式接口验证退出 0。

- [部署验证 JSON](../deliverables/deployment-verification-0.6.129.json)
- [部署日志](../artifacts/control-deploy-20261001-user-1850/deployment.log)
- [实际接口验证](../artifacts/control-deploy-20261001-user-1850/live-verification.json)
- [安装文件核对](../artifacts/control-deploy-20261001-user-1850/installed-file-audit.json)
- [20 项安装代码测试](../artifacts/control-deploy-20261001-user-1850/installed-unit-validation.log)
- [六组子进程验证](../artifacts/control-deploy-20261001-user-1850/installed-process-validation.log)
- [此前构建与客户端回归](verification-0.6.129.md)

未新增公网端口、改防火墙或认证、生成长期凭据、清数据、调用付费模型或安装实体手机。此前交付归档及其构建时未部署记录保留原字节和哈希，本记录补充后续部署状态。
