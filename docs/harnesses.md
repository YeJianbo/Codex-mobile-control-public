# 助手安装与账号配置

## 0.6.446 接入与公网

Gateway 0.6.148 默认允许 Codex、Claude Code、Antigravity、Grok、DeepSeek Harness、Hermes 和 OpenCode 通过已授权公网设备连接。Android 在设置的助手管理中逐项控制“公网访问”；Web 聊天的设置中也有同名选项。关闭后不再启动或恢复该助手的公网任务，已有任务仍可以停止和处理审批。设备绑定、密码与签名验证继续生效。

本轮补齐跨 Harness 置顶持久化、完成未读与前台用量刷新；ACP 原生计划和上下文计量进入共用界面，Claude 的上游重试及自动压缩进入过程状态。模型目录在初始化回复后立即结束探测，避免常驻 CLI 不退出拖慢目录刷新。

真实两轮文件读写、续聊与重复提交：Antigravity、Grok、DeepSeek ECNU max、OpenCode 默认模型通过；Claude 首轮通过，续聊停在上游 API 重试；Hermes 当前订阅授权过期，需要在账号中重新登录。58 项功能对照与未完成能力见 [功能对照](feature-parity.md)。

## AGY 常用功能与升级

Gateway 0.6.107 / Android 0.6.318 使用本机 AGY 的流式协议。2026-10-13 执行官方 `agy update`，确认 1.3.4 已为最新版本。模型从实际 `agy models` 目录发现，不预设下一代模型名称；目录更新后，新模型进入选择器。目录暂时超时、失败或返回空内容时保留已成功读取的模型；冷启动尚无有效目录时明确显示不可用。思考档位按 low、medium、high、xhigh、max 排序，只显示目录声明的档位；旧的模型后缀选择仍可恢复。

Gateway 0.6.107 将 AGY 改为每会话常驻 CLI 进程；设置相同时向同一 stdin 追加下一条 NDJSON，不重复初始化。模型、思考档位、Plan、权限、工作目录或可执行文件变化时关闭旧进程并以原生会话 ID 重建。停止或失败后回收进程；不会自动重发用户任务。只保留最近四个空闲进程，空闲五分钟回收，删除会话也回收。Node worker 的 IPC 生命周期跟随网关，在 Windows 强制结束网关时终止其独有的 AGY 子树。每轮有独立的输出和工具 ID，原生累计用量转换成当轮增量，避免常驻后的重复计数。
用量面板显示当前模型所属组的 5 小时、每周剩余额度和重置时间；Gemini 与 Claude/GPT 的余额分别读取。新对话也按所选模型取组，切换模型会重新读取，避免另一组低余额误报。Android 在前台每分钟刷新；10% 及以下沿用现有低额度提示。网关使用原生只读 `/usage` 命令，不创建模型轮次。查询并发合并、缓存一分钟，后台慢查询不阻塞手机；失败保留原值并标记过期，不触发新的低额度提示。Token 结算后通知刷新。

| 功能 | 当前接入与验证 |
|---|---|
| 文字流、工具过程、文件附件、文件变更 | 已接入；本轮真实文件读取、写入及文件内容核对通过 |
| 同会话续聊、重载后恢复模型及档位 | 已接入；本轮 low 档真实续聊和重新加载网关状态后恢复同一会话通过 |
| 防重复发送、排队、停止、失败重试 | 复用现有提交、队列和重试机制；真实重复提交未重复执行，隔离停止检查通过。0.6.107 的签名设备公网分发、工具读取、排队续聊和网关重启后第三轮恢复通过（Gemini 3.8 Flash low） |
| Plan、权限 | CLI 提供 Plan / accept-edits / 完全访问；当前流式协议不提供逐项审批和问题回传，不能按 Codex 的询问权限执行 |
| 图片消息、上下文占用 | 当前接入不支持图片消息；CLI 未报告实际上下文窗口占用，不据累计 Token 伪造上下文进度 |
| 额度与错误 | 已接入分组真实余额和重置时间；服务错误保留并允许重试，不承诺容量或服务可用性 |

0.6.106 的 medium 档真实检查两次出现 120/180 秒内未结束，另一次 low 检查返回 `The stream was interrupted. Please continue the task you were working on.`；成功的 low 文件/续聊检查不抵消这些失败。默认强度未降低，下一代模型尚未出现在本机目录，未验证其行为。Android 0.6.318 未做实体手机验证；覆盖安装后切到 AGY、打开用量，检查所选模型的两种额度及重置时间，再切换 Gemini / Claude 核对分组。

Gateway 0.6.95、Web / Android 0.6.294 增加官方 DeepSeek Harness 和 Hermes。侧栏切换助手后，模型、历史和新会话归属该助手；已有会话沿用原 CLI 会话 ID。网页和 Android 共用文字流、工具过程、审批、文件改动、停止及提交恢复协议。

Windows 安装包包含接入代码，不包含各助手的账号或 CLI 运行环境。Codex、Claude Code、Antigravity 和 Grok 沿用电脑已有安装及登录。

## 本机配置入口

从电脑管理后台进入 **设置 → 模型账户 → 打开模型账户**；也可以直接打开本机 Local Console，在左侧选择 **模型账户**。DeepSeek Harness 和 Hermes 分别显示服务地址、模型及 API Key 是否已配置；点击“填写配置”或“编辑配置”，填写后“保存配置”。新建该助手的会话后使用保存的配置。

DeepSeek 使用 Messages 兼容地址，官方地址为 `https://api.deepseek.com/anthropic`。Hermes 可选择 OpenRouter、OpenAI、DeepSeek、Anthropic，或填写 OpenAI Chat Completions 兼容的自定义服务。模型 ID 按实际供应商填写。密钥留空保留已存值；更换供应商或服务地址时需重新填写密钥。

“获取模型”从所填服务读取模型列表，无需先填写模型 ID；获取后可选择模型，也可手动输入。“测试连接”向所选模型发送一条简短请求，收到文本回复后显示耗时与回复。两个操作都不保存表单。自定义服务若不提供模型目录，可手动填入模型后测试。页面只显示密钥状态，不返回已存密钥。

Hermes 的供应商可选 **OpenAI 订阅授权**。点击“OpenAI 授权”，在 OpenAI 官方授权页面输入控制台显示的授权码并完成登录；授权完成后获取模型、选择模型并保存配置。设备码登录和凭据保存使用 Hermes 原生 OAuth 与账户池，API Key 不需要填写；官方服务地址固定。取消授权只停止本次等待，已有授权保留。此授权入口与 **OpenAI API Key** 分别管理。

配置直接写入当前 Windows 用户的 DeepSeek credentials / home patch 和 Hermes 配置文件。进程环境变量提供的密钥需在环境变量中修改。未安装的助手会显示“未找到本机助手安装”。Codex 官方账号、中转配置和其他助手的现有入口也可从本页进入。

也可以使用原生工具配置。DeepSeek 官方 Harness 已安装于 `D:\codex\tools\harnesses\deepseek`，打开其配置网页：

```powershell
& "$env:USERPROFILE\.codex\tools\harnesses\dsh.cmd" web --no-open
```

复制终端打印的完整登录链接到浏览器，进入 Models 页面，选择 DeepSeek provider，填写 API Key 并保存。登录链接包含本地访问凭证，使用终端刚打印的完整链接。它与电脑控制台使用同一份原生 credentials 存储。

Hermes 使用独立 Conda 环境 `D:\codex\tools\harnesses\hermes-conda`，也可通过原生 CLI 设置账号与模型：

```powershell
& "$env:USERPROFILE\.codex\tools\harnesses\hermes.cmd" setup model
```

在向导中选择 provider、模型并配置自己的账号。设置写入当前 Windows 用户的 Hermes 配置，网关不会读取或覆盖其他助手的账号。

本机已将 `%USERPROFILE%\.codex\tools\harnesses` 加入用户 PATH。重新打开 CMD 后，输入 `hermes` 进入交互界面，输入 `hermes status` 查看当前模型与登录状态。`HERMES_HOME` 指向 `%LOCALAPPDATA%\hermes`，与模型账户页面共用配置；命令入口在该变量未设置时补上同一目录。使用 `--profile` 仍可选择原生独立配置。

## 在另一台电脑安装

DeepSeek 安装官方 npm 包，并在官方网页配置账号：

```powershell
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
dsh web --no-open
```

Hermes 的本轮官方源码要求 Python 3.14。使用 Conda，安装 ACP 依赖；不要运行会另外创建 Python 虚拟环境的自动安装器：

```powershell
git clone https://github.com/NousResearch/hermes-agent.git D:\Tools\hermes-agent
conda create -p D:\Tools\hermes-conda python=3.14 pip -y
conda activate D:\Tools\hermes-conda
python -m pip install -e 'D:\Tools\hermes-agent[acp]'
$env:HERMES_DISABLE_LAZY_INSTALLS='1'
hermes setup model
```

以同一 Conda 环境启动网关，或将 `CODEX_MOBILE_CONTROL_HERMES_BIN` 指向该环境的 `Scripts\hermes.exe`，并在网关启动环境中设置 `HERMES_DISABLE_LAZY_INSTALLS=1`。`CODEX_MOBILE_CONTROL_DEEPSEEK_BIN` 可指定自己的 `dsh.cmd`。指定路径错误会直接报告原因。

## 能力与验证范围

- DeepSeek 使用 `dsh --profile acp`，按官方模型配置项切换模型，并通过 `session/resume` 续聊。
- Hermes 使用 `hermes acp`，按 `session/set_model` 切换模型，通过 `session/load` 恢复会话。每轮重新设置权限模式，避免沿用上一轮的完全访问权限。
- Gateway 0.6.100 将 DeepSeek 的“完全访问”同步为原生 `danger-full-access / never`；“询问”和“自动批准编辑”使用 `workspace-write / ask`，后者仅自动批准工作目录内的编辑。恢复会话后也重新应用所选权限。
- Hermes 的 OpenAI Codex 模型可按原生支持范围选择思考强度；设置作用于当前 ACP 会话，不改写全局账号配置。“默认”恢复原生配置，其他供应商尚未接入此控件。
- 推理强度和图片入口按 CLI 实际声明显示；未提供的能力不能静默替代。Grok、DeepSeek、Hermes 当前没有接入 Plan 模式。
- Antigravity CLI 没有逐项审批能力，需要自动审批或完全访问；当前 CLI 不支持图片消息。
- 公网执行继续保留现有 Codex / Antigravity 范围，其他助手使用已配对的局域网连接。

真实 CLI 联调结果、尚未完成的账号配置和上游错误记录在 [当前工作状态](work-status.md)。协议检查通过不能代替真实模型执行结果。

官方源码：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[Hermes Agent](https://github.com/NousResearch/hermes-agent)。

## 用量与费用

Local Console 的「统计 → Token → Harness」和 Android「电脑控制台 → 统计」提供 Hermes、DeepSeek 用量与费用。

- Hermes 读取原生 `state.db`，区分原生报告的实际金额、原生估算、订阅包含和未计价。OpenAI 订阅包含的调用显示「订阅已包含」。原生计量是会话累计数据，按最近计量日期归档；筛选时段不会拆分会话内部调用。
- DeepSeek 读取原生 v4 会话及连续 Zstandard 压缩帧，合并同一步的结算更新，单独计入重试。官方供应商按 [官方价格](https://api-docs.deepseek.com/quick_start/pricing/)的缓存与峰谷时段估算；2026 年假期按 [国务院通知](https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html)处理。自定义供应商、未知模型及无法确定的用量不计价。
- 参考金额不代表实际账号账单。未知金额显示「—」；价格口径、未计价和不完整记录均在费用卡片中说明。

两个助手的品牌图形取自官方仓库，详见 [图标来源](harness-icons.md)。
# DeepSeek 桌面模型配置

Gateway 0.6.101 起，DeepSeek ACP 启动时同时读取官方桌面版 `~/.dsh/profiles/desktop/cordis.patch.yml` 中的供应商配置。桌面新增的自定义模型会进入手机和网页模型目录；配置文件变更会使网关目录缓存失效，手机打开模型菜单时重新读取。桌面界面插件继续由桌面版加载。

手机和网页会话列表同时读取 `~/.dsh/sessions` 中的原生 v4 会话，按原生会话编号关联已有控制台记录，显示同一份用户消息和完整回复。原生文件更新后，网关通知手机和网页刷新对应会话；重新连接也会读取最新记录。恢复桌面会话使用原编号，不另建会话；桌面当前轮仍在运行时先等待其完成，原生写入锁继续保护会话。

## ECNU 思考强度

Gateway 0.6.105 补齐 DeepSeek ACP 非当前模型的档位目录，能力来自桌面供应商配置中的明确声明。当前 ECNU 使用 Responses 协议：ecnu-max 显示关闭、低、高、超高；ecnu-plus 显示关闭、低、中、超高。关闭映射 `reasoning.effort: none`，ecnu-plus 的超高映射 `xhigh`。默认保持关闭；在模型菜单选择其他档位即可请求相应思考强度，无需更新 Android APK。手机目录最多缓存一分钟。

自定义模型的声明位置为 `C:/Users/YeJianbo/.dsh/profiles/desktop/cordis.patch.yml` 中 llm-pi-ai → providers → ecnu → models → reasoningEfforts；保留现有供应商、协议、凭据引用和模型其他设置。配置与目录已核对，本轮没有真实模型生成验证。协议参数见 [ECNU Responses API](https://developer.ecnu.edu.cn/vitepress/llm/api/responses.html)，声明方式见 [DeepSeek Harness 供应商配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)。
