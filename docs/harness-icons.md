# Harness 图标来源

Hermes 使用 [Nous Research 官方仓库](https://github.com/NousResearch/hermes-agent/blob/main/assets/nous-girl-black.svg)中的 Nous Girl 标志；DeepSeek 使用 [官方仓库](https://github.com/deepseek-ai/DeepSeek-LLM/blob/main/images/logo.svg)中鲸鱼图形，去除文字。

网页 SVG 和 Android 图标保留源路径及变换，颜色由当前主题决定。Hermes 的复合路径存入 raw 资源，由 Compose 构建矢量图，避免 AAPT 的 XML 字符串长度限制。其他 Harness 继续沿用已有素材。
