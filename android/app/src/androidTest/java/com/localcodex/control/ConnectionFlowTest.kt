package com.localcodex.control

import android.app.Application
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.assertTrue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class ConnectionFlowTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private lateinit var server: MockWebServer
    private lateinit var application: Application
    private lateinit var socketRef: AtomicReference<WebSocket?>
    private lateinit var socketOpened: CountDownLatch

    @Before
    fun setUp() {
        application = ApplicationProvider.getApplicationContext()
        clearConnectionPrefs()
        socketRef = AtomicReference(null)
        socketOpened = CountDownLatch(1)
        server = MockWebServer()
        server.dispatcher = gatewayDispatcher()
        server.start()
    }

    @After
    fun tearDown() {
        clearConnectionPrefs()
        server.shutdown()
    }

    @Test
    fun savedConnectionLoadsHomeAndThreadFlow() {
        ConnectionStore(application).save(server.url("/").toString().trimEnd('/'), "token")
        val viewModel = MainViewModel(application)

        composeRule.setContent {
            MaterialTheme {
                ControlApp(viewModel = viewModel)
            }
        }

        composeRule.waitUntil(timeoutMillis = 15_000) {
            composeRule.onAllNodesWithText("LanProject").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("项目与会话").assertIsDisplayed()
        composeRule.onNodeWithText("LanProject").assertIsDisplayed()
        composeRule.onNodeWithText("1 个会话").assertIsDisplayed()
        composeRule.onNodeWithText("修复局域网连接").assertIsDisplayed()

        composeRule.onNodeWithText("打开").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("已打开的历史会话").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("修复局域网连接").assertIsDisplayed()
        composeRule.onNodeWithText("已打开的历史会话").assertIsDisplayed()
        composeRule.onNodeWithText("这是历史回复。").assertIsDisplayed()

        composeRule.activity.onBackPressedDispatcher.onBackPressed()

        composeRule.waitUntil(timeoutMillis = 5_000) {
            composeRule.onAllNodesWithText("项目与会话").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("项目与会话").assertIsDisplayed()
    }

    @Test
    fun websocketStreamingKeepsCurrentConversationFocused() {
        ConnectionStore(application).save(server.url("/").toString().trimEnd('/'), "token")
        val viewModel = MainViewModel(application)

        composeRule.setContent {
            MaterialTheme {
                ControlApp(viewModel = viewModel)
            }
        }

        composeRule.waitUntil(timeoutMillis = 15_000) {
            composeRule.onAllNodesWithText("LanProject").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("打开").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("已打开的历史会话").fetchSemanticsNodes().isNotEmpty()
        }

        assertTrue(socketOpened.await(10, TimeUnit.SECONDS))
        socketRef.get()?.send(JSONObject().put("type", "message.delta").put("threadId", "thread-2").put("text", "后台线程消息").toString())
        socketRef.get()?.send(JSONObject().put("type", "message.delta").put("threadId", "thread-1").put("text", "实时增量已到达").toString())

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("这是历史回复。实时增量已到达").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("修复局域网连接").assertIsDisplayed()
        composeRule.onNodeWithText("这是历史回复。实时增量已到达").assertIsDisplayed()
        assertTrue(composeRule.onAllNodesWithText("后台线程消息").fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun fileChangeEventCanOpenFilesPanel() {
        ConnectionStore(application).save(server.url("/").toString().trimEnd('/'), "token")
        val viewModel = MainViewModel(application)

        composeRule.setContent {
            MaterialTheme {
                ControlApp(viewModel = viewModel)
            }
        }

        composeRule.waitUntil(timeoutMillis = 15_000) {
            composeRule.onAllNodesWithText("LanProject").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("打开").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("已打开的历史会话").fetchSemanticsNodes().isNotEmpty()
        }

        assertTrue(socketOpened.await(10, TimeUnit.SECONDS))
        socketRef.get()?.send(
            JSONObject()
                .put("type", "file.changed")
                .put("threadId", "thread-1")
                .put("summary", "1 个文件变更")
                .put("files", JSONArray().put("README.md"))
                .toString()
        )

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("文件变更").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("打开文件").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("README.md").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("项目根目录").assertIsDisplayed()
        assertTrue(composeRule.onAllNodesWithText("README.md").fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun diffUpdateEventCanOpenDiffPanel() {
        ConnectionStore(application).save(server.url("/").toString().trimEnd('/'), "token")
        val viewModel = MainViewModel(application)

        composeRule.setContent {
            MaterialTheme {
                ControlApp(viewModel = viewModel)
            }
        }

        composeRule.waitUntil(timeoutMillis = 15_000) {
            composeRule.onAllNodesWithText("LanProject").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("打开").performClick()
        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("已打开的历史会话").fetchSemanticsNodes().isNotEmpty()
        }

        assertTrue(socketOpened.await(10, TimeUnit.SECONDS))
        socketRef.get()?.send(
            JSONObject()
                .put("type", "diff.updated")
                .put("threadId", "thread-1")
                .put("diff", "diff --git a/README.md b/README.md")
                .toString()
        )

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("Diff 已更新").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("查看改动").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("Git 改动").fetchSemanticsNodes().isNotEmpty()
        }

        assertTrue(composeRule.onAllNodesWithText("Git 改动").fetchSemanticsNodes().isNotEmpty())
        assertTrue(composeRule.onAllNodesWithText("1/1 个改动文件").fetchSemanticsNodes().isNotEmpty())
        assertTrue(composeRule.onAllNodesWithText("README.md").fetchSemanticsNodes().isNotEmpty())
        assertTrue(composeRule.onAllNodesWithText("Diff").fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun terminalOutputUpdatesTerminalPanelStatus() {
        ConnectionStore(application).save(server.url("/").toString().trimEnd('/'), "token")
        val viewModel = MainViewModel(application)

        composeRule.setContent {
            MaterialTheme {
                ControlApp(viewModel = viewModel)
            }
        }

        composeRule.waitUntil(timeoutMillis = 15_000) {
            composeRule.onAllNodesWithText("LanProject").fetchSemanticsNodes().isNotEmpty()
        }

        assertTrue(socketOpened.await(10, TimeUnit.SECONDS))
        socketRef.get()?.send(
            JSONObject()
                .put("type", "terminal.output")
                .put("threadId", "terminal:cmd-1")
                .put("commandId", "cmd-1")
                .put("cwd", "F:/Code/LanProject")
                .put("command", "npm test")
                .put("status", "running")
                .put("stream", "stdout")
                .put("text", "line one")
                .toString()
        )

        composeRule.onNodeWithContentDescription("更多").performClick()
        composeRule.onNodeWithText("终端").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("npm test").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("运行中", substring = true).fetchSemanticsNodes().isNotEmpty()
        }

        assertTrue(composeRule.onAllNodesWithText("全部 · 运行 1 · 1/1").fetchSemanticsNodes().isNotEmpty())
        assertTrue(composeRule.onAllNodesWithText("npm test").fetchSemanticsNodes().isNotEmpty())
        assertTrue(composeRule.onAllNodesWithText("运行中", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(composeRule.onAllNodesWithText("line one").fetchSemanticsNodes().isNotEmpty())

        socketRef.get()?.send(
            JSONObject()
                .put("type", "terminal.output")
                .put("threadId", "terminal:cmd-1")
                .put("commandId", "cmd-1")
                .put("cwd", "F:/Code/LanProject")
                .put("command", "npm test")
                .put("status", "completed")
                .put("stream", "stdout")
                .put("text", "\n[exit 0]")
                .toString()
        )

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("已完成", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        assertTrue(composeRule.onAllNodesWithText("已完成", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    private fun clearConnectionPrefs() {
        application.getSharedPreferences("connection", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    private fun gatewayDispatcher(): Dispatcher {
        return object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.requestUrl?.encodedPath.orEmpty()
                return when {
                    path == "/health" -> jsonResponse(
                        JSONObject()
                            .put("ok", true)
                            .put("version", "0.1.0")
                            .put("protocolVersion", 1)
                            .put("minAndroidProtocolVersion", 1)
                            .put("capabilities", JSONArray().put("thread-management"))
                    )

                    path == "/api/projects" -> jsonResponse(
                        JSONObject().put(
                            "projects",
                            JSONArray().put(
                                JSONObject()
                                    .put("id", "project-1")
                                    .put("name", "LanProject")
                                    .put("path", "F:/Code/LanProject")
                                    .put("trusted", true)
                            )
                        )
                    )

                    path == "/api/config/project-roots" -> jsonResponse(
                        JSONObject().put(
                            "roots",
                            JSONArray().put(
                                JSONObject()
                                    .put("path", "F:/Code/LanProject")
                                    .put("name", "LanProject")
                                    .put("exists", true)
                            )
                        )
                    )

                    path == "/api/settings/user" -> jsonResponse(
                        JSONObject().put(
                            "settings",
                            JSONObject()
                                .put("model", "gpt-5.5")
                                .put("approvalPolicy", "on-request")
                                .put("sandboxMode", "workspace-write")
                                .put("reasoningEffort", "medium")
                                .put("networkAccess", true)
                        )
                    )

                    path == "/api/settings/approval-summary" -> jsonResponse(
                        JSONObject().put(
                            "summary",
                            JSONObject()
                                .put("approvalPolicy", "on-request")
                                .put("approvalLabel", "按需审批")
                                .put("approvalRisk", "medium")
                                .put("sandboxMode", "workspace-write")
                                .put("sandboxLabel", "工作区可写")
                                .put("networkAccess", true)
                                .put("summary", "需要时审批")
                                .put("recommendation", "当前设置适合日常开发")
                        )
                    )

                    path == "/api/settings/user/raw" -> jsonResponse(
                        JSONObject().put(
                            "config",
                            JSONObject()
                                .put("path", "/mock/.codex/config.toml")
                                .put("content", "model = \"gpt-5.5\"")
                        )
                    )

                    path == "/api/config/https" -> jsonResponse(
                        JSONObject().put(
                            "https",
                            JSONObject()
                                .put("enabled", false)
                                .put("certPath", "")
                                .put("keyPath", "")
                                .put("certExists", false)
                                .put("keyExists", false)
                                .put("restartRequired", false)
                        )
                    )

                    path == "/api/threads" -> jsonResponse(
                        JSONObject().put(
                            "threads",
                            JSONArray().put(
                                JSONObject()
                                    .put("id", "thread-1")
                                    .put("projectPath", "F:/Code/LanProject")
                                    .put("title", "修复局域网连接")
                                    .put("status", "completed")
                                    .put("updatedAt", "2026-06-14T16:30:00.000Z")
                            )
                        )
                    )

                    path == "/api/devices" -> jsonResponse(JSONObject().put("devices", JSONArray()))
                    path == "/api/codex/status" -> jsonResponse(JSONObject().put("codex", JSONObject().put("running", true).put("cliAvailable", true).put("cliVersion", "0.139.0")))
                    path == "/api/codex/compatibility" -> jsonResponse(JSONObject().put("compatibility", JSONObject().put("status", "ok")))
                    path == "/api/codex/upgrade-check" -> jsonResponse(JSONObject().put("upgrade", JSONObject().put("installedVersion", "0.139.0").put("latestVersion", "0.139.0").put("updateAvailable", false)))
                    path == "/api/terminal/commands" -> jsonResponse(JSONObject().put("commands", JSONArray()))
                    path == "/api/threads/thread-1/resume" -> jsonResponse(JSONObject().put("ok", true))
                    path == "/api/threads/thread-1/events" -> jsonResponse(
                        JSONObject().put(
                            "events",
                            JSONArray()
                                .put(JSONObject().put("type", "user.message").put("threadId", "thread-1").put("text", "已打开的历史会话"))
                                .put(JSONObject().put("type", "message.delta").put("threadId", "thread-1").put("text", "这是历史回复。"))
                        )
                    )
                    path == "/api/projects/project-1/files" -> jsonResponse(
                        JSONObject().put(
                            "files",
                            JSONArray()
                                .put(
                                    JSONObject()
                                        .put("name", "README.md")
                                        .put("path", "README.md")
                                        .put("kind", "file")
                                        .put("size", 128)
                                        .put("modifiedAt", "2026-06-14T16:35:00.000Z")
                                )
                                .put(
                                    JSONObject()
                                        .put("name", "src")
                                        .put("path", "src")
                                        .put("kind", "directory")
                                )
                        )
                    )
                    path == "/api/projects/project-1/diff" -> jsonResponse(
                        JSONObject()
                            .put("stat", " README.md | 2 +-")
                            .put("diff", "diff --git a/README.md b/README.md\n@@ -1 +1 @@\n-old\n+new")
                    )
                    path == "/api/projects/project-1/diff/files" -> jsonResponse(
                        JSONObject().put(
                            "files",
                            JSONArray().put(
                                JSONObject()
                                    .put("path", "README.md")
                                    .put("status", "modified")
                                    .put("additions", 1)
                                    .put("deletions", 1)
                            )
                        )
                    )
                    path == "/api/projects/project-1/diff/file" -> jsonResponse(
                        JSONObject()
                            .put("path", "README.md")
                            .put("diff", "diff --git a/README.md b/README.md\n@@ -1 +1 @@\n-old\n+new")
                    )
                    path == "/api/projects/project-1/diff/file/hunks" -> jsonResponse(
                        JSONObject().put("hunks", JSONArray())
                    )

                    path == "/ws" -> MockResponse()
                        .withWebSocketUpgrade(object : WebSocketListener() {
                            override fun onOpen(webSocket: WebSocket, response: Response) {
                                socketRef.set(webSocket)
                                socketOpened.countDown()
                            }
                        })

                    else -> MockResponse().setResponseCode(404).setBody("{}")
                }
            }
        }
    }

    private fun jsonResponse(body: JSONObject): MockResponse {
        return MockResponse()
            .setHeader("Content-Type", "application/json")
            .setBody(body.toString())
    }
}
