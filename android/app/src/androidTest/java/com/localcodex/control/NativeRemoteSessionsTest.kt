package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.*
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class NativeRemoteSessionsTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val server=MockWebServer()
    private val commands=CopyOnWriteArrayList<JSONObject>()
    private val reads=CopyOnWriteArrayList<String>()
    private val current=mutableStateOf<NativeViewModel?>(null)
    private lateinit var vm:NativeViewModel
    private var accepted=false
    @Volatile private var receiptAvailable=false
    @Volatile private var uncertain=false
    @Volatile private var liveCloud=false
    @Volatile private var desktopRecovered=false
    private val application get()=ApplicationProvider.getApplicationContext<Application>()
    @Before fun setup(){
        check(application.packageName.endsWith(".remotecheck")){"Run only in the isolated remotecheck application; never clear the user's app preferences"}
        application.getSharedPreferences("native",0).edit().clear().commit()
        application.getSharedPreferences("connection",0).edit().clear().commit()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            fun json(body:String)=MockResponse().setHeader("Content-Type","application/json").setBody(body)
            val path=java.net.URLDecoder.decode(request.requestUrl!!.encodedPath,"UTF-8")
            reads.add(path)
            if(path=="/api/cloud/avatar/source"){
                val bitmap=android.graphics.Bitmap.createBitmap(8,8,android.graphics.Bitmap.Config.ARGB_8888);bitmap.eraseColor(android.graphics.Color.YELLOW)
                val bytes=java.io.ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,bytes)
                return MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(bytes.toByteArray()))
            }
            if(path=="/ws")return MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                override fun onOpen(socket:WebSocket,response:Response){socket.send("""{"type":"connected","serverVersion":"test","protocolVersion":1,"capabilities":["cloud-snapshot-readonly","local-task-receipts"]}""")}
                override fun onClosing(socket:WebSocket,code:Int,reason:String){socket.close(code,reason)}
                override fun onMessage(socket:WebSocket,text:String){val body=JSONObject(text);if(body.optString("type") in listOf("thread.start","turn.start")){commands.add(body);accepted=true}}
            })
            if(path=="/health")return json("""{"ok":true,"protocolVersion":1,"minAndroidProtocolVersion":1,"capabilities":["cloud-snapshot-readonly","local-task-receipts"]}""")
            if(path=="/api/projects"||path=="/api/sidebar")return json("""{"projects":[{"id":"p","name":"隔离测试项目","path":"X:/fixture","trusted":true}],"allowedProjects":[{"id":"p","name":"隔离测试项目","path":"X:/fixture","trusted":true}]}""")
            if(liveCloud&&path=="/api/threads")return json("""{"threads":[{"id":"cloud:live","title":"体验优化 Codex 控制台","status":"idle","source":"cloudCodex","readOnly":true}]}""")
            if(desktopRecovered&&path=="/api/threads")return json("""{"threads":[{"id":"local-fixture","projectPath":"X:/fixture","title":"本地可见任务","status":"interrupted","source":"localCodex","goal":{"objective":"推进课题","status":"paused","tokensUsed":42,"timeUsedSeconds":15001}},{"id":"cloud-snapshot:sample","title":"云端任务摘要","status":"idle","source":"cloudSnapshot","readOnly":true}]}""")
            if(path=="/api/threads")return json("""{"threads":[{"id":"local-fixture","projectPath":"X:/fixture","title":"本地可见任务","status":"idle","source":"localCodex"},{"id":"cloud-snapshot:sample","title":"云端任务摘要","status":"idle","source":"cloudSnapshot","readOnly":true,"snapshotUpdatedAt":"2026-09-30T08:00:00Z","snapshotStatus":"running","snapshotStale":true}]}""")
            if(path=="/api/models")return json("""{"models":[{"model":"gpt-6.1-sol","displayName":"GPT-6.1 Sol","defaultReasoningEffort":"medium","supportedReasoningEfforts":[{"reasoningEffort":"medium"},{"reasoningEffort":"high"}]},{"model":"gpt-6-astra","displayName":"GPT-6 Astra","defaultReasoningEffort":"high","supportedReasoningEfforts":[{"reasoningEffort":"medium"},{"reasoningEffort":"high"}]}]}""")
            if(path=="/api/approvals")return json("""{"approvals":[]}""")
            if(liveCloud&&path.endsWith("/events"))return json("""{"status":"idle","hasMore":false,"events":[{"type":"user.message","threadId":"cloud:live","eventId":"delegated","text":"请完成附件交付","messageSource":{"kind":"thread","threadId":"source","name":"项目助手","avatar":"/api/cloud/avatar/source"}},{"type":"message.delta","threadId":"cloud:live","eventId":"answer","itemId":"answer","text":"云端可见回复"}]}""")
            if(desktopRecovered&&path.endsWith("/events"))return json("""{"status":"interrupted","hasMore":false,"events":[{"type":"turn.started","threadId":"local-fixture","eventId":"before-crash","turnId":"old"},{"type":"message.delta","threadId":"local-fixture","eventId":"preserved","itemId":"answer","text":"崩溃前已生成的内容"},{"type":"turn.completed","threadId":"local-fixture","eventId":"recovered","turnId":"old","status":"interrupted"}]}""")
            if(path.endsWith("/events"))return json("""{"status":"idle","hasMore":false,"events":[{"type":"user.message","threadId":"${path.substringAfter("/api/threads/").substringBefore("/events")}","eventId":"u","text":"可见请求"},{"type":"message.delta","threadId":"${path.substringAfter("/api/threads/").substringBefore("/events")}","eventId":"a","itemId":"a","text":"导入时的可见摘要"}]}""")
            if(path.endsWith("/queue"))return json("""{"messages":[],"canSteer":false}""")
            if(path.endsWith("/submission"))return json("""{"submission":{"state":"${if(!accepted)"unknown" else if(uncertain)"uncertain" else if(receiptAvailable)"accepted" else "processing"}","threadId":"local-fixture"}}""")
            if(path.startsWith("/api/local-tasks/")){if(!accepted)return MockResponse().setResponseCode(404).setBody("{\"error\":\"not found\"}");return json("""{"request":{"requestId":"${path.substringAfterLast('/')}","state":"${if(receiptAvailable)"accepted" else "starting"}","threadId":"local-fixture"}}""")}
            return json("{}")
        }}
        server.start()
        val address=server.url("/").toString().trimEnd('/')
        ui.runOnUiThread{vm=NativeViewModel(application);current.value=vm;vm.connect(address,"isolated-test")}
        ui.setContent{current.value?.let{NativeApp(it)}}
        ui.waitUntil(15000){vm.state.connected&&vm.state.threads.size==2&&vm.state.models.size>=2}
    }
    @After fun cleanup(){ui.runOnUiThread{current.value?.disconnect()};server.shutdown()}
    private fun screenshot(name:String){ui.waitForIdle();android.os.SystemClock.sleep(300);val image=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot();java.io.File(application.getExternalFilesDir(null),name).outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}
    @Test fun desktopCrashRecoveryUnlocksComposerAndRetainsDraft(){
        desktopRecovered=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first{it.id=="local-fixture"}.copy(status="running"));vm.draft("保留这条草稿")}
        ui.waitUntil(15000){!vm.state.loadingHistory&&!vm.state.running&&vm.state.events.any{it.eventId=="preserved"}}
        Assert.assertEquals("保留这条草稿",vm.state.draft)
        ui.onNodeWithTag("composer").assertIsDisplayed()
        Assert.assertFalse(vm.state.stopping)
        Assert.assertTrue(commands.isEmpty())
        ui.waitUntil(15000){vm.state.threads.firstOrNull{it.id=="local-fixture"}?.goal?.status=="paused"}
        ui.onNodeWithTag("goalHeaderStatus",useUnmergedTree=true).assertTextEquals("已暂停")
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithTag("runningThread:local-fixture").assertDoesNotExist()
        screenshot("native-desktop-crash-recovered.png")
    }
    @Test fun liveCloudShowsSourceAndDoesNotPretendToBeSnapshot(){
        liveCloud=true
        ui.runOnUiThread{vm.openThread(ThreadRecord("cloud:live",title="体验优化 Codex 控制台",source="cloudCodex",readOnly=true))}
        ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.events.any{it.eventId=="delegated"}}
        ui.onNodeWithTag("cloudThreadNotice").assertIsDisplayed()
        ui.onNodeWithTag("cloudSnapshotNotice").assertDoesNotExist()
        ui.onNodeWithText("来自 项目助手").assertIsDisplayed()
        ui.waitUntil(10000){ui.onAllNodesWithTag("messageSourceAvatar").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithTag("messageSourceAvatar").assertIsDisplayed()
        ui.onNodeWithText("请完成附件交付").assertIsDisplayed()
        ui.onNodeWithTag("composer").assertDoesNotExist()
        Assert.assertEquals("source",vm.state.events.first{it.eventId=="delegated"}.messageSource?.threadId)
        ui.runOnUiThread{vm.draft("不应发给本地");vm.send();vm.stop()}
        Assert.assertTrue(commands.isEmpty())
        screenshot("native-cloud-live-source.png")
    }
    @Test fun cloudSnapshotIsLabeledStaleAndHasNoComposerOrRemoteControls(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first{it.readOnly})}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithTag("cloudSnapshotNotice").assertIsDisplayed()
        ui.onNodeWithText("云端会话 · 只读快照").assertIsDisplayed()
        ui.onNodeWithText("可见请求").assertIsDisplayed()
        // Markdown is an Android TextView, so verify its actual view visibility with Espresso.
        androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("导入时的可见摘要"))
            .check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()))
        ui.onNodeWithTag("composer").assertDoesNotExist()
        ui.runOnUiThread{vm.draft("不允许发送");vm.send();vm.stop()}
        Assert.assertTrue(commands.isEmpty())
        screenshot("native-cloud-snapshot.png")
    }
    @Test fun duplicateTapAndViewModelRecreationRecoverOneSubmissionWithOriginalModelEffort(){
        ui.runOnUiThread{vm.newThread(vm.state.projects.first());vm.chooseModel("gpt-6.1-sol");vm.draft("只提交一次");vm.send();vm.send()}
        ui.waitUntil(10000){commands.size==1}
        Assert.assertEquals("gpt-6.1-sol",commands.first().getString("model"))
        Assert.assertEquals("high",commands.first().getString("effort"))
        val requestId=commands.first().getString("requestId")
        ui.runOnUiThread{vm.disconnect();receiptAvailable=true;vm=NativeViewModel(application);current.value=vm;vm.autoConnect()}
        try{ui.waitUntil(15000){vm.state.connected&&vm.state.threadId=="local-fixture"&&!vm.state.sending}}
        catch(e:Throwable){throw AssertionError("Recovery state: connected=${vm.state.connected}; thread=${vm.state.threadId}; project=${vm.state.projectId}; notice=${vm.state.submissionNotice}; error=${vm.state.error}; commands=${commands.size}; reads=${reads.takeLast(12)}",e)}
        Assert.assertEquals(1,commands.size)
        Assert.assertEquals(requestId,commands.first().getString("requestId"))
        ui.waitUntil(10000){!vm.state.loadingHistory&&ui.onAllNodesWithText("可见请求").fetchSemanticsNodes().isNotEmpty()}
        screenshot("native-local-task-recovered.png")
        ui.runOnUiThread{vm.newThread(vm.state.projects.first());vm.chooseModel("gpt-6-astra")}
        Assert.assertEquals("medium",vm.state.effort)
        Assert.assertEquals("",vm.state.draft)
    }
    @Test fun unknownTimeoutKeepsOriginalPayloadAndRetryOnlyQueries(){
        uncertain=true
        ui.runOnUiThread{vm.newThread(vm.state.projects.first());vm.chooseModel("gpt-6-astra");vm.effort("high");vm.draft("未知结果不要重发");vm.send()}
        ui.waitUntil(20000){commands.size==1&&!vm.state.sending&&vm.failedMessages().isNotEmpty()}
        val original=commands.single()
        val stored=application.getSharedPreferences("native",0).getString("send:${original.getString("requestId")}","")!!
        Assert.assertEquals(original.toString(),JSONObject(stored).getString("wireCommand"))
        ui.runOnUiThread{vm.send()}
        ui.waitUntil(10000){!vm.state.sending}
        Assert.assertEquals(1,commands.size)
        Assert.assertEquals("high",original.getString("effort"))
        Assert.assertEquals("未知结果不要重发",vm.state.draft)
    }
    @Test fun connectionStatusActionsAlignAndOpenPairing(){
        ui.onNodeWithTag("connectionStatus").performClick()
        ui.waitUntil(5000){ui.onAllNodesWithText("测试公网连接").fetchSemanticsNodes().isNotEmpty()}
        val test=ui.onNodeWithText("测试公网连接").fetchSemanticsNode().boundsInRoot
        val connect=ui.onNodeWithText("连接电脑").fetchSemanticsNode().boundsInRoot
        Assert.assertTrue(kotlin.math.abs(test.center.y-connect.center.y)<2f)
        Assert.assertTrue(test.right<connect.left)
        screenshot("native-connection-actions.png")
        ui.onNodeWithText("连接电脑").performClick()
        ui.waitUntil(5000){ui.onAllNodesWithText("扫描电脑二维码").fetchSemanticsNodes().isNotEmpty()}
    }
}
