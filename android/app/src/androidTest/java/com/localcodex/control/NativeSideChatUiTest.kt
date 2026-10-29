package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.mockwebserver.Dispatcher
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

class NativeSideChatUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val forks=AtomicInteger()
    private val ended=AtomicInteger()
    private val sockets=CopyOnWriteArrayList<WebSocket>()
    private val history=CopyOnWriteArrayList<JSONObject>()
    private lateinit var server:MockWebServer
    private val owner=AtomicReference<NativeSideChatController>()
    private val sessions=AtomicReference<NativeSideChats>()
    private val commands=CopyOnWriteArrayList<JSONObject>()
    private lateinit var gateway:GatewayClient
    @Volatile private var acceptSend=true
    @Volatile private var historyDelayMillis=0L
    @Volatile private var snapshotStatus="idle"
    @Volatile private var idleStopReply=false
    private val dark=mutableStateOf(false)
    @Before fun setup(){
        server=MockWebServer()
        server.dispatcher=object:Dispatcher(){
            override fun dispatch(request:RecordedRequest):MockResponse{
                val path=request.requestUrl!!.encodedPath
                if(path=="/ws")return MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                    override fun onOpen(socket:WebSocket,response:Response){sockets.add(socket);socket.send("""{"type":"connected"}""")}
                    override fun onMessage(socket:WebSocket,text:String){
                        val command=JSONObject(text)
                        commands.add(command)
                        val thread=command.optString("threadId","side")
                        if(command.optString("type")=="turn.interrupt"&&idleStopReply){
                            socket.send(JSONObject().put("type","error").put("threadId",thread).put("requestId",command.getString("requestId"))
                                .put("message","当前会话没有正在运行的任务").toString())
                        }
                        if(command.optString("type")=="turn.start"&&acceptSend){
                            socket.send(JSONObject().put("type","command.accepted").put("threadId",thread).put("requestId",command.getString("requestId")).toString())
                            for(event in listOf(
                                JSONObject().put("type","user.message").put("text",command.getString("text")).put("images",command.optJSONArray("images")).put("files",command.optJSONArray("files")).put("requestId",command.getString("requestId")),
                                JSONObject().put("type","turn.started"),
                                JSONObject().put("type","message.delta").put("itemId","answer").put("text","旁支回复"),
                                JSONObject().put("type","turn.completed").put("status","completed")
                            )){event.put("threadId",thread).put("turnId","turn").put("eventId","event-${history.size}");history.add(event);socket.send(event.toString())}
                        }
                    }
                })
                val body=when{
                    path.endsWith("/fork")->{forks.incrementAndGet();JSONObject().put("thread",JSONObject().put("id",if(path.contains("/other/"))"side-other" else "side"))}
                    path.endsWith("/side/close")->{ended.incrementAndGet();JSONObject().put("ok",true)}
                    path.endsWith("/events")->JSONObject().put("events",JSONArray(history.filter{it.optString("threadId")==path.substringAfter("/threads/").substringBefore('/')})).put("status",snapshotStatus)
                    path=="/api/uploads/files"->JSONObject().put("id","file-fixture").put("name","notes.txt").put("mime","text/plain").put("size",12)
                    path=="/api/uploads/images"->JSONObject().put("id","image-fixture").put("name","photo.png")
                    path.endsWith("/submission")->JSONObject().put("submission",JSONObject().put("state","uncertain"))
                    else->JSONObject()
                }
                return MockResponse().addHeader("Content-Type","application/json").setBody(body.toString()).also{
                    if(path.endsWith("/events"))it.setBodyDelay(historyDelayMillis,java.util.concurrent.TimeUnit.MILLISECONDS)
                }
            }
        }
        server.start()
        gateway=GatewayClient(server.url("/").toString().trimEnd('/'),"fixture")
        ui.setContent{
            val scope=rememberCoroutineScope()
            val manager=remember{NativeSideChats(scope){gateway}.also{sessions.set(it)}}
            val controller=manager.current
            val theme=NativeBuiltinThemes.liquid.resolve(dark.value)
            NativeThemeProvider(theme,theme.palette.material(dark.value)){
                CompositionLocalProvider(LocalNativeGlassMode provides NativeGlassMode.LIQUID,
                    androidx.compose.material.LocalContentColor provides theme.palette.material(dark.value).onSurface){
                    Box(Modifier.fillMaxSize()){
                        Text("主会话原草稿")
                        if(controller!=null&&controller.state.visible)key(controller){Sheet("侧聊",controller::minimize,stableHeight=true,bodyScrollState=null,contentHorizontalPadding=16.dp,
                            titleContent={NativeSideChatTitle(controller)},
                            bodyPadding=PaddingValues(0.dp)){NativeSideChatContent(controller,Modifier.weight(1f),models=listOf(
                                NativeModel("gpt-6-sol","Sol",listOf("low","high"),"high"),
                                NativeModel("gpt-6.1-sol","6.1 Sol",listOf("low","high"),"high")))}}
                    }
                }
            }
        }
        ui.runOnIdle{sessions.get().open("parent","gpt-6-sol","high");owner.set(sessions.get().current)}
        ui.waitUntil(10000){owner.get().state.connected}
        ui.onNodeWithTag("sideChatInput").assertIsDisplayed()
    }
    @After fun cleanup(){ui.runOnIdle{sessions.get()?.clear()};sockets.forEach{it.close(1000,"fixture finished")};if(::server.isInitialized)server.shutdown()}
    private fun capture(name:String){
        ui.waitForIdle()
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.rootInActiveWindow?.findAccessibilityNodeInfosByText("Wait")?.firstOrNull()
            ?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)
        android.os.SystemClock.sleep(300)
        val bitmap=instrumentation.uiAutomation.takeScreenshot()?:error("Screenshot unavailable")
        try{File(instrumentation.targetContext.getExternalFilesDir(null),"side467-$name.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}finally{bitmap.recycle()}
    }
    private fun endSide(){ui.onNodeWithContentDescription("侧聊操作").performClick();ui.onNodeWithText("结束侧聊").performClick()}

    @Test fun stoppingAnAlreadyIdleTaskDoesNotLeaveErrorsOrAStopButton(){
        ui.waitUntil(5000){!owner.get().state.loadingHistory}
        idleStopReply=true
        sockets.last().send("""{"type":"turn.started","threadId":"side","turnId":"stale","eventId":"stale-start"}""")
        ui.waitUntil(5000){owner.get().state.running}
        ui.runOnIdle{repeat(4){owner.get().stop()}}
        ui.waitUntil(5000){commands.any{it.optString("type")=="turn.interrupt"}&&!owner.get().state.running}
        assertEquals(1,commands.count{it.optString("type")=="turn.interrupt"})
        ui.runOnIdle{
            assertFalse(owner.get().state.stopping)
            assertEquals("",owner.get().state.error)
            assertEquals(0,owner.get().state.events.count{it.type=="error"})
        }
        ui.onAllNodesWithText("当前会话没有正在运行的任务").assertCountEquals(0)
        ui.onNodeWithContentDescription("发送侧聊").assertExists()
    }

    @Test fun recoveredIdleStatusWinsOverOldStartsAndRemovesOldStopErrors(){
        ui.waitUntil(5000){!owner.get().state.loadingHistory}
        history.add(JSONObject().put("type","turn.started").put("threadId","side").put("turnId","stale").put("eventId","stale-start"))
        repeat(4){history.add(JSONObject().put("type","error").put("threadId","side").put("requestId","old-stop-$it")
            .put("message","当前会话没有正在运行的任务").put("eventId","old-error-$it"))}
        ui.runOnIdle{owner.get().retry()}
        ui.waitUntil(5000){owner.get().state.events.any{it.eventId=="stale-start"}&&!owner.get().state.loadingHistory}
        ui.runOnIdle{
            assertFalse(owner.get().state.running)
            assertEquals(0,owner.get().state.events.count{it.type=="error"})
        }
        ui.onAllNodesWithText("当前会话没有正在运行的任务").assertCountEquals(0)
        ui.onNodeWithContentDescription("发送侧聊").assertExists()
    }

    @Test fun staleSnapshotsDoNotOverrideNewLiveTurnsAndSubmissionErrorsKeepTheDraft(){
        ui.waitUntil(5000){!owner.get().state.loadingHistory}
        historyDelayMillis=1500
        ui.runOnIdle{owner.get().retry()}
        ui.waitUntil(5000){owner.get().state.loadingHistory}
        sockets.last().send("""{"type":"turn.started","threadId":"side","turnId":"new","eventId":"new-start"}""")
        ui.waitUntil(5000){owner.get().state.running&&!owner.get().state.loadingHistory}
        assertTrue(owner.get().state.running)
        sockets.last().send("""{"type":"turn.completed","threadId":"side","turnId":"new","eventId":"new-end","status":"completed"}""")
        ui.waitUntil(5000){!owner.get().state.running}
        acceptSend=false
        ui.runOnIdle{owner.get().draft("保留问题");owner.get().send()}
        ui.waitUntil(5000){commands.any{it.optString("type")=="turn.start"}}
        val command=commands.last{it.optString("type")=="turn.start"}
        sockets.last().send(JSONObject().put("type","error").put("threadId","side").put("requestId",command.getString("requestId")).put("message","模型暂不可用").toString())
        ui.waitUntil(5000){!owner.get().state.pending}
        assertEquals("保留问题",owner.get().state.draft)
        assertEquals(0,owner.get().state.events.count{it.type=="error"})
        ui.onAllNodesWithText("模型暂不可用").assertCountEquals(1)
    }

    @Test fun sideSheetSendsReopensAndReconnectsWithoutForkingAgain(){
        capture("light-empty")
        ui.onNodeWithTag("sideChatInput").performTextInput("旁支问题")
        ui.onNodeWithContentDescription("发送侧聊").performClick()
        ui.waitUntil(10000){owner.get().state.events.any{it.type=="turn.completed"}}
        ui.runOnIdle{assertEquals("",owner.get().state.draft);assertEquals(1,owner.get().state.events.count{it.text=="旁支回复"});owner.get().minimize()}
        ui.onNodeWithText("主会话原草稿").assertIsDisplayed()
        ui.runOnIdle{owner.get().open("parent")}
        ui.waitUntil(10000){owner.get().state.connected&&sockets.size>=2}
        sockets.last().close(1011,"fixture reconnect")
        ui.waitUntil(10000){owner.get().state.connected&&sockets.size>=3}
        ui.runOnIdle{assertEquals(1,forks.get());assertEquals(1,owner.get().state.events.count{it.text=="旁支回复"})}
        endSide()
        ui.waitUntil(5000){!owner.get().state.visible}
        assertEquals(1,ended.get())
        ui.onNodeWithText("主会话原草稿").assertIsDisplayed()
    }
    @Test fun unconfirmedSubmissionRetainsCopyableTextAndDoesNotBlockEnding(){
        acceptSend=false
        ui.onNodeWithTag("sideChatInput").performTextInput("保留未确认文字")
        ui.onNodeWithContentDescription("发送侧聊").performClick()
        ui.waitUntil(5000){owner.get().state.pending}
        ui.onNodeWithText("核对提交状态").performClick()
        ui.waitUntil(5000){owner.get().state.error.contains("尚未确认")}
        ui.runOnIdle{assertEquals("保留未确认文字",owner.get().state.draft);assertFalse(owner.get().state.busy)}
        ui.onNodeWithContentDescription("发送侧聊").assertIsNotEnabled()
        ui.runOnIdle{dark.value=true}
        capture("dark-error")
        endSide()
        ui.waitUntil(5000){!owner.get().state.visible}
        assertEquals(1,ended.get())
    }
    @Test fun eachParentKeepsItsSideChatDraftAndModel(){
        val first=owner.get()
        ui.runOnIdle{
            first.draft("甲会话草稿")
            sessions.get().open("other","gpt-6.1-sol","low")
        }
        ui.waitUntil(10000){sessions.get().state.connected&&sessions.get().state.threadId=="side-other"}
        val second=sessions.get().current!!
        ui.runOnIdle{
            second.draft("乙会话草稿")
            assertFalse(first.state.visible)
            sessions.get().open("parent")
            assertSame(first,sessions.get().current)
            assertEquals("甲会话草稿",sessions.get().state.draft)
            assertEquals("gpt-6-sol",sessions.get().state.model)
            assertEquals("乙会话草稿",second.state.draft)
            assertEquals("gpt-6.1-sol",second.state.model)
            sessions.get().minimize()
            assertFalse(first.state.visible)
            sessions.get().open("other")
            assertSame(second,sessions.get().current)
        }
        assertEquals(2,forks.get())
    }
    @Test fun modelAndEffortAreSentOnlyToTheSideThread(){
        ui.onNodeWithTag("sideChatModel").performClick()
        ui.onAllNodesWithText("Sol",substring=true).onLast().performClick()
        ui.onNodeWithTag("modelList").assertIsDisplayed()
        ui.onNodeWithText("6.1 Sol",substring=true).performClick()
        ui.runOnIdle{owner.get().effort("low")}
        ui.onNodeWithTag("sideChatInput").performTextInput("独立模型")
        // Dismiss the popup before sending.
        androidx.test.espresso.Espresso.pressBack()
        ui.onNodeWithContentDescription("发送侧聊").performClick()
        ui.waitUntil(10000){commands.any{it.optString("type")=="turn.start"}}
        val command=commands.last{it.optString("type")=="turn.start"}
        assertEquals("side",command.getString("threadId"))
        assertEquals("gpt-6.1-sol",command.getString("model"))
        assertEquals("low",command.getString("effort"))
    }
    @Test fun attachmentSurvivesUnknownSubmissionAndClearsAfterAcceptance(){
        acceptSend=false
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val file=File(context.cacheDir,"side-notes.txt").apply{writeText("fixture file")}
        ui.runOnIdle{owner.get().upload(context.contentResolver,listOf(android.net.Uri.fromFile(file)),false)}
        ui.waitUntil(10000){!owner.get().state.uploading&&owner.get().state.uploads.size==1}
        val image=File(context.cacheDir,"outputs/side-photo.png").apply{parentFile!!.mkdirs()}
        val bitmap=android.graphics.Bitmap.createBitmap(2,2,android.graphics.Bitmap.Config.ARGB_8888)
        try{image.outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}finally{bitmap.recycle()}
        val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",image)
        ui.runOnIdle{owner.get().upload(context.contentResolver,listOf(uri),true)}
        ui.waitUntil(10000){!owner.get().state.uploading&&owner.get().state.images.size==1}
        ui.runOnIdle{assertEquals(2,sessions.get().uploadDraftRefs().size)}
        ui.onNodeWithContentDescription("发送侧聊").performClick()
        ui.waitUntil(5000){owner.get().state.pending}
        ui.onNodeWithTag("sideChatStatus").assertIsDisplayed()
        val status=ui.onNodeWithTag("sideChatStatus").fetchSemanticsNode().boundsInRoot
        val editor=ui.onNodeWithTag("sideChatInput").fetchSemanticsNode().boundsInRoot
        assertTrue(status.bottom<editor.top)
        ui.onNodeWithText("核对提交状态").performClick()
        ui.waitUntil(5000){owner.get().state.error.contains("尚未确认")}
        assertEquals(1,owner.get().state.uploads.size)
        assertEquals(1,owner.get().state.images.size)
        val command=commands.last{it.optString("type")=="turn.start"}
        sockets.last().send(JSONObject().put("type","command.accepted").put("threadId","side").put("requestId",command.getString("requestId")).toString())
        ui.waitUntil(5000){!owner.get().state.pending}
        assertTrue(owner.get().state.uploads.isEmpty())
        assertTrue(owner.get().state.images.isEmpty())
        ui.runOnIdle{assertTrue(sessions.get().uploadDraftRefs().isEmpty())}
        assertEquals("file-fixture",command.getJSONArray("files").getJSONObject(0).getString("id"))
        assertEquals("image-fixture",command.getJSONArray("images").getJSONObject(0).getString("id"))
    }
    @Test fun loadingWaitingAndOperationsHaveDistinctProgress(){
        historyDelayMillis=2000
        ui.runOnIdle{sessions.get().open("other","gpt-6-sol","high")}
        ui.waitUntil(10000){sessions.get().state.loadingHistory}
        ui.onNodeWithTag("historySkeleton").assertIsDisplayed()
        ui.onAllNodesWithText("正在加载会话").assertCountEquals(0)
        ui.onAllNodesWithTag("sideChatStatus").assertCountEquals(0)
        ui.onAllNodesWithText("正在处理").assertCountEquals(0)
        ui.waitUntil(10000){!sessions.get().state.loadingHistory&&sessions.get().state.connected}
        fun emit(type:String,id:String){
            sockets.last().send(JSONObject().put("type",type).put("threadId","side-other").put("turnId","active")
                .put("eventId",id).put("itemId","operation").put("title","读取文件").toString())
        }
        emit("turn.started","start")
        ui.waitUntil(5000){sessions.get().state.running}
        ui.onNodeWithText("等待回复").assertIsDisplayed()
        emit("tool.started","tool-start")
        ui.waitUntil(5000){sessions.get().state.events.any{it.eventId=="tool-start"}}
        ui.onNodeWithTag("sideActivity:tool.started:item:operation").assertIsDisplayed()
        ui.onAllNodesWithTag("sideChatStatus").assertCountEquals(0)
        capture("operation")
        emit("tool.completed","tool-end")
        ui.waitUntil(5000){sessions.get().state.events.any{it.eventId=="tool-end"}}
        ui.onAllNodesWithTag("sideChatStatus").assertCountEquals(0)
        emit("turn.completed","complete")
        ui.waitUntil(5000){!sessions.get().state.running}
        ui.onAllNodesWithTag("sideChatStatus").assertCountEquals(0)
    }
}
