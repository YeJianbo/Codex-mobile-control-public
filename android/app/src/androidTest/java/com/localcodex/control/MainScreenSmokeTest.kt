package com.localcodex.control

import android.app.Application
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainScreenSmokeTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val project = Project(
        id = "project-1",
        name = "CodexMobileControl",
        path = "F:/Code/Codex-mobile-control",
        trusted = true,
    )

    private val hiddenProject = Project(
        id = "project-2",
        name = "Ghost",
        path = "",
        trusted = true,
    )

    @Test
    fun homePanelRendersUsableProjectAndSessionsOnly() {
        composeRule.setContent {
            MaterialTheme {
                HomePanel(
                    state = UiState(
                        connected = true,
                        projects = listOf(project, hiddenProject),
                        threads = listOf(
                            ThreadRecord(id = "thread-1", projectPath = project.path, title = "修复连接体验", status = "running"),
                            ThreadRecord(id = "thread-2", projectPath = project.path, title = "调整会话首页", status = "completed"),
                        ),
                        activeProjectId = project.id,
                    ),
                    viewModel = smokeViewModel(),
                    onOpenChat = {},
                    onOpenFiles = {},
                )
            }
        }

        composeRule.onNodeWithText("项目与会话").assertIsDisplayed()
        composeRule.onNodeWithText("CodexMobileControl").assertIsDisplayed()
        composeRule.onNodeWithText("2 个会话").assertIsDisplayed()
        composeRule.onNodeWithText("修复连接体验").assertIsDisplayed()
        composeRule.onAllNodesWithText("Ghost").assertCountEquals(0)
    }

    @Test
    fun conversationPanelRendersThreadModelAndStreamingContent() {
        composeRule.setContent {
            MaterialTheme {
                ConversationPanel(
                    state = UiState(
                        connected = true,
                        projects = listOf(project),
                        threads = listOf(
                            ThreadRecord(
                                id = "thread-1",
                                projectPath = project.path,
                                title = "终端体验优化",
                                status = "running",
                                updatedAt = "2026-06-14T12:00:00.000Z",
                            )
                        ),
                        activeProjectId = project.id,
                        activeThreadId = "thread-1",
                        chatDraft = "继续优化触屏交互",
                        settings = ControlSettings(model = "gpt-5.5"),
                        rawCodexConfig = RawCodexConfig(content = "model = \"gpt-5.5\""),
                        events = listOf(
                            ChatEvent(type = "user.message", threadId = "thread-1", text = "把终端做成直接展开"),
                            ChatEvent(type = "message.delta", threadId = "thread-1", text = "正在"),
                            ChatEvent(type = "message.delta", threadId = "thread-1", text = "处理"),
                            ChatEvent(type = "message.delta", threadId = "thread-1", text = "你的请求"),
                        ),
                    ),
                    viewModel = smokeViewModel(),
                    onOpenTab = {},
                    onOpenConnectionSettings = {},
                )
            }
        }

        composeRule.onNodeWithText("终端体验优化").assertIsDisplayed()
        composeRule.onNodeWithText("把终端做成直接展开").assertIsDisplayed()
        composeRule.onNodeWithText("正在处理你的请求").assertIsDisplayed()
        composeRule.onNodeWithText("gpt-5.5").assertIsDisplayed()
        composeRule.onNodeWithText("继续优化触屏交互").assertIsDisplayed()
    }

    @Test
    fun conversationPanelDoesNotShowTerminalActivityInline() {
        composeRule.setContent {
            MaterialTheme {
                ConversationPanel(
                    state = UiState(
                        connected = true,
                        projects = listOf(project),
                        threads = listOf(
                            ThreadRecord(
                                id = "thread-1",
                                projectPath = project.path,
                                title = "终端体验优化",
                                status = "running",
                            )
                        ),
                        activeProjectId = project.id,
                        activeThreadId = "thread-1",
                        settings = ControlSettings(model = "gpt-5.5"),
                        terminalCommands = listOf(
                            TerminalCommandRecord(
                                commandId = "session-1",
                                threadId = "terminal:session-1",
                                cwd = project.path,
                                command = "PowerShell · PTY 交互式会话",
                                status = "running",
                                output = "ready",
                                outputLength = 5,
                                outputEnd = 5,
                                interactive = true,
                            )
                        ),
                    ),
                    viewModel = smokeViewModel(),
                    onOpenTab = {},
                    onOpenConnectionSettings = {},
                )
            }
        }

        composeRule.onAllNodesWithText("终端活动").assertCountEquals(0)
        composeRule.onAllNodesWithText("继续交互").assertCountEquals(0)
    }

    @Test
    fun conversationPanelHidesMultipleTerminalSessionsInline() {
        composeRule.setContent {
            MaterialTheme {
                ConversationPanel(
                    state = UiState(
                        connected = true,
                        projects = listOf(project),
                        threads = listOf(
                            ThreadRecord(
                                id = "thread-1",
                                projectPath = project.path,
                                title = "终端体验优化",
                                status = "running",
                            )
                        ),
                        activeProjectId = project.id,
                        activeThreadId = "thread-1",
                        settings = ControlSettings(model = "gpt-5.5"),
                        terminalCommands = listOf(
                            TerminalCommandRecord(
                                commandId = "session-1",
                                threadId = "terminal:session-1",
                                cwd = project.path,
                                command = "npm dev",
                                status = "running",
                                output = "ready",
                                outputLength = 5,
                                outputEnd = 5,
                                interactive = true,
                            ),
                            TerminalCommandRecord(
                                commandId = "session-2",
                                threadId = "terminal:session-2",
                                cwd = project.path,
                                command = "python -m http.server",
                                status = "running",
                                output = "serving",
                                outputLength = 7,
                                outputEnd = 7,
                                interactive = true,
                            ),
                        ),
                    ),
                    viewModel = smokeViewModel(),
                    onOpenTab = {},
                    onOpenConnectionSettings = {},
                )
            }
        }

        composeRule.onAllNodesWithText("会话 2").assertCountEquals(0)
        composeRule.onAllNodesWithText("python -m http.server").assertCountEquals(0)
    }

    @Test
    fun settingsPanelRendersProviderControls() {
        composeRule.setContent {
            MaterialTheme {
                SettingsPanel(
                    state = UiState(
                        connected = true,
                        settings = ControlSettings(
                            modelProvider = "custom",
                            providerBaseUrl = "http://127.0.0.1:15721/v1",
                            approvalPolicy = "on-request",
                            sandboxMode = "workspace-write",
                            reasoningEffort = "high",
                            networkAccess = true,
                            disableResponseStorage = true,
                        ),
                        approvalSummary = ApprovalPolicySummary(
                            approvalLabel = "按请求审批",
                            sandboxLabel = "工作区写入 + 网络",
                            approvalRisk = "medium",
                            summary = "需要时审批",
                            recommendation = "保留审批更适合手机端控制。",
                        ),
                        rawCodexConfig = RawCodexConfig(
                            path = "C:/Users/Test/.codex/config.toml",
                            content = """
                                model_provider = "custom"
                                [model_providers.custom]
                                base_url = "http://127.0.0.1:15721/v1"
                            """.trimIndent(),
                        ),
                    ),
                    viewModel = smokeViewModel(),
                )
            }
        }

        composeRule.onNodeWithText("模型 Provider").assertIsDisplayed()
        composeRule.onNodeWithText("当前 Provider base_url").assertIsDisplayed()
        composeRule.onNodeWithText("用于切换桌面端当前模型提供方和它的 base_url；更细的鉴权、wire_api 等配置仍可在原始 TOML 里编辑。").assertIsDisplayed()
    }

    @Test
    fun terminalPanelHighlightsActiveInteractiveSession() {
        composeRule.setContent {
            MaterialTheme {
                TerminalPanel(
                    state = UiState(
                        connected = true,
                        projects = listOf(project),
                        activeProjectId = project.id,
                        terminalCommands = listOf(
                            TerminalCommandRecord(
                                commandId = "session-1",
                                threadId = "terminal:session-1",
                                cwd = project.path,
                                command = "PowerShell · 交互式会话",
                                status = "running",
                                output = "[已启动交互式 PowerShell 会话]",
                                outputLength = 18,
                                outputEnd = 18,
                                interactive = true,
                            ),
                            TerminalCommandRecord(
                                commandId = "cmd-1",
                                threadId = "terminal:cmd-1",
                                cwd = project.path,
                                command = "npm test",
                                status = "completed",
                                output = "ok",
                                outputLength = 2,
                                outputEnd = 2,
                            ),
                        ),
                    ),
                    viewModel = smokeViewModel(),
                )
            }
        }

        composeRule.onNodeWithText("当前交互会话").assertIsDisplayed()
        composeRule.onNodeWithText("发送到当前会话").assertIsDisplayed()
        composeRule.onNodeWithText("回车发送").assertIsDisplayed()
        composeRule.onNodeWithText("原样发送").assertIsDisplayed()
        composeRule.onNodeWithText("Ctrl+C").assertIsDisplayed()
        composeRule.onNodeWithText("⌫").assertIsDisplayed()
        composeRule.onNodeWithText("更多").assertIsDisplayed()
        composeRule.onNodeWithText("更多").performClick()
        composeRule.onAllNodesWithText("Home").assertCountEquals(1)
        assertTrue(composeRule.onAllNodesWithContentDescription("终端记录操作").fetchSemanticsNodes().isNotEmpty())
        composeRule.onAllNodesWithText("搜索终端输出").assertCountEquals(0)
        composeRule.onAllNodesWithContentDescription("终端记录操作")[0].performClick()
        composeRule.onNodeWithText("自动换行").assertIsDisplayed()
        composeRule.onNodeWithText("模式：回车").assertIsDisplayed()
        composeRule.onNodeWithText("全部 · 运行 1 · 2/2").assertIsDisplayed()
    }

    @Test
    fun terminalPanelCanSwitchInteractiveSessionFromQuickChips() {
        val sessionOne = TerminalCommandRecord(
            commandId = "session-1",
            threadId = "terminal:session-1",
            cwd = project.path,
            command = "npm dev",
            status = "running",
            output = "ready",
            outputLength = 5,
            outputEnd = 5,
            interactive = true,
        )
        val sessionTwo = TerminalCommandRecord(
            commandId = "session-2",
            threadId = "terminal:session-2",
            cwd = project.path,
            command = "python -m http.server",
            status = "running",
            output = "serving",
            outputLength = 7,
            outputEnd = 7,
            interactive = true,
        )

        composeRule.setContent {
            MaterialTheme {
                TerminalPanel(
                    state = UiState(
                        connected = true,
                        projects = listOf(project),
                        activeProjectId = project.id,
                        terminalCommands = listOf(sessionOne, sessionTwo),
                    ),
                    viewModel = smokeViewModel(),
                )
            }
        }

        composeRule.onNodeWithText("已选 1/2 · npm dev · F:/Code/Codex-mobile-control").assertIsDisplayed()
        composeRule.onNodeWithText(terminalSessionChipLabel(sessionTwo, 1, 2)).assertIsDisplayed()
        composeRule.onNodeWithText(terminalSessionChipLabel(sessionTwo, 1, 2)).performClick()
        composeRule.onNodeWithText("已选 2/2 · python -m http.server · F:/Code/Codex-mobile-control").assertIsDisplayed()
    }

    private fun smokeViewModel(): MainViewModel {
        val application = ApplicationProvider.getApplicationContext<Application>()
        return MainViewModel(application)
    }
}
