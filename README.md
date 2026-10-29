# Codex Mobile Control

用 Android 或浏览器连接电脑上的 AI 助手，继续会话、查看文件和管理任务。电脑端提供 Gateway 与 Web 管理后台，手机和网页共享同一套连接、账号与模型配置。

## 下载与安装

在 [GitHub Releases](https://github.com/YeJianbo/Codex-mobile-control/releases) 下载 Android APK 和 Windows 安装包。手机也可从应用内更新，或使用电脑控制台提供的下载地址。

Windows 安装后打开 Web 控制台，在「接入 → 网关与手机」设置连接和密码，再用手机扫码绑定。已有用户可以覆盖安装 APK。详细步骤见 [安装与绑定](docs/installation.md) 和 [手机使用](docs/mobile-usage.md)。

## 功能

- **聊天与会话**：流式回复、图片与文件、消息编辑、任务队列、提问和审批；按工作区管理会话。
- **多助手**：支持 Codex、Claude Code、Antigravity、Grok Build、DeepSeek Harness、Hermes、OpenCode 和 ZCode。各助手的具体能力见 [Harness 说明](docs/harnesses.md)。
- **工作区**：浏览和编辑文件、查看改动、使用终端；在会话菜单中编辑工作区指令文件。
- **管理后台**：管理账号、模型、中转配置、连接、设备、额度、用量和定时任务。
- **渠道接入**：在管理后台配置 QQ 和微信入口，将消息连接到助手会话。
- **远程连接**：支持局域网连接和配置后的公网入口，配对设备通过网关访问电脑。

Android 提供原生界面，Web 聊天可在电脑和手机浏览器使用。iOS / iPadOS 工程与构建说明见 [iOS 目录](ios/README.md)。

## 入口

| 入口 | 默认地址或方式 |
| --- | --- |
| Web 管理后台 | `http://127.0.0.1:25819/` |
| Web 聊天 | `https://电脑地址:38457/console` |
| 网关管理页 | `https://电脑地址:38457/manage/` |
| Android | 在电脑后台生成二维码后扫码绑定 |

地址和端口可在安装时配置。管理后台默认只监听本机；远程访问通过已认证的网关转发。请勿将 Codex App Server 直接暴露到网络。

## 源码结构

```text
android/                  Android Compose 客户端
server/                   Gateway、Web 聊天和接入接口
components/local-console/ Web 管理后台及配套服务
installer/                Windows 安装与打包
ios/                      iOS / iPadOS 工程
docs/                     安装、开发和协议文档
```

开发时可从仓库根目录启动 Gateway：

```powershell
cd server
npm install
npm run dev
```

完整管理功能还需要 Local Console。构建、部署和验证步骤见 [开发说明](docs/development.md)；协议与架构见 [协议](docs/protocol.md) 和 [架构](docs/architecture.md)。
