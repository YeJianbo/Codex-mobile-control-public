# 助手安装与账号配置

Gateway 支持 Codex、Claude Code、Antigravity、Grok Build、DeepSeek Harness、Hermes、OpenCode 和 ZCode。各助手使用电脑上对应的 CLI、账号和会话；选择助手后，模型列表与新会话归属该助手。

在 Android「设置 → 助手管理」或 Web 管理后台查看运行状态、账号和公网访问设置。公网访问需要先完成设备绑定；关闭某个助手的公网访问后，仍可停止已有任务和处理待审批请求。

## 账号与模型

在 Web 管理后台的「账号」和「模型」页面，或 Android 设置中管理已接入的账号及中转配置。CLI 可执行文件和账号需要在电脑上安装或登录；Windows 控制台安装包包含 Gateway 接入代码。

模型目录由对应助手提供，可用模型、上下文、思考强度和输入类型以当前 CLI 返回的信息为准。功能差异见 [功能对照](feature-parity.md)。

## Antigravity

Antigravity 使用本机 AGY CLI。模型选择器读取 CLI 模型目录；额度面板显示当前模型对应的额度组和重置时间。

CLI 使用所选权限模式执行任务。逐项审批与图片输入等能力取决于当前 AGY CLI 提供的接口。

## DeepSeek Harness

DeepSeek 使用官方 `dsh` CLI 和 ACP 会话。电脑控制台可以配置供应商地址、模型和凭据，也可以使用 CLI 自带页面：

```powershell
dsh web --no-open
```

在终端打开输出的登录链接，进入 Models 配置供应商。DeepSeek 官方 Messages 兼容地址为 `https://api.deepseek.com/anthropic`。控制台也会读取桌面配置 `~/.dsh/profiles/desktop/cordis.patch.yml` 中的自定义模型。

安装官方包：

```powershell
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
```

可通过 `CODEX_MOBILE_CONTROL_DEEPSEEK_BIN` 指定 CLI 路径。[DeepSeek Harness 文档](https://github.com/deepseek-ai/deepseek-harness)介绍供应商和模型配置。

## Hermes

Hermes 使用 `hermes acp`。在管理后台选择供应商、模型和认证方式；也可以通过 `hermes setup model` 使用原生向导。OpenAI 订阅授权和 API Key 分别配置。

使用 Conda 安装 Hermes 和 ACP 依赖：

```powershell
git clone https://github.com/NousResearch/hermes-agent.git D:\Tools\hermes-agent
conda create -p D:\Tools\hermes-conda python=3.14 pip -y
conda activate D:\Tools\hermes-conda
python -m pip install -e 'D:\Tools\hermes-agent[acp]'
$env:HERMES_DISABLE_LAZY_INSTALLS='1'
hermes setup model
```

可以用 `CODEX_MOBILE_CONTROL_HERMES_BIN` 指向该环境的 `Scripts\hermes.exe`。更多配置见 [Hermes Agent](https://github.com/NousResearch/hermes-agent)。

## 用量和费用

Web「统计」和 Android「电脑控制台 → 统计」按来源展示可读取的 Token、速度和费用。实际金额、供应商估算、参考价格及订阅包含分别标识；未知用量或价格显示为「—」。额度查询取决于各助手提供的账号接口。

品牌图标来源见 [图标说明](harness-icons.md)。
