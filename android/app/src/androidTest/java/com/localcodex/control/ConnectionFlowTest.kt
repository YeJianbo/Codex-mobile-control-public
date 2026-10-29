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
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
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
    private val socketCount=java.util.concurrent.atomic.AtomicInteger()
    private val healthReads=java.util.concurrent.atomic.AtomicInteger()
    private val socketDiagnoses=java.util.concurrent.CopyOnWriteArrayList<String>()
    private val outgoingCommands=java.util.concurrent.CopyOnWriteArrayList<JSONObject>()
    @Volatile private var ignoreProbes=false

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
        composeRule.runOnUiThread { model?.disconnect() }
        server.shutdown()
    }

    private var model: NativeViewModel? = null
    @Test fun foregroundReturnRecoversStaleSocketWithoutChangingThread(){
        val vm=openSavedThread()
        composeRule.runOnUiThread{vm.draft("未发送的草稿");vm.setForeground(false)}
        ignoreProbes=true
        android.os.SystemClock.sleep(600)
        composeRule.runOnUiThread{vm.setForeground(true)}
        composeRule.waitUntil(5000){socketCount.get()>=2&&vm.state.connected}
        org.junit.Assert.assertEquals("thread-1",vm.state.threadId)
        org.junit.Assert.assertEquals("未发送的草稿",vm.state.draft)
        assertTrue("A stale cached LAN health must be checked again",healthReads.get()>=2)
        composeRule.waitUntil(5000){socketDiagnoses.any{it.contains("cause=foreground_probe_timeout")&&it.contains("stream=chat")}}
    }
    @Test fun networkHandoverInvalidatesCachedLanHealth(){
        val vm=openSavedThread()
        val reads=healthReads.get()
        composeRule.runOnUiThread{vm.draft("切网保留草稿");vm.setForeground(false);vm.networkChanged()}
        composeRule.waitUntil(5000){socketCount.get()>=2&&vm.state.connected&&healthReads.get()>reads}
        org.junit.Assert.assertEquals("thread-1",vm.state.threadId)
        org.junit.Assert.assertEquals("切网保留草稿",vm.state.draft)
    }
    @Test fun healthyForegroundProbeKeepsTheExistingSocket(){
        val vm=openSavedThread()
        composeRule.runOnUiThread{vm.setForeground(false)}
        android.os.SystemClock.sleep(600)
        composeRule.runOnUiThread{vm.setForeground(true)}
        android.os.SystemClock.sleep(1000)
        composeRule.runOnIdle{assertTrue(vm.state.connected);org.junit.Assert.assertEquals(1,socketCount.get());assertTrue(socketDiagnoses.isEmpty())}
    }
    @Test fun unexpectedSocketLossChecksLanHealthAgain(){
        val vm=openSavedThread()
        val reads=healthReads.get()
        composeRule.runOnUiThread{vm.draft("断线保留草稿")}
        socketRef.get()!!.close(1011,"模拟连接中断")
        composeRule.waitUntil(5000){socketCount.get()>=2&&vm.state.connected&&healthReads.get()>reads}
        org.junit.Assert.assertEquals("thread-1",vm.state.threadId)
        org.junit.Assert.assertEquals("断线保留草稿",vm.state.draft)
        composeRule.waitUntil(5000){socketDiagnoses.any{it.contains("cause=peer_close")&&it.contains("code=1011")&&it.contains("version=${BuildConfig.VERSION_NAME}")}}
    }
    @Test fun brokenLanSocketTriesPublicWhileLanHttpIsStillHealthy(){
        val remote=MockWebServer()
        // Stall the HTTPS handshake so the selected fallback stays observable.
        repeat(4){remote.enqueue(MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.STALL_SOCKET_AT_START))}
        remote.start()
        try{
            val local=server.url("/").toString().trimEnd('/')
            val publicUrl=remote.url("/").toString().trimEnd('/').replace("http://","https://")
            ConnectionStore(application).saveProfile(local,"token",publicUrl,"password","",ConnectionRoute.AUTO)
            val vm=NativeViewModel(application);model=vm
            composeRule.setContent{NativeApp(vm)}
            composeRule.runOnUiThread{vm.autoConnect()}
            composeRule.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==local&&vm.state.threads.isNotEmpty()}
            composeRule.runOnUiThread{vm.openThread(vm.state.threads.first());vm.draft("切线保留草稿")}
            socketRef.get()!!.close(1011,"模拟内网长连接中断")
            composeRule.waitUntil(5000){vm.state.activeAddress==publicUrl}
            val opens=socketCount.get()
            android.os.SystemClock.sleep(1200)
            composeRule.runOnIdle{
                assertTrue(!vm.state.connected)
                org.junit.Assert.assertEquals(publicUrl,vm.state.activeAddress)
                org.junit.Assert.assertEquals(opens,socketCount.get())
                org.junit.Assert.assertEquals("thread-1",vm.state.threadId)
                org.junit.Assert.assertEquals("切线保留草稿",vm.state.draft)
            }
        }finally{composeRule.runOnUiThread{model?.disconnect()};remote.shutdown()}
    }
    private fun openSavedThread(): NativeViewModel {
        ConnectionStore(application).save(server.url("/").toString().trimEnd('/'), "token")
        val vm = NativeViewModel(application)
        model = vm
        composeRule.setContent { NativeApp(vm) }
        composeRule.runOnUiThread { vm.autoConnect() }
        composeRule.waitUntil(15000) { vm.state.connected && vm.state.threads.isNotEmpty() }
        composeRule.runOnUiThread { vm.openThread(vm.state.threads.first()) }
        composeRule.waitUntil(10000) { !vm.state.loadingHistory && vm.state.events.isNotEmpty() }
        return vm
    }
    @Test fun selectedThreadIdDoesNotDependOnSidebarMetadata(){
        val api=GatewayClient(server.url("/").toString().trimEnd('/'),"fixture")
        val command=api.nativeCommand("selected-thread",null,null,"消息","gpt-5.5","medium","full","request",emptyList(),emptyList())
        org.junit.Assert.assertEquals("turn.start",command.getString("type"))
        org.junit.Assert.assertEquals("selected-thread",command.getString("threadId"))
        org.junit.Assert.assertFalse(command.has("initialText"))
    }
    @Test fun notificationIntentIsConsumedOnlyOnce(){
        val intent=android.content.Intent().putExtra("notificationThreadId","old-notification-thread")
        org.junit.Assert.assertEquals("old-notification-thread",consumeNativeNotificationThread(intent))
        org.junit.Assert.assertEquals("",consumeNativeNotificationThread(intent))
    }
    @Test fun delayedNotificationCannotReplaceAnExplicitlyOpenedConversation(){
        val vm=openSavedThread()
        val delegate=server.dispatcher
        val requested=CountDownLatch(1);val release=CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){
            override fun dispatch(request:RecordedRequest):MockResponse{
                if(request.requestUrl!!.encodedPath!="/api/threads")return delegate.dispatch(request)
                requested.countDown();release.await(10,TimeUnit.SECONDS)
                val response=delegate.dispatch(request)
                val body=JSONObject(response.getBody()!!.readUtf8())
                body.getJSONArray("threads").put(JSONObject().put("id","late-notification").put("title","旧通知会话").put("status","idle"))
                return response.setBody(body.toString())
            }
        }
        try{
            composeRule.runOnUiThread{vm.openNotificationThread("late-notification")}
            assertTrue(requested.await(10,TimeUnit.SECONDS))
            composeRule.runOnUiThread{vm.openThread(ThreadRecord(id="thread-1"));vm.draft("留在当前会话")}
            release.countDown()
            composeRule.waitUntil(10000){vm.state.threads.any{it.id=="late-notification"}&&!vm.state.loadingSidebar}
            composeRule.runOnUiThread{vm.send()}
            composeRule.waitUntil(5000){outgoingCommands.any{it.optString("type")=="turn.start"}}
            val command=outgoingCommands.last{it.optString("type")=="turn.start"}
            org.junit.Assert.assertEquals("thread-1",vm.state.threadId)
            org.junit.Assert.assertEquals("thread-1",command.getString("threadId"))
            org.junit.Assert.assertEquals("留在当前会话",command.getString("text"))
        }finally{release.countDown()}
    }
    @Test fun legacyWrongTargetCannotBeReplayed(){
        val address=server.url("/").toString().trimEnd('/')
        ConnectionStore(application).save(address,"token")
        val record=JSONObject().put("id","legacy-send").put("threadId","thread-1").put("draftKey","native:thread-1")
            .put("text","保留原消息").put("address",address).put("certificateSha256","").put("model","gpt-5.5")
            .put("wireCommand",JSONObject().put("type","thread.start").put("initialText","保留原消息").toString())
        application.getSharedPreferences("native",0).edit().putString("send:legacy-send",record.toString()).commit()
        val vm=openSavedThread()
        composeRule.runOnUiThread{vm.retryFailedMessage("legacy-send")}
        composeRule.runOnIdle{
            org.junit.Assert.assertTrue(vm.state.error.contains("发送目标不一致"))
            org.junit.Assert.assertEquals("thread-1",vm.state.threadId)
            org.junit.Assert.assertEquals("保留原消息",vm.failedMessages().single().text)
            org.junit.Assert.assertFalse(outgoingCommands.any{it.optString("type") in listOf("thread.start","turn.start")})
        }
    }
    @Test fun anotherThreadReceiptCannotRedirectTheConversation(){
        val vm=openSavedThread()
        composeRule.runOnUiThread{vm.draft("原会话的消息");vm.send()}
        composeRule.waitUntil(5000){outgoingCommands.any{it.optString("type")=="turn.start"}}
        val request=outgoingCommands.last{it.optString("type")=="turn.start"}
        org.junit.Assert.assertEquals("thread-1",request.getString("threadId"))
        val id=request.getString("requestId")
        socketRef.get()!!.send(JSONObject().put("type","thread.started").put("threadId","wrong-thread").put("requestId",id).toString())
        socketRef.get()!!.send(JSONObject().put("type","command.accepted").put("threadId","wrong-thread").put("requestId",id).toString())
        composeRule.waitUntil(5000){vm.state.error.contains("会话不一致")}
        composeRule.runOnIdle{
            org.junit.Assert.assertEquals("thread-1",vm.state.threadId)
            org.junit.Assert.assertEquals("原会话的消息",vm.state.draft)
            org.junit.Assert.assertFalse(vm.state.sending)
        }
    }
    @Test fun delayedAcknowledgementKeepsTheNewlySelectedThreadAndDraft(){
        val vm=openSavedThread()
        composeRule.runOnUiThread{vm.draft("A会话的消息");vm.send()}
        composeRule.waitUntil(5000){outgoingCommands.any{it.optString("type")=="turn.start"}}
        val sent=outgoingCommands.last{it.optString("type")=="turn.start"}
        composeRule.runOnUiThread{vm.openThread(ThreadRecord(id="thread-2",title="另一个会话"));vm.draft("B会话的草稿")}
        socketRef.get()!!.send(JSONObject().put("type","command.accepted").put("threadId","thread-1").put("requestId",sent.getString("requestId")).toString())
        composeRule.runOnUiThread{vm.send()}
        composeRule.waitUntil(5000){outgoingCommands.any{it.optString("threadId")=="thread-2"}}
        val next=outgoingCommands.last{it.optString("threadId")=="thread-2"}
        org.junit.Assert.assertEquals("B会话的草稿",next.getString("text"))
        org.junit.Assert.assertEquals("thread-2",vm.state.threadId)
    }
    @Test fun savedConnectionLoadsHomeAndThreadFlow() {
        val vm = openSavedThread()
        composeRule.onNodeWithText("已打开的历史会话").assertIsDisplayed()
        assertTrue(vm.state.events.any { it.text == "这是历史回复。" })
        org.junit.Assert.assertEquals("project-1", vm.state.projectId)
    }
    @Test fun pairedDeviceCanSavePasswordWithoutPairingCode() {
        val store=ConnectionStore(application)
        store.save(server.url("/").toString().trimEnd('/'), "existing-device-token")
        store.saveRemote("https://example.com", "", "")
        val vm=NativeViewModel(application); model=vm
        var closed=false
        composeRule.setContent { MaterialTheme { NativePairingSheet(vm) { closed=true } } }
        composeRule.onAllNodes(hasSetTextAction())[2].performScrollTo().performTextInput("246810")
        composeRule.onNodeWithText("保存并连接").performScrollTo().performClick()
        composeRule.waitUntil(10000) { vm.state.connected }
        assertTrue(closed)
        org.junit.Assert.assertEquals("246810", ConnectionStore(application).remotePassword())
        org.junit.Assert.assertEquals("existing-device-token", ConnectionStore(application).token())
        org.junit.Assert.assertEquals("246810", NativeViewModel(application).state.remotePassword)
        val requests=mutableListOf<RecordedRequest>()
        while(true) { requests.add(server.takeRequest(100,TimeUnit.MILLISECONDS)?:break) }
        assertTrue(requests.none { it.path.orEmpty().contains("pair") })
    }
    @Test fun unpairedDeviceStillRequiresPairingCode() {
        ConnectionStore(application).save(server.url("/").toString().trimEnd('/'), "")
        val vm=NativeViewModel(application); model=vm
        composeRule.setContent { MaterialTheme { NativePairingSheet(vm) {} } }
        composeRule.onNodeWithText("连接").performScrollTo().assertIsNotEnabled()
    }
    @Test fun websocketStreamingKeepsCurrentConversationFocused() {
        val vm = openSavedThread()
        assertTrue(socketOpened.await(10, TimeUnit.SECONDS))
        socketRef.get()!!.send(JSONObject().put("type","message.delta").put("threadId","thread-2").put("text","后台线程消息").toString())
        socketRef.get()!!.send(JSONObject().put("type","message.delta").put("threadId","thread-1").put("text","实时增量已到达").toString())
        composeRule.waitUntil(10000) { vm.state.events.any { it.text.contains("实时增量已到达") } }
        org.junit.Assert.assertEquals("thread-1", vm.state.threadId)
        assertTrue(vm.state.events.none { it.text.contains("后台线程消息") })
    }
    @Test fun fileChangeEventCanOpenFilesPanel() {
        val vm = openSavedThread()
        socketRef.get()!!.send(JSONObject().put("type","file.changed").put("threadId","thread-1").put("summary","1 个文件变更").put("files",JSONArray().put("README.md")).toString())
        composeRule.waitUntil(10000) { vm.state.events.any { it.type == "file.changed" } }
        composeRule.runOnUiThread { vm.files() }
        composeRule.waitUntil(10000) { vm.state.files.any { it.name == "README.md" } }
    }
    @Test fun diffUpdateEventCanOpenDiffPanel() {
        val vm = openSavedThread()
        socketRef.get()!!.send(JSONObject().put("type","diff.updated").put("threadId","thread-1").put("diff","-old\n+new").toString())
        composeRule.waitUntil(10000) { vm.state.events.any { it.type == "diff.updated" } }
        composeRule.runOnUiThread { vm.diff() }
        composeRule.waitUntil(10000) { vm.state.diff.contains("+new") }
    }
    @Test fun notificationOpensThreadAfterColdConnection() {
        ConnectionStore(application).save(server.url("/").toString().trimEnd('/'), "token")
        val vm = NativeViewModel(application); model = vm
        composeRule.setContent { NativeApp(vm) }
        composeRule.runOnUiThread { vm.openNotificationThread("thread-1"); vm.autoConnect() }
        composeRule.waitUntil(15000) { vm.state.threadId == "thread-1" && !vm.state.loadingHistory }
        composeRule.onNodeWithText("已打开的历史会话").assertIsDisplayed()
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
                    path == "/api/models" -> jsonResponse(JSONObject("""{"models":[{"model":"gpt-test","displayName":"Test","supportedReasoningEfforts":[]}]}"""))
                    path == "/api/sidebar" -> jsonResponse(
                        JSONObject()
                            .put(
                                "projects",
                                JSONArray().put(
                                    JSONObject()
                                        .put("id", "project-1")
                                        .put("name", "LanProject")
                                        .put("path", "F:/Code/LanProject")
                                        .put("trusted", true)
                                )
                            )
                            .put(
                                "allowedProjects",
                                JSONArray().put(
                                    JSONObject()
                                        .put("id", "project-1")
                                        .put("name", "LanProject")
                                        .put("path", "F:/Code/LanProject")
                                        .put("trusted", true)
                                )
                            )
                            .put("hasMore", false)
                    )
                    path == "/api/diagnostics/performance" -> {
                        socketDiagnoses.add(request.path.orEmpty())
                        jsonResponse(JSONObject().put("ok",true))
                    }
                    path == "/api/approvals" -> jsonResponse(JSONObject().put("approvals",JSONArray()))
                    path.endsWith("/queue") -> jsonResponse(JSONObject().put("messages",JSONArray()))
                    path == "/health" -> jsonResponse(
                        JSONObject()
                            .put("ok", true)
                            .put("version", "0.1.0")
                            .put("protocolVersion", 1)
                            .put("minAndroidProtocolVersion", 1)
                            .put("capabilities", JSONArray().put("thread-management").put("foreground-websocket-probe"))
                            .also{healthReads.incrementAndGet()}
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
                            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                                webSocket.close(code, reason)
                            }
                            override fun onOpen(webSocket: WebSocket, response: Response) {
                                socketCount.incrementAndGet()
                                socketRef.set(webSocket)
                                socketOpened.countDown()
                            }
                            override fun onMessage(webSocket:WebSocket,text:String){
                                val message=JSONObject(text)
                                outgoingCommands.add(message)
                                if(message.optString("type")=="connection.ping"&&!ignoreProbes)
                                    webSocket.send(JSONObject().put("type","connection.pong").put("requestId",message.optString("requestId")).toString())
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
