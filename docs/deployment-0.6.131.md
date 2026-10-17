# Android 0.6.131 / Gateway 0.6.42

本轮在主工作树原位完成，保留 0.6.130 阅读位置恢复、AGY 输出完整性、历史分页、云快照只读边界与消息回执恢复。没有新开实现者、推送仓库或安装实体手机。

## 功能

- 子代理按父会话归组，默认折叠，可展开、搜索、进入子会话；实际 65 个子代理均带父会话元数据，不再作为普通根会话列出。子代理完成不发完成通知。
- 目标显示 Codex 数据库记录的累计运行时间；观察到同一目标从非完成变为完成时提示一次，不在重连时补发旧完成通知。
- 暂停目标先保存 paused，再中断当前轮次；待发队列保持暂停。中断失败明确提示“尚未确认停止”，可重试停止当前轮次。
- Android/Web 显示会话文件改动记录；原生默认展示 3 个文件，可展开其余文件、打开补丁。缺少补丁的记录不伪造行数。
- 连接状态区分网关在线和 Codex 连接状态，HTTP 错误显示网关实际原因。网关在线时可远程启动现有 Windows Codex 应用；重复请求合并，不杀进程或修改全局配置。引导操作保留入口，不可用时说明原因并保留消息。
- 公网只增加现有认证下的 Codex 启动操作，仍拒绝远程强制重启；未新增端口、凭据、项目访问目录或修改防火墙。

## 验证

- Node 单元/回归：242/242；新增控制及公网边界针对性复测 8/8。
- 网关 HTTP/WS/SQLite smoke：37 组通过，其中暂停目标后实际轮次为 interrupted。
- Chrome Web：52/52，含 AGY 长输出完整性、后端矩阵、云快照交互和子代理归属。
- Android release JVM：174/174；assembleRelease 成功；lint 0 errors / 25 warnings，未屏蔽问题。
- 模拟器：7 个选定用例均完成有效覆盖。首次因模拟器首帧卡住中止；冷启动后 5/7，通过修正旧测试的文件名定位后该项单独 1/1，旧分页时序项单独 1/1。初次失败日志保留，没有写成一次 7/7 通过。
- APK：com.localcodex.control，0.6.131/code154，minSdk26 / targetSdk31 / compileSdk35。沿用签名 SHA256 `e07866c9ac46cef89eca2b29d190bfe1185ae745cef40d4e120533b8897c4841`。
- 正式网关 health=0.6.42；共享桌面连接 initialized=true；WebSocket、实际网页资产及 APK 字节一致；9 个关键部署文件与源码一致。5 个已存回执读取成功。
- 正式快照接口当前为空，快照正文由隔离 Web/网关回归验证，未声称生产上有已导入快照。Windows 应用注册入口已核实；未故意关闭仍在运行的桌面 Codex，因此真实崩溃后的冷启动待实际使用复核。
- 没有付费模型调用，没有实体手机验收。

## 部署与恢复

沿用已有部署目标。部署前确认网关承载活动任务为 0、待处理 RPC 为 0；桌面 Codex 未被终止。首次公网入口启动遇到 PowerShell 引号问题，已恢复 0.6.41 并核实旧公网入口和桌面连接，再修正并重新部署成功。现有认证配置与 CLI override 保持不变。

恢复时仅替换网关及桥接程序，保留其他会话后来修改的独立控制台文件；内容相同的运行中桥接可执行文件不重复写入。

- 最终部署日志：`artifacts/subagent-0.6.131/deploy-retry.log`
- 回退成功日志：`artifacts/subagent-0.6.131/rollback-final.log`
- 运行核验：`artifacts/subagent-0.6.131/live-verification.json`
- 测试：`artifacts/goal-files-node-final.log`、`goal-files-gateway-smoke.log`、`goal-files-web-pass.log`、`goal-files-android-final.log`、`goal-files-native-retest.log`、`goal-files-native-history-retest.log`、`goal-files-native-detail-retest.log`。

APK SHA256：`4a1c5aa6d00f01bf7839c3df725689f568a63c94d1dc50851c3628aca3a6f6b6`

Gateway ZIP SHA256：`09511c4d8f42b598b670b92815f5bb558b7c0b007203010c63e9e521e688ddc1`

恢复点：`F:\Code\Codex-mobile-control\artifacts\subagent-0.6.131\before-gateway-0.6.42-final.zip`

恢复点 SHA256：`436a6207386a420e9b9cd9dc1b839d8c56e10a20eebd9fa3453326d8d0978835`
