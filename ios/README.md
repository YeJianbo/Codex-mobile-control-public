# iOS / iPadOS 网页套壳

当前工程使用 SwiftUI + WKWebView，保留网关 Web 控制台的聊天、助手切换、附件、审批、队列、工作台和历史记录。原生连接面板、菜单、下载分享和外链浏览器围绕网页提供系统交互。

- iOS 26：原生 `glassEffect` 连接栏，系统菜单及 sheet 使用 Liquid Glass。
- iOS 17–25：同一功能，连接栏使用系统 `regularMaterial`。
- iPhone / iPad：支持横竖屏、多窗口及 iPad 分屏，网页按窗口实际宽度切换布局。
- 连接：仅 HTTPS；自签名证书须输入电脑端的 SHA-256 叶证书指纹。只给当前网关主机和端口使用该指纹；其他网站在独立 Safari 面板中打开。
- 身份与草稿：使用 WKWebView 持久化数据存储，配对沿用网页流程；回到前台保留页面并触发重连，不刷新草稿。

## 在 Mac 上构建

需要 Xcode 26 或更新版本；部署目标为 iOS 17。Windows 环境不能执行 iOS SDK 编译或签名，当前没有 IPA，也未做 iPhone / iPad 真机检查。

打开 `CodexControl.xcodeproj`，选择 `CodexControl` scheme。先运行模拟器构建：

```sh
xcodebuild -project CodexControl.xcodeproj -scheme CodexControl \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

真机安装时，在 Signing & Capabilities 中选择自己的 Team；如果该 Bundle ID 不可用，修改为自己的唯一标识。连接电脑网关，输入指纹后在网页中配对。

## 最小运行检查

1. iOS 26 打开连接面板与菜单，应出现系统玻璃材质；旧版系统应显示系统模糊材质。
2. 打开电脑网关地址并配对，发送一条消息，应收到持续更新和最终回复。回到后台再返回，当前会话与草稿应保留。
3. 在 iPhone 弹出键盘、旋转屏幕；在 iPad 切换全屏和分屏，输入框应始终可见，侧栏随窗口宽度切换。
4. 从照片和文件选择器上传附件，打开文件预览，下载不能内嵌显示的文件，应弹出系统分享面板。
5. 输入错误指纹，应阻止连接；点击外部网页链接，应使用独立浏览器面板。

这份工程尚未经过 Xcode 编译，WKWebView 对自签名 WebSocket 的实际处理、附件权限和下载交互须由以上运行检查确认。正式分发还需要应用图标、签名及对应的分发配置。
