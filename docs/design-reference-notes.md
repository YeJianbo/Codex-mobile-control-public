# 移动交互参考与本轮采用项

## 2026-10-15：0.6.331 对折叠与导航的纠正

上一版将各操作段都放成外层入口，误解了两层折叠。现在一轮结束只有一个外层过程，内部文字与独立的操作折叠段穿插，结论在外；展开外层不触发操作详情读取。文件摘要保留元数据，选中文件才读取对应补丁。引导消息刷新通过稳定请求／条目身份保持位置，同次执行的文件汇总在结束后生成一次。

设置页空状态也保持整页尺寸，禁用 AnimatedContent 的尺寸变换，采用水平方向的层级过渡；首次进入首页不能当成返回。额度刷新指示紧挨标题，套餐仍靠右。恢复工作区文件入口，移除手动只读快照导入菜单，当前会话结束不重复弹浮层。中途动画方向和高度、嵌套展开与真实详情请求均已做针对性检查，实体设备帧率未测。0.6.330 原包与源码快照保留在 D:/codex/backups/Codex-mobile-control/before-nested-process-0.6.331。

## 2026-10-15：统一设置与会话状态

依据用户选择，管理入口集中到设置页；会话用量保留聊天内的快捷访问。应用本机 Emil Design Engineering 与 Compose Animations 技能，页面切换采用 220–240ms 滑动和淡入淡出，页面身份使用实际路由，离场页面停止接管返回键和辅助功能焦点。

| Before | After | Why |
| --- | --- | --- |
| 只折叠工具，中间说明仍作为正文显示 | 完成后说明随对应操作段折叠，最终结论留在正文 | 避免过程文字挤占结果，保留原有分段顺序 |
| 侧栏分列用量、任务、控制台 | 一个“设置与管理”入口，按功能进入子页 | 统一导航与返回路径 |
| 管理页大标题和副标题上下堆叠，宽屏顶部还有额外空白 | 56dp 单行栏、18sp 标题，宽屏说明放在同一行 | 减少顶部占用并保持操作按钮对齐 |
| 管理页直接出现和消失 | 进入、返回均采用短距离滑动和透明度过渡 | 表达层级关系，避免硬切 |
| 当前会话消耗混在账号额度页 | 聊天顶部展示本会话用量，设置页展示账号额度和历史趋势 | 查询会话无需离开聊天 |
| ID、目录、模型、诊断按钮全部展开 | 默认展示上下文和消耗，低频会话资料与连接管理收起 | 提高默认视图的信息密度与阅读顺序 |
| 额度刷新时在页签下插入加载行 | 指示固定在首卡标题右侧，保留数据和曲线 | 刷新时卡片与曲线坐标不变 |
| Grok 倒序返回强度，滑条左高右低 | 显示前按实际强度 ID 排为左低右高 | 标签、选择值和拖动方向一致 |
| 空历史压缩标记提前替换实时进行中状态 | 持续显示正在压缩与文字扫光，完成后再显示折叠摘要 | 保持操作到完成的连续反馈 |

0.6.330 /302 已交付，Debug／AndroidTest／Release 与 24 项定向单元检查通过，4 项受影响界面检查通过；另有此前手机 5 项、1080dp 宽屏 2 项导航／布局检查。录像交界处重复补丁解析已去除，正则预编译；同一模拟器合成负载前后各一次采样没有证明总帧时改善，实体手机的滑动流畅度仍待确认。完整数值及原始证据见 docs/work-status.md 的 0.6.330 记录。

APK 0.6.329 及设置页改动前源码备份保留在 D:/codex/backups/Codex-mobile-control/before-settings-0.6.330；源码快照已包含本轮消息折叠修复，并非 0.6.329 的精确源码。

核对日期：2026-09-28。以下是源码阅读结果，不代表这些项目在本机或实体手机完成测试。没有复制竞品实现代码。

| 来源 | 核对的代码 | 用于当前产品 |
|---|---|---|
| [Codex Lookout](https://github.com/makorise/codex-local-hub)（MIT） | `public/app.js` 的 captureConversationScroll / restoreConversationScroll：消息 ID、可见偏移和 8px 末尾容差 | 保留现有稳定消息键与阅读锚点；Android 统一 8dp 末尾判定，箭头与恢复跟随使用同一判定 |
| [Happy](https://github.com/slopus/happy)（MIT） | `packages/happy-app/sources/components/ChatList.tsx`、`docs/chat-list-scrolling.md`：跟随阈值、键盘改变视口、历史分页锁存 | 不把刷新等同用户滚动；复用当前滚动期间延迟应用快照。其倒序 FlashList 有展开工作组定位限制，不直接移植到 Compose |
| [PocketDex](https://github.com/Mikeore/PocketDex)（MIT） | `src/message-router.js`：协议路由与请求分发 | 客户端命令与普通消息分开；/compact 对接 app-server thread/compact/start |

## 已安装的设计技能

- [Emil](https://github.com/emilkowalski/skills)，`emil-design-eng`，commit `d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128`。
- [Chris Banes Compose skills](https://github.com/chrisbanes/skills)，`compose-animations`、`compose-component-design`、`compose-performance`、`compose-state-and-effects`，commit `359126d6c13b9fe9f04cd190538813c2dfeda107`。
- 核对 [Expo skills](https://github.com/expo/skills) 后未安装框架专用技能：当前 Android 使用 Compose，网页使用原生 JS。

应用：48dp 点击区、轻微按压反馈、从触发位置展开的菜单、开关动画在布局/绘制阶段读取、无过冲弹层复位。高频聊天滚动不增加模糊或逐项入场动画。

压缩接口依据：[OpenAI App Server](https://learn.chatgpt.com/docs/app-server)。接口立即返回，实际完成依赖 contextCompaction item 结束事件，不能把 HTTP 成功当压缩完成。


## 2026-10-14 Android 外观与交互评估（0.6.328）

本轮在实现管理页、消息菜单及完成提示后，分别读取并使用 GitHub 的 [android-design-guidelines](https://github.com/ehmo/platform-design-skills/blob/main/skills/android/SKILL.md) 与 [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md)。前者用于 Android 交互、自适应及可访问性；后者用于视觉层级、表面、间距和深浅主题的单独评估。没有把 Web 清单当成 Android 测试结果。

Pro Max 的整套方案检索包含宣传页布局和与现有产品不符的青色／橙色组合，因此没有整体套用；收窄到明确的 Minimalism 风格条目，并读取其移动端视觉规则及 Jetpack Compose 布局／主题规则。当前产品仍以聊天为主，保留蓝色操作强调、中文系统字体、原有侧栏和圆角体系；不加入宣传页、逐项入场动画或渐变装饰。

| Before | After | Why |
|---|---|---|
| 定时任务、电脑控制台和用量各自组织标题及页面宽度 | 共用管理页面、标题栏、间距与系统栏避让；宽屏限宽 960dp，表单 720dp | 页面之间能保持同一视觉和操作习惯 |
| 任务页有大块新建按钮与独立编辑胶囊 | 新建收进标题栏，整张卡片可编辑，保留独立启停开关 | 减少重复控件，降低卡片高度 |
| 卡片正文和底部下一次运行占据多行 | 两行摘要及单行时间信息，白色／深色表面和细边界 | 提高扫描效率，避免灰块层层嵌套 |
| 纯黑背景与近黑卡片的层次不清 | 深色背景 #101216、卡片 #191C22；浅色背景 #F5F6F8、白色卡片 | 让消息、页面、卡片分层，减少突兀对比 |
| 蓝色 #1677E8 与白字约 4.34:1 | 蓝色 #146AD4 与白字约 5.20:1 | 在保留蓝色方向的同时改善可读性 |
| 次级文本透明度不一致，控制台部分说明只有 10sp | 管理页次级文本约 65%，说明文字至少 12sp | 常规文本在浅、深卡片上分别约 4.92:1、7.09:1 |
| 页签、开关及部分图标操作面积小于 48dp | 相关共享操作区至少 48dp，图标绘制保持原比例 | 扩大点击范围，避免误触 |
| 最新用户消息下出现复制、编辑图标 | 收进长按菜单，保留 TalkBack 的复制／编辑／消息操作 | 避免消息完成时额外插入一排控件 |
| 目标完成需要确认大弹层，普通完成缺少应用内轻提示 | 前台小浮层约 4.5 秒，支持关闭／查看；按生命周期去重，不显示历史回放 | 提供结果反馈并保持阅读位置和输入焦点 |
| 定时任务保存受全局后台操作锁影响，错误可能在被遮住的聊天页 | 独立保存状态，错误显示在任务页面，失败保留表单；保存后刷新不重新打开已关闭页面 | 用户能看到实际操作状态并重试 |
| 平板管理页和长正文横向铺满，配置变化会丢失局部状态 | 卡片按可用宽度双列；聊天内容最多 840dp；保存管理页／筛选／表单状态 | 改善平板横竖屏与分屏的阅读和连续操作 |

视觉方向及用户的自绘开关要求优先于技能中的通用 Material 3 迁移建议。本轮沿用现有 Compose／Material 依赖，通过已有主题和组件实现，没有引入整套 UI 库迁移。物理折叠铰链、实体平板、TalkBack 完整遍历和系统动态配色尚未验证；不能据此宣称完整平台合规。

改版前备份：[0.6.327 APK](/D:/codex/backups/Codex-mobile-control/before-visual-0.6.328/Codex-Control-0.6.327.apk)、[视觉改版前源码快照](/D:/codex/backups/Codex-mobile-control/before-visual-0.6.328/android-source-before-visual.zip)。源码快照包含本轮已写入、尚未交付的交互修正；旧 APK 是已部署的 0.6.327 原包。后续旧产物清理须保留本目录。


交付状态：Android 0.6.328 /300 已交付。管理页最终使用应用主窗口的页面层，避免独立 Dialog 的默认外边距；上表中的宽度及圆角规则保留。375dp、1280dp、800dp、600dp 及两倍字体的隔离界面检查通过，实际外观已读回。参考 [手机任务页](/D:/codex/build/Codex-mobile-control/review328-verified/review-328-tasks-light-375-1.0.png)、[平板任务页](/D:/codex/build/Codex-mobile-control/review328-verified/review-328-tasks-light-1280-1.0.png)、[完成浮层](/D:/codex/build/Codex-mobile-control/review328-final/native-task-completion-328.png)。
