# 远程会话

## durable 云端任务（0.6.142 / Gateway 0.6.52）

手机自动读取电脑当前 ChatGPT 登录账号的 durable 任务，显示“云端”来源及分页正文。列表每 30 秒更新，打开的正文读取缓存为 10 秒；无须导入快照。跨任务发来的消息显示来源名称与头像。当前入口支持查看，继续、停止与修改仍在桌面进行；旧的人工快照保留独立来源及采集时间。

云端任务 ID 在网关中使用 `cloud:` 前缀，`source=cloudCodex`、`readOnly=true`，复用 `/api/threads` 与 `/api/threads/:id/events`。云端读取错误以 `cloudError` 返回，Android 侧栏展示并保留已有列表。来源字段为 `messageSource`，头像仅通过已认证的 `GET /api/cloud/avatar/:threadId` 获取。

主仓库已合并云端只读快照和本地 Codex 持久提交回执，Android 0.6.128 / 151 配套 Gateway 0.6.40。当前版本保留每页 10 轮历史、操作分层加载、发送确认/失败恢复和现有动效。

## 云端只读快照

在会话菜单选择“导入云端快照”，粘贴经过人工筛选的 JSON。只接受用户/助手可见消息或人工摘要，拒绝未知字段、内部角色、内部指令标记和常见凭据标记。导入限制为每批 50 个快照、900 KB，总计 200 个快照，每个 200 条消息、每条 100,000 字符。同批重复 ID 和旧采集时间拒绝。

快照显示来源、固定采集时间、当时状态及超过 5 分钟的过期提示。摘要与消息导出分别标明；不能发送、停止、继续、改名或修改云端任务。附带 `deliverables/remote-task-summaries.json` 只含两个已知 ID 的筛选摘要和定位记录，保留原采集时间，未自动导入正式网关。它不代表完整历史、实时状态或已经迁移的任务。

```json
{"schemaVersion":1,"snapshots":[{"externalId":"任务ID","title":"人工摘要","updatedAt":"2026-09-30T12:00:00Z","status":"unknown","contentKind":"summary","messages":[{"role":"assistant","text":"经过筛选的用户可见摘要"}]}]}
```

## 本地 Codex

新任务使用 Sol/high，选择 Astra 时默认 medium，保留显式选择与已有设置。模型来自现有授权目录；界面会保留已有选择，后端新任务默认 ID 为 `gpt-6-sol`。目录不支持该模型时返回选择错误，不改变全局模型、权限或认证。

原生发送前同步持久保存 requestId、附件、选项和原始命令。网关以 requestId 与完整负载哈希去重，并行请求共同等待同一执行结果。模型任务运行和消息仍使用已有线程事件与历史接口。断线、进程重建及确认超时只查询原回执，不自动重发。`accepted` 是提交接受，不等于任务完成；`uncertain` 保留内容并阻止重执行；明确 writer 拒绝可稍后用相同请求重试。已创建线程上的 writer 重试沿用该线程，不再次创建任务。

Web 继续使用原有草稿与待发队列，另存原始提交命令，重连查询同一网关回执。Android 复用 `send:<requestId>` 记录和既有确认/失败恢复协议，没有引入候选的第二套 `pendingSubmission` 记录。

| 接口 | 用途 |
| --- | --- |
| `GET /api/cloud-snapshots` | 只读快照列表 |
| `POST /api/cloud-snapshots/import` | 人工摘要/消息导入 |
| `POST /api/local-tasks` | 新任务/继续本地任务 |
| `GET /api/local-tasks/:requestId` | `starting/accepted/failed/uncertain` 回执 |
| `GET /api/local-tasks` | 最近 200 个回执 |
| `GET /api/threads/:id/submission?requestId=` | 既有原生确认接口；创建前使用 `_new` |

```json
{"requestId":"调用端持久保存的唯一ID","projectPath":"F:/Code/Codex-mobile-control","text":"用户授权的任务","model":"gpt-6-sol","effort":"high"}
```

## 交付和更新

最终 APK、配套网关 ZIP、合并源码 ZIP 与校验报告在 `deliverables` / `artifacts`。网关 ZIP 含 `server/dist`、`server/public`、`server/scripts/public-routes.mjs` 和版本文件，复用已有依赖与签名。部署时应保留现有配置、认证、数据库、上传文件、快照和回执数据。更新服务可能断开 WebSocket；应由用户明确安排正式更新，本次没有部署或重启正式网关。

APK 单独不能启用新网关功能。实体手机未安装、数据未清除；没有向真实模型发送测试任务。验证采用隔离模拟网关、Chrome 及独立包名的 Android 模拟器。实际运行报告见 `deliverables/verification-summary-0.6.126.json`。

内网配对查看当前助手回复中的文件链接无需登记项目，详情见 [0.6.128 验证与交付](verification-0.6.128.md)。
