# Android 0.6.133 / Gateway 0.6.44

## 本轮界面调整

- 主会话中的子代理默认折叠，只保留一行入口；可展开、收起、进入子会话并返回。同一界面的消息刷新不会重置展开选择。侧栏已有归组折叠继续保留。
- 更改记录默认收为紧凑的一行摘要，点击后显示文件列表，不再默认铺开前三个文件。
- 点击文件直接显示该文件的红绿逐行增删，支持横向滚动。统一 diff 中的原行号、新行号按各自计数显示；只有 `@@` 的 apply_patch 记录没有位置依据，不编造行号。
- 超过 8 行的连续未修改内容保留前后各 3 行，中间折叠，可点击展开。
- 超过 262144 个字符、5000 个换行或单行超过 10000 字符的补丁不直接渲染，明确提示过大。Android 对超出布局尺寸的超宽行同样提示；保留复制补丁入口。
- 保留上一版文件更改历史接入、AGY 输出完整性、快照只读、回执恢复、目标暂停与计时、子代理完成静默、远程启动及历史阅读位置。

## 验证记录

- 补丁解析、完成处理及文件汇总的 Node 定向测试 10/10。
- 第一轮 Android lint 发现新增代码的 SuspiciousIndentation，已修正，未屏蔽规则。
- 后续构建与浏览器回归进程提前退出，未产生成功记录；原日志保留，不计为通过。改为顺序重跑，并保存明确的退出码。
- 最终 Android release JVM 176/176、lint 0 errors / 25 warnings，assembleRelease 成功；进程退出码 0。
- Chrome Web 最终完整 52/52，包含默认折叠、展开/收起、单文件差异、未修改段展开；进程退出码 0。
- 独占模拟器 6/6：主会话子代理进入/返回与折叠、侧栏归组/搜索、更改摘要默认折叠、文件列表与差异打开、未修改行展开。已查看原生和 Web 差异截图。
- APK 包名 `com.localcodex.control`，0.6.133/code156，minSdk26 / targetSdk31 / compileSdk35。原签名 SHA256 `e07866c9ac46cef89eca2b29d190bfe1185ae745cef40d4e120533b8897c4841`。
- 测试日志：`artifacts/agents-collapse-133-node.log`、`agents-collapse-133-android-verified.log`、`agents-collapse-133-web-verified.log`、`agents-collapse-133-native.log`。初次 lint 和中途退出的日志原样保留。

## 部署与交付

首次部署因 PowerShell 环境无法解析 `Get-FileHash`，更新脚本退出 1。恢复流程已还原旧网关 0.6.43 并通过健康检查。已将公网路由文件比较改为直接字节比较，避免依赖该命令；没有更改认证、端口或权限。

重试部署成功。正式 health 与 WebSocket 版本均为 0.6.44，桌面共享 initialized=true、pendingRequests=0；网页、差异脚本与 APK 下载字节匹配本次构建。公网入口及隧道健康，既有认证拒绝检查通过，配置及设备身份未改变。网关压缩包 77 个运行文件与工作树逐项一致。运行证据：`artifacts/agents-collapse-0.6.133/live-verification.json`。

- APK：`artifacts/Codex-Control-0.6.133.apk`，2,505,328 字节，SHA256 `0f08062dbeb586ef348c046a3d75249b6e4a97e5f6f785544f649d5a33adf6d2`。
- 网关：`deliverables/Codex-Control-0.6.133-gateway-0.6.44.zip`，SHA256 `9337d3f0a8e2a7f7c116be7a115a78efc5179e59c7f749c95702947674f2d05c`。
- 恢复点：`artifacts/agents-collapse-0.6.133/before-gateway-0.6.44-final.zip`，包含旧版 0.6.43，SHA256 `e536a8076f5ec6892caaba3b35aa4b51c316be73f56b9f30008f520c452a5f06`。
- 部署及首次恢复日志：`artifacts/agents-collapse-0.6.133/deploy.log`；重试日志：`deploy-retry.log`。

没有实体手机安装或付费模型调用。
