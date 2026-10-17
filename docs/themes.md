# Android 运行时主题

在“设置 → 外观”选择主题后，当前页面、侧栏、设置卡片、账号和统计卡片、输入区、目标、队列及弹层即时更新。浅色/深色/跟随系统与主题独立，原有选择会自动沿用。侧栏底部连接电脑右侧的小图标按“自动 → 浅色 → 深色 → 自动”循环，并保存到同一显示模式设置；自动模式按系统实际深浅色显示太阳或月亮，附小字 A。

内置液态主题浅色参考用户提供的 ChatGPT 截图取样：聊天区近白 #FCFCFC，面板和输入区 #FFFFFF，文字 #0D0D0D，用户气泡淡蓝 #ECF2FE，操作强调色 #3566EF；这些是截图近似色。内置主题深色的页面、聊天区及渐变起止均为OLED纯黑，卡片/输入区使用中性深灰形成层级。自定义主题仍按文件配色显示。

内置主题为标准、液态轻量、液态玻璃。液态轻量合并原轻量玻璃和高斯模糊，沿用液态的配色、悬浮布局、圆角、气泡及边缘渐隐；材质使用较高覆盖度的半透明纯色和淡边线，不创建背景采样层，也不绘制实时模糊、折射、光泽或高光边。原 soft 选择自动迁移为 light，已有自定义主题中的 soft 基底兼容导入；显示模式仍由用户选择。

“导出当前主题”生成可编辑的 JSON；修改后通过“导入主题”应用，不需要重新安装 APK。内置主题仍保留，自定义主题可移除；导入失败不替换当前主题。主题只包含配置数据，图片和可执行代码不在这个格式中。

最小示例：

```json
{
  "version": 1,
  "id": "neutral-glass",
  "name": "中性玻璃",
  "base": "liquid",
  "colors": {
    "light": { "primary": "#246BCC", "gradientStart": "#F0F1F3" },
    "dark": { "primary": "#93B7F5", "background": "#000000", "gradientStart": "#000000" }
  },
  "geometry": { "card": 22, "panel": 30 },
  "material": { "overlayBlurDp": 22, "overlayLight": 0.64 }
}
```

`version` 为 1；`id` 为 1–48 位小写字母、数字、下划线或短横线，首位为字母或数字；`name` 为 1–48 个字。`base` 可为 `off`、`light`、`liquid`；旧文件的 `soft` 兼容映射为 `light`；省略的配置继承对应内置基底。相同 ID 再次导入会更新该自定义主题，内置主题不会被覆盖。文件大小上限 64 KB。

`colors.light` 和 `colors.dark` 支持 `primary`、`background`、`surface`、`ink`、`onPrimary`、`wash`、`bubble`、`chat`、`gradientStart`、`gradientEnd`，格式均为 `#RRGGBB`。

`geometry` 使用 dp：`control`、`button`、`field`、`menuItem` 范围 4–40，`card` 4–48，`panel` 8–60。胶囊、开关等有明确形状语义的控件保留其结构。

`material` 中 `overlayLight/overlayDark`、`insetLight/insetDark`、`panelLight/panelDark`、`dockLight/dockDark` 为覆盖不透明度，范围 0.05–1；`blurDp` 范围 0–32、`overlayBlurDp` 0–40、`edgeDp` 0.25–2、`shadowDp` 0–16。液态主题的 `edgeFadeDp` 控制聊天上下边缘渐隐，范围 0–64dp，默认28，设为0关闭；顶部从顶栏下沿向正文方向过渡，底部从输入区上沿向下过渡。`edgeFadeMinAlpha` 为边缘消息最低不透明度，范围0–1、默认0.4；值越接近1越轻，默认保持边缘消息可见，不完全消失。旧主题文件未填写时继承基底值。材质按选定渲染模式生效。状态错误色、图片内容、代码/文件内容不会随主题含义变化。

模型思考强度中的 Max 和 Ultra 使用独立标签；Ultra 的紫色标签、渐变滑轨和固定星点参考用户提供的 Codex 截图，浅色和深色分别提供清晰的文字色。强度实际请求值与等级顺序沿用原实现。

`material.sidebarFadeDp` 控制侧栏列表上下边缘的透明度渐隐，范围 0–128dp，默认64，设为0关闭。渐隐只作用于滚动内容，固定功能按钮保持清晰；列表底部预留相同滚动空间，最后一条会话可滚到渐隐区上方。顶部只在列表可向回滚动时渐隐，停在起点时首条保持清晰，不增加顶部空白。浅色和深色共用透明度遮罩，不叠加白色覆盖。

实现：`NativeTheme.kt` 定义主题和配置解析，`NativeThemeStore.kt` 管理加载、选择、原子保存及导入/导出，`NativeAppearance.kt` 渲染外观页；内置配置在 `android/app/src/main/theme-assets/themes/`。新增样式参数应接入主题定义与共用组件，不在单个页面添加新的主题名称判断。
