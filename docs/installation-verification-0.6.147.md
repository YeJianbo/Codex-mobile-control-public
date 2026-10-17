# Windows x64 Release 0.6.147 安装验证说明

发行包包含 Gateway 0.6.60、Local Console 0.12.0、Node 24.14.0、生产依赖、Android 0.6.147/code170 和安装文档。

安装器回归使用隔离 Codex HOME、数据目录和临时端口，不复制本机个人凭据，不发出模型请求。实际执行时间、检查数量和通过项目见随附 `verification/installation-verification.json` 与 `verification/installation-smoke.log`。它们由最终 EXE 的安装检查生成，覆盖离线直装、原生 PTY、后台守护、独立 HTTPS、绑定二维码、密码设置、一次性授权、防重放、实际 Chrome 证书固定与自动进入扫码页、原生管理窗口渲染、再次安装配置保留和日志可用性。

手机正文修复的有效结果见 [0.6.147 验证记录](verification-0.6.147.md)。本机已经更新正式网关和在线 APK；当前原生 Windows 管理程序的界面逻辑沿用上一版。其他实体电脑和实体手机本轮未安装。
