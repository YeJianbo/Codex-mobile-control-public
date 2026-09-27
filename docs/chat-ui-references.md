# 远程聊天界面参考

2026-09-26。本仓库负责远程聊天网页和原生 Android；电脑端账号、模型路由与服务管理沿用 Local Console。

| 项目 | 已检查内容 | 用途 |
|---|---|---|
| [RikkaHub](https://github.com/rikkahub/rikkahub) | 原生 Compose 的 ChatInput.kt、ImagePreviewDialog.kt；AGPL-3.0 | 参考键盘避让、输入区、全屏图片查看和缩放。当前自行实现缩放预览，未复制其源码或引入整套应用依赖 |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | 附件组件 attachment.tsx、MIT LICENSE | 参考附件缩略图、删除入口、焦点与按压反馈、输入区层级；可作为后续网页组件复用来源，当前未引入 React runtime |
| [LibreChat](https://github.com/LibreChat-AI/LibreChat) | GitHub 项目介绍，未下载执行 | 消息操作、搜索和附件的后续候选；未将其功能视作已集成 |
| [Open WebUI](https://github.com/open-webui/open-webui) | 官方许可证说明 | 新版有品牌保留条件，不按无条件 MIT 项目复制 |
| [Grok-Desktop](https://github.com/AnRkey/Grok-Desktop) | 外壳源码、许可证与截图 | 参考视觉层级；不是 Grok 聊天组件的源码 |

本轮落地：两端统一首页与浅灰输入区；安卓原生图片全屏查看、1–5 倍缩放、拖动与复位；独立代码复制、宽表横滚。新预览复用已鉴权下载并缩采样后的位图，不向第三方图片服务发送图片。0.5.1 已添加原文件保存到用户选择目录。

0.5.1 已完成深浅主题及跟随系统。尚未完成：语音输入、全部消息操作的一致性。远程聊天所需额度展示应通过电脑工作台的既有数据接入，不另建账号管理系统。
