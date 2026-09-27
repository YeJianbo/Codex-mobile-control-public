# v0.6.26 冻结快照

冻结日期：2026-09-27。Android 版本号 `0.6.26`（versionCode `49`），Gateway 版本号 `0.4.0`。

此快照包含 Android 原生客户端、网页控制台、Gateway 源码、文档、构建脚本，以及同一份最终 APK 的版本化副本 `artifacts/Codex-Control-0.6.26.apk` 和网关下载副本 `server/public/downloads/android.apk`。两份 APK 的 SHA-256 均为：

```text
F0AFC3093D83900D1EDAC459A5CD640A30ACEA5D3E4F5FDA1F4191997915794D
```

冻结前验证：网页回归 48 项、Android 单测、Android 12 模拟器中的处理过程界面测试通过；本机 HTTPS 网关可读取网页资源和 APK。实体手机上的显示与安装未在此快照中验证。

源码快照不包含本机网关配置、配对凭据、证书私钥、`android/local.properties`、日志、旧备份、远程附件或历史测试产物。运行时配置需在目标电脑上单独建立。
