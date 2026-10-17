# Android 0.6.132 / Gateway 0.6.43

本轮修正子代理与更改记录的显示位置及数据来源。保留主工作树已有修改，包括 AGY 长输出完整性、快照只读、消息回执恢复、目标暂停与计时、完成通知过滤、远程启动及历史阅读位置。

## 功能与实际数据

- Android/Web 在主会话顶部独立列出直接子代理，可进入子会话、返回主会话；侧栏归组继续保留。子代理完成仍不发完成通知。
- 文件更改卡片接入实际桌面历史中的成功 `apply_patch` 操作，兼容直接调用及 `functions.exec` 包装。仅有开始记录或明确失败的编辑不计为已完成。
- 文件卡片在完成回复后显示文件及增删行数，可打开实际补丁，不必先展开处理过程。没有补丁内容的记录不补造正文；普通 shell/Python 文件写入不自动推断成补丁。
- 正式网关读取本会话的 20 轮历史，返回 282 个压缩事件，其中 57 个事件包含文件改动信息，涉及 106 个路径。原始历史只读审计另识别 223 次成功补丁事件；两者为不同层次的聚合统计。
- 正式会话目录中 65 个子代理带父会话信息，分页保留父会话，普通根会话列表不重复列出这些子代理。

## 验证

- Node 最终完整回归 243/243；最终文件汇总及完成处理定向回归 8/8。
- 完整 Node 首次 242/243，模型测试意外读取真实 CODEX_HOME。已隔离测试目录，定向 11/11 后完整重跑通过；未修改全局模型配置。
- Chrome Web 最终 52/52，含主会话子代理进入/返回、回复后文件卡片和实际补丁正文断言。
- Android release JVM 174/174，lint 0 errors / 25 warnings，assembleRelease 成功。未屏蔽 lint 问题。
- 原生交互首次 5 项中 2 项通过、3 项失败；同一模拟器发现另一套 instrumentation 正在运行，出现 Activity destroyed / No compose hierarchies。等待其退出后独占复测 5/5 通过，覆盖主会话子代理进入/返回、侧栏展开与搜索刷新、文件列表展开和补丁打开。首次失败日志保留。
- APK：`com.localcodex.control`，0.6.132/code155，minSdk26 / targetSdk31 / compileSdk35；沿用签名 SHA256 `e07866c9ac46cef89eca2b29d190bfe1185ae745cef40d4e120533b8897c4841`。
- Gateway health 与 WebSocket 实际版本 0.6.43；桌面共享已初始化，现有控制台接口正常；正式网页资产、APK 和 3 个本轮关键运行代码与源码一致。Gateway ZIP 中 76 个文件逐项与工作树一致。
- 现有公网入口及隧道健康，认证拒绝检查通过，配置哈希及设备身份未改变。正式云快照目录为空，未声称生产上验证了已导入快照正文。
- 未发送模型提示、未调用付费模型、未安装实体手机。

## 交付与恢复

部署前确认网关承载活动任务为 0、待处理 RPC 为 0。沿用现有部署目标与更新脚本，保留旧版本恢复包；桌面 Codex 未被终止。部署已成功，不需要回退。

- APK：`artifacts/Codex-Control-0.6.132.apk`，2,505,328 字节。
- APK SHA256：`728eeeae9391504ad6371e0b657ecb4c01e05c1beb80569d989e48fe4e036bff`。
- Gateway：`deliverables/Codex-Control-0.6.132-gateway-0.6.43.zip`。
- Gateway ZIP SHA256：`3ab341f7d0b750aa3b3cf0e2e2edc253136f19d556d0631ac9f305bafc9e74b9`。
- 恢复点：`artifacts/conversation-0.6.132/before-gateway-0.6.43-final.zip`，包含旧网关 0.6.42。
- 恢复点 SHA256：`4e6a440a0cec1684a2ad5d68e35a91b534576423171009aaf1752e0118ca486c`。
- 恢复脚本保留其他会话后来修改的独立控制台文件，并跳过内容相同的运行中桥接程序。
- 部署证据：`artifacts/conversation-0.6.132/deploy.log`、`live-verification.json`。
- 测试证据：`artifacts/conversation-132-node-final.log`、`conversation-132-final-targeted.log`、`conversation-132-web-final.log`、`conversation-132-android.log`、`conversation-132-native.log`、`conversation-132-native-retest.log`。
