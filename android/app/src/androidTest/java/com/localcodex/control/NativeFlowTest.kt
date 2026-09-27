package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.*
import okhttp3.mockwebserver.*
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class NativeFlowTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun pairingSheetHasScannerEntry(){
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("连接电脑").performClick()
        ui.onNodeWithText("扫描电脑二维码").assertExists()
    }
    private val server=MockWebServer()
    private lateinit var vm:NativeViewModel
    private val requests=CopyOnWriteArrayList<JSONObject>()
    private var queue="[]"
    @Volatile private var goalStatus=""
    @Volatile private var goalObjective="核对运行目标"
    @Volatile private var threadTitle="原生测试"
    @Volatile private var threadPinned=false
    @Volatile private var historyMore=false
    private val historyCounts=CopyOnWriteArrayList<Int>()
    private var saveTarget:android.net.Uri?=null
    private var savePickerRequests=0
    private val uploadCount=java.util.concurrent.atomic.AtomicInteger()
    private val rawFileCount=java.util.concurrent.atomic.AtomicInteger()
    private lateinit var pdfBytes:ByteArray
    private val releaseUpload=java.util.concurrent.CountDownLatch(1)
    @Volatile private var history="""[{"type":"user.message","threadId":"t","text":"原生发送","eventId":"user"},{"type":"message.delta","threadId":"t","text":"这是原生 Markdown 回复。","eventId":"answer"}]"""
    @Volatile private var historyStatus="running"
    @Volatile private var approvalsJson="[]"
    @Before fun setup(){
        val application=ApplicationProvider.getApplicationContext<Application>()
        val document=android.graphics.pdf.PdfDocument()
        try {
            for(index in 1..2){val page=document.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(400,600,index).create());page.canvas.drawText("Page $index",40f,80f,android.graphics.Paint());document.finishPage(page)}
            pdfBytes=java.io.ByteArrayOutputStream().use{output->document.writeTo(output);output.toByteArray()}
        } finally {document.close()}
        application.getSharedPreferences("appearance",0).edit().clear().commit()
        application.getSharedPreferences("native",0).edit().clear().commit()
        application.getSharedPreferences("connection",0).edit().clear().commit()
        ui.runOnUiThread {
            ui.activity.window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            ui.activity.window.statusBarColor=android.graphics.Color.WHITE
            ui.activity.window.navigationBarColor=android.graphics.Color.WHITE
            ui.activity.window.decorView.systemUiVisibility=android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){override fun dispatch(r:RecordedRequest):MockResponse {
            fun json(s:String)=MockResponse().setHeader("Content-Type","application/json").setBody(s)
            val path=r.requestUrl!!.encodedPath
            if(path=="/api/uploads/images"&&r.method=="POST"){
                val number=uploadCount.incrementAndGet()
                if(number==2)releaseUpload.await(10,java.util.concurrent.TimeUnit.SECONDS)
                return json("""{"id":"image-$number","name":"image-$number.png"}""")
            }
            if(path=="/api/uploads/files"&&r.method=="POST")return json("""{"id":"123e4567-e89b-12d3-a456-426614174000","name":"clip.mp4","mime":"video/mp4","size":${r.body.size}}""")
            if(path=="/api/uploads/files/123e4567-e89b-12d3-a456-426614174000")return MockResponse().setHeader("Content-Type","video/mp4").setBody("video-bytes")
            if(path=="/api/uploads/files/markdown-test")return MockResponse().setHeader("Content-Type","text/markdown").setBody("# 附件阅读\n\n正文")
            if(path=="/ws")return MockResponse().withWebSocketUpgrade(object:WebSocketListener(){override fun onClosing(webSocket:WebSocket,code:Int,reason:String){webSocket.close(code,reason)};override fun onMessage(ws:WebSocket,text:String){val m=JSONObject(text);requests.add(m);val id=m.optString("requestId");if(m.optString("text").contains("WRITER")){queue="""[{"id":"$id","text":"WRITER 冲突测试","status":"queued","error":"桌面版仍持有此会话的写入权"}]""";ws.send(JSONObject().put("type","message.queued").put("threadId","t").put("requestId",id).put("message","消息已排队").toString());return};ws.send(JSONObject().put("type","thread.started").put("threadId","t").put("requestId",id).put("thread",JSONObject().put("id","t").put("title","原生测试")).toString());ws.send(JSONObject().put("type","user.message").put("threadId","t").put("text",m.optString("initialText",m.optString("text"))).put("eventId","user").toString())}})
            if(path=="/health")return json("""{"ok":true,"minAndroidProtocolVersion":1}""")
            if(path=="/api/uploads/images/pixel.png")return MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==",0)))
            if(path=="/api/threads/t/history-image")return MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==",0)))
            if(path=="/api/projects")return json("""{"projects":[{"id":"p","name":"Codex-mobile-control","path":"F:/Code/Codex-mobile-control","trusted":true}]}""")
            if(path=="/api/approvals")return json("""{"approvals":$approvalsJson}""")
            if(path=="/raw/projects/p/file"){
                rawFileCount.incrementAndGet()
                return when{
                    r.requestUrl!!.queryParameter("path")?.endsWith(".pdf")==true->MockResponse().setHeader("Content-Type","application/pdf").setBody(okio.Buffer().write(pdfBytes))
                    r.requestUrl!!.queryParameter("path")?.endsWith(".md")==true->MockResponse().setHeader("Content-Type","text/markdown").setBody("# 阅读器标题\n\n**正文内容**")
                    else->MockResponse().setHeader("Content-Type","text/plain").setBody("linked output")
                }
            }
            if(path=="/api/threads/t/goal"&&r.method=="PATCH"){val body=JSONObject(r.body.readUtf8());goalStatus=body.optString("status",goalStatus);goalObjective=body.optString("objective",goalObjective);return json(JSONObject().put("goal",JSONObject().put("objective",goalObjective).put("status",goalStatus).put("tokensUsed",42).put("tokenBudget",JSONObject.NULL)).toString())}
            if(path=="/api/threads/t/pin"&&r.method=="POST"){threadPinned=JSONObject(r.body.readUtf8()).optBoolean("pinned");return json("""{"ok":true}""")}
            if(path=="/api/threads/t"&&r.method=="PATCH"){threadTitle=JSONObject(r.body.readUtf8()).getString("title");return json("""{"thread":{"id":"t","title":"$threadTitle"}}""")}
            if(path=="/api/threads")return json("""{"threads":[{"id":"t","title":"$threadTitle","status":"running","pinnedIndex":${if(threadPinned)0 else -1}${if(goalStatus.isNotBlank())",\"goal\":{\"objective\":\"$goalObjective\",\"status\":\"$goalStatus\",\"tokensUsed\":42}" else ""}}]}""")
            if(path.substringBefore('?')=="/api/models")return json("""{"models":[{"model":"test","displayName":"Test model","defaultReasoningEffort":"medium","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"medium"},{"reasoningEffort":"high"}]}]}""")
            if(path.substringBefore('?' )=="/api/usage"){
                val now=System.currentTimeMillis()
                return json("""{"quota":{"plan":"pro","stale":false,"windows":[{"name":"Codex","durationMins":10080,"remainingPercent":77,"resetsAt":1900000000}]},"quotaTrend":[{"at":${now-3600000},"name":"Codex","durationMins":300,"remainingPercent":90},{"at":${now-1800000},"name":"Codex","durationMins":10080,"remainingPercent":78},{"at":$now,"name":"Codex","durationMins":10080,"remainingPercent":77}],"tokens":{"total":12345,"input":10000,"cached":5000,"output":2345,"reasoning":345,"last":1200,"contextWindow":128000}}""")
            }
            if(path.endsWith("/events")){historyCounts.add(r.requestUrl!!.queryParameter("count")?.toIntOrNull()?:-1);return json("""{"status":"$historyStatus","hasMore":$historyMore,"events":$history}""")}
            if(path.endsWith("/queue")&&r.method=="POST"){val body=JSONObject(r.body.readUtf8());queue="""[{"id":"q","text":"${body.getString("text")}","status":"queued"}]""";return json("{}")}
            if(path.contains("/queue/")&&r.method=="DELETE"){queue="[]";return json("{}")}
            if(path.endsWith("/queue"))return json("""{"messages":$queue}""")
            return json("{}")
        }}
        server.start()
        val address=server.url("/").toString().trimEnd('/')
        ui.runOnUiThread {vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>());vm.connect(address,"test")}
        val registry=object:androidx.activity.result.ActivityResultRegistry(){
            override fun <I,O> onLaunch(requestCode:Int,contract:androidx.activity.result.contract.ActivityResultContract<I,O>,input:I,options:androidx.core.app.ActivityOptionsCompat?){
                val intent=contract.createIntent(application,input)
                Assert.assertEquals(android.content.Intent.ACTION_CREATE_DOCUMENT,intent.action)
                Assert.assertEquals("image/png",intent.type)
                savePickerRequests++
                dispatchResult(requestCode,android.app.Activity.RESULT_OK,android.content.Intent().setData(saveTarget))
            }
        }
        val owner=object:androidx.activity.result.ActivityResultRegistryOwner{override val activityResultRegistry=registry}
        ui.setContent{androidx.compose.runtime.CompositionLocalProvider(androidx.activity.compose.LocalActivityResultRegistryOwner provides owner){NativeApp(vm)}}
        ui.waitUntil(15000){vm.state.connected&&vm.state.threads.isNotEmpty()}
    }
    @After fun cleanup(){releaseUpload.countDown();ui.runOnUiThread{vm.disconnect()};server.shutdown()}
    @Test fun imageBatchKeepsSendingLockedAndRespectsLimit(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val file=java.io.File(context.cacheDir,"batch-test.jpg").apply{writeBytes(byteArrayOf(1,2,3))}
        val uri=android.net.Uri.fromFile(file)
        try {
            ui.runOnUiThread{vm.uploadImages(List(9){uri})}
            Assert.assertEquals(0,uploadCount.get())
            Assert.assertFalse(vm.state.uploading)
            ui.runOnUiThread{vm.error("");vm.uploadImages(listOf(uri,uri))}
            ui.waitUntil(10000){uploadCount.get()==2&&vm.state.images.size==1}
            Assert.assertTrue(vm.state.uploading)
            ui.runOnUiThread{vm.draft("等待全部图片");vm.send()}
            Assert.assertTrue(requests.isEmpty())
            releaseUpload.countDown()
            ui.waitUntil(10000){!vm.state.uploading}
            Assert.assertEquals(2,vm.state.images.size)
            ui.runOnUiThread{vm.send()}
            ui.waitUntil(10000){requests.isNotEmpty()}
        } finally {file.delete()}
    }
    @Test fun usageShowsQuotaAndTokens(){
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onAllNodesWithText("用量与配额").onLast().performClick()
        ui.waitUntil(10000){vm.state.usage!=null}
        ui.onNodeWithText("77% 剩余").assertIsDisplayed()
        ui.onNodeWithText("Codex · 7 天额度").assertIsDisplayed()
        ui.onNodeWithText("配额剩余趋势").assertIsDisplayed()
        ui.onNodeWithText("5 小时 1 个采样 · 1 周 2 个采样").assertIsDisplayed()
        ui.onNodeWithText("12,345").performScrollTo().assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
    }
    @Test fun desktopAndGatewayPermissionsOfferPhoneActions(){
        approvalsJson="""[{"id":"desktop:1:7-item-7","threadId":"t","status":"pending","approvalType":"command","title":"运行命令","detail":"确认执行桌面端命令"}]"""
        history="""[{"type":"approval.requested","threadId":"t","eventId":"desktop-approval:t:call","approvalId":"desktop:1:7-item-7","approvalType":"command","title":"运行命令","detail":"确认执行桌面端命令"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.approvalId=="desktop:1:7-item-7"}}
        ui.onNodeWithText("需要你的确认").assertIsDisplayed()
        ui.onNodeWithText("确认执行桌面端命令").assertIsDisplayed()
        ui.onAllNodesWithText("允许").onLast().assertIsDisplayed()
        ui.onAllNodesWithText("拒绝").onLast().assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        approvalsJson="""[{"id":"approval-1","threadId":"t","status":"pending","approvalType":"command","title":"运行命令","detail":"确认执行此命令"}]"""
        history="""[{"type":"approval.requested","threadId":"t","eventId":"gateway-approval:t:1","approvalId":"approval-1","approvalType":"command","title":"运行命令","detail":"确认执行此命令"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.approvalId=="approval-1"}}
        ui.onNodeWithText("需要你的确认").assertIsDisplayed()
    }
    @Test fun desktopAsyncQuestionOpensOnPhoneAndCanBeAnswered(){
        val detail=JSONObject().put("questions",org.json.JSONArray().put(JSONObject().put("id","0").put("question","选择连接方式").put("options",org.json.JSONArray().put(JSONObject().put("label","内网")).put(JSONObject().put("label","公网"))))).toString()
        approvalsJson=org.json.JSONArray().put(JSONObject().put("id","desktop-question:call-test").put("threadId","t").put("status","pending").put("approvalType","question").put("title","需要你的回答").put("detail",detail)).toString()
        history=org.json.JSONArray().put(JSONObject().put("type","approval.requested").put("threadId","t").put("eventId","desktop-question:t:call-test").put("approvalId","desktop-question:call-test").put("approvalType","question").put("title","需要你的回答").put("detail",detail)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.pendingApprovals.any{it.approvalId=="desktop-question:call-test"}}
        ui.onAllNodesWithText("选择连接方式").onLast().assertIsDisplayed()
        ui.onAllNodesWithText("公网").onLast().performClick()
        ui.onAllNodesWithText("提交回答").onLast().performClick()
        ui.waitUntil(10000){"desktop-question:call-test" in vm.state.approvals}
    }
    @Test fun pendingApprovalFromGatewayOpensWithoutTimelineEvent(){
        approvalsJson="""[{"id":"desktop:7:9-item-9","threadId":"t","status":"pending","approvalType":"file","title":"允许文件变更","detail":"手机可处理此审批"}]"""
        history="[]"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.pendingApprovals.any{it.approvalId=="desktop:7:9-item-9"}}
        ui.onNodeWithText("手机可处理此审批").assertIsDisplayed()
        ui.onAllNodesWithText("允许").onLast().assertIsDisplayed()
    }
    @Test fun nativeSendQueueAndModelDialog(){
        ui.onNodeWithTag("composer").performTextInput("原生发送")
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){requests.isNotEmpty()&&vm.state.running}
        Assert.assertEquals("thread.start",requests[0].getString("type"))
        Assert.assertFalse(requests[0].has("projectPath"))
        val modelBefore=ui.onNodeWithText("Test model · 中").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithContentDescription("停止任务").assertExists()
        ui.onNodeWithTag("composer").performTextInput("排队消息")
        val sendBounds=ui.onNodeWithContentDescription("加入队列").fetchSemanticsNode().boundsInRoot
        val modelAfter=ui.onNodeWithText("Test model · 中").fetchSemanticsNode().boundsInRoot
        val rootBounds=ui.onRoot().fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("发送按钮溢出屏幕",sendBounds.right<=rootBounds.right)
        ui.onNodeWithContentDescription("停止任务").assertDoesNotExist()
        Assert.assertEquals("输入时模型选择器宽度变化",modelBefore.width,modelAfter.width,2f)
        ui.onNodeWithContentDescription("加入队列").performClick()
        ui.waitUntil(10000){vm.state.queue.isNotEmpty()}
        ui.onNodeWithText("排队消息").assertIsDisplayed()
        screenshot("native-queue.png")
        ui.onNodeWithContentDescription("待发消息操作").performClick()
        ui.onNodeWithText("取消发送").performClick()
        ui.waitUntil(10000){vm.state.queue.isEmpty()}
        ui.onNodeWithText("Test model · 中").performClick()
        ui.onNodeWithText("模型").assertIsDisplayed()
        ui.onNodeWithText("思考强度 · 中").assertIsDisplayed()
        ui.onNodeWithText("搜索模型").assertDoesNotExist()
        screenshot("native-model-compact.png")
        val sliderBounds=ui.onNodeWithTag("effortSlider").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithTag("effortSlider").performTouchInput{click(Offset(sliderBounds.width*0.92f,sliderBounds.height/2f))}
        ui.waitUntil(5000){vm.state.effort=="high"}
        ui.onNodeWithText("思考强度 · 高").assertIsDisplayed()
        ui.onNodeWithText("权限与更多设置").performClick()
        ui.onNodeWithText("模型与思考强度").assertIsDisplayed()
        ui.onNodeWithContentDescription("选择模型").performClick()
        ui.onNodeWithText("搜索模型").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.onAllNodesWithContentDescription("新会话").onLast().performClick()
        ui.waitUntil(5000){vm.state.threadId.isEmpty()}
        ui.onNodeWithText("今天想完成什么？").assertIsDisplayed()
        screenshot("native-home-050.png")
    }
    @Test fun queuedEditRestoresTextImagesAndFilesToComposer(){
        queue="""[{"id":"queued-edit","text":"原队列消息","status":"queued","images":[{"id":"pixel.png","name":"图片.png"}],"files":[{"id":"123e4567-e89b-12d3-a456-426614174000","name":"clip.mp4","mime":"video/mp4","size":11}]}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.queue.any{it.id=="queued-edit"}}
        ui.onNodeWithTag("composer").performTextInput("现有草稿")
        ui.onNodeWithContentDescription("待发消息操作").performClick()
        ui.onNodeWithText("编辑消息").performClick()
        ui.waitUntil(10000){vm.state.queue.isEmpty()&&vm.state.draft.contains("原队列消息")}
        Assert.assertEquals("原队列消息\n\n现有草稿",vm.state.draft)
        Assert.assertEquals("pixel.png",vm.state.images.single().id)
        Assert.assertEquals("clip.mp4",vm.state.uploads.single().name)
        ui.onNodeWithText("clip.mp4").assertIsDisplayed()
        ui.onNodeWithContentDescription("移除文件").performClick()
        Assert.assertTrue(vm.state.uploads.isEmpty())
        ui.onNodeWithText("编辑待发消息").assertDoesNotExist()
    }
    @Test fun activeGoalAppearsInDrawerAndCurrentThread(){
        goalStatus="active"
        val address=vm.state.address
        ui.runOnUiThread{vm.connect(address,"test")}
        ui.waitUntil(15000){vm.state.threads.firstOrNull()?.goal?.status=="active"}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("进行中").assertIsDisplayed()
        ui.onNodeWithText("核对运行目标").performClick()
        ui.waitUntil(10000){vm.state.threadId=="t"}
        ui.onNodeWithTag("goalChip").assertIsDisplayed()
        val goal=ui.onNodeWithTag("goalChip").fetchSemanticsNode().boundsInRoot
        val composer=ui.onNodeWithTag("composer").fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("目标应位于输入框上方",goal.bottom<=composer.top)
        ui.onNodeWithTag("goalChip").performClick()
        ui.onNodeWithTag("goalObjective",useUnmergedTree=true).assertIsDisplayed()
        ui.onNodeWithText("暂停").performClick()
        ui.waitUntil(10000){vm.state.threads.first().goal?.status=="paused"}
        ui.onNodeWithText("继续").performClick()
        ui.waitUntil(10000){vm.state.threads.first().goal?.status=="active"}
        screenshot("native-goal-bottom.png")
    }
    @Test fun longPressThreadShowsRenameAndPin(){
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithTag("threadRow:t").performTouchInput{longClick()}
        ui.onNodeWithText("置顶").assertIsDisplayed()
        screenshot("native-thread-menu.png")
        ui.onNodeWithText("置顶").performClick()
        ui.waitUntil(10000){threadPinned}
        ui.onNodeWithTag("threadRow:t").performTouchInput{longClick()}
        ui.onNodeWithText("重命名").performClick()
        ui.onAllNodes(hasSetTextAction()).onLast().performTextReplacement("改名后的会话")
        ui.onNodeWithText("保存").performClick()
        ui.waitUntil(10000){threadTitle=="改名后的会话"}
    }
    @Test fun longHistoryRequestsOnlyInitialWindowAndLoadsMoreOnDemand(){
        historyMore=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.hasMoreHistory}
        Assert.assertTrue(historyCounts.contains(60))
        ui.onNodeWithText("查看更早记录").performClick()
        ui.waitUntil(10000){historyCounts.contains(120)}
    }
    @Test fun historyStaysInPlaceWhilePollingAndTyping(){
        val rows=org.json.JSONArray()
        for(i in 0 until 30){rows.put(JSONObject().put("type","user.message").put("threadId","t").put("text","历史用户 $i").put("eventId","u$i"));rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("text","第 $i 段回复，保留当前阅读位置。").put("eventId","a$i").put("itemId","a$i"))}
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==60}
        ui.onNodeWithTag("messages").performScrollToIndex(20)
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitForIdle()
        val box=ui.onNodeWithTag("messages").fetchSemanticsNode().boundsInRoot
        val anchor=ui.onAllNodes(hasText("历史用户",substring=true)).fetchSemanticsNodes().first{it.boundsInRoot.top>=box.top&&it.boundsInRoot.bottom<box.bottom}
        val label=anchor.config[SemanticsProperties.Text].first().text
        val top=anchor.boundsInRoot.top
        rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("text","新增流式段落").put("eventId","new").put("itemId","new"));history=rows.toString()
        ui.waitUntil(10000){vm.state.events.size==61}
        ui.waitForIdle()
        Assert.assertEquals(top,ui.onNodeWithText(label).fetchSemanticsNode().boundsInRoot.top,3f)
        ui.onNodeWithTag("composer").performTextInput("阅读时输入草稿")
        Assert.assertEquals(top,ui.onNodeWithText(label).fetchSemanticsNode().boundsInRoot.top,3f)
        screenshot("native-reading.png")
        ui.onNodeWithContentDescription("回到最新").performClick()
    }
    @Test fun videoAttachmentUploadsAndIsSentWithOriginalBytes(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val local=java.io.File(context.cacheDir,"outputs/clip.mp4").apply{parentFile?.mkdirs();writeBytes(ByteArray(8192){(it%251).toByte()})}
        val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",local)
        try{
            ui.runOnUiThread{vm.uploadFiles(listOf(uri))}
            ui.waitUntil(15000){vm.state.uploads.size==1&&!vm.state.uploading}
            Assert.assertEquals(8192L,vm.state.uploads.single().size)
            ui.onNodeWithText("clip.mp4").assertIsDisplayed()
            ui.onNodeWithContentDescription("发送消息").performClick()
            ui.waitUntil(10000){requests.any{it.optJSONArray("files")?.length()==1}}
            Assert.assertEquals("123e4567-e89b-12d3-a456-426614174000",requests.last().getJSONArray("files").getJSONObject(0).getString("id"))
        }finally{local.delete()}
    }
    private fun screenshot(name:String){
        ui.waitForIdle()
        // Semantic updates precede the emulator compositor and IME animation.
        android.os.SystemClock.sleep(700)
        val image=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val context=ApplicationProvider.getApplicationContext<Application>()
        java.io.File(context.getExternalFilesDir(null),name).outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        fun containsWeb(view:android.view.View):Boolean=view is android.webkit.WebView||(view is android.view.ViewGroup&&(0 until view.childCount).any{containsWeb(view.getChildAt(it))})
        ui.runOnUiThread{Assert.assertFalse("Native screen contains WebView",containsWeb(ui.activity.window.decorView))}
    }
    @Test fun savedConnectionAndEffortSurviveReconnect(){
        ui.runOnUiThread{vm.effort("high");vm.disconnect();vm.autoConnect()}
        ui.waitUntil(10000){vm.state.connected}
        Assert.assertEquals("high",vm.state.effort)
    }
    @Test fun modelAndPermissionRememberPerConversationAndWriterQueues(){
        historyStatus="idle"
        val thread=vm.state.threads.first().copy(status="idle")
        ui.runOnUiThread{vm.openThread(thread);vm.effort("high");vm.permission("ask")}
        Assert.assertEquals("ask",vm.state.permission)
        ui.runOnUiThread{vm.newThread();vm.permission("full");vm.openThread(thread)}
        Assert.assertEquals("high",vm.state.effort)
        Assert.assertEquals("ask",vm.state.permission)
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running}
        ui.runOnUiThread{vm.draft("WRITER 冲突测试");vm.send()}
        ui.waitUntil(10000){requests.isNotEmpty()&&vm.state.queue.any{it.text.contains("WRITER")}}
        Assert.assertEquals("ask",requests.last().getString("permission"))
        Assert.assertTrue(vm.state.draft.isEmpty())
        Assert.assertFalse(vm.state.sending)
    }
    @Test fun markdownFileLinkOpensAuthorizedOutput(){
        ui.waitUntil(10000){vm.state.projects.any{it.id=="p"}}
        history=org.json.JSONArray().put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","linked-file").put("text","[打开文件](F:/Code/Codex-mobile-control/artifacts/linked-output.txt)")).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="linked-file"}}
        ui.waitForIdle()
        var point:Pair<Float,Float>?=null
        ui.runOnUiThread{
            fun find(view:android.view.View){
                if(view is android.widget.TextView&&view.text.contains("打开文件")&&view.layout!=null){
                    val label=view.text.toString().indexOf("打开文件")
                    val spans=(view.text as android.text.Spanned).getSpans(label,label+4,android.text.style.ClickableSpan::class.java)
                    Assert.assertTrue("Markdown 链接缺少可点击 span",spans.isNotEmpty())
                    val location=IntArray(2);view.getLocationOnScreen(location)
                    val line=view.layout.getLineForOffset(label)
                    point=Pair(location[0]+view.totalPaddingLeft+view.layout.getPrimaryHorizontal(label+2),location[1]+view.totalPaddingTop+(view.layout.getLineTop(line)+view.layout.getLineBottom(line))/2f)
                }
                if(view is android.view.ViewGroup)(0 until view.childCount).forEach{find(view.getChildAt(it))}
            }
            find(ui.activity.window.decorView)
        }
        Assert.assertNotNull("找不到文件链接位置",point)
        val now=android.os.SystemClock.uptimeMillis()
        val instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        instrumentation.sendPointerSync(android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,point!!.first,point!!.second,0))
        instrumentation.sendPointerSync(android.view.MotionEvent.obtain(now,now+50,android.view.MotionEvent.ACTION_UP,point!!.first,point!!.second,0))
        ui.waitUntil(10000){rawFileCount.get()>0}
        Assert.assertTrue(vm.state.error.isBlank())
    }
    @Test fun pdfOpensInsideAppAndTurnsPages(){
        ui.waitUntil(10000){vm.state.projects.any{it.id=="p"}}
        ui.runOnUiThread{vm.openOutput("F:/Code/Codex-mobile-control/artifacts/report.pdf")}
        ui.waitUntil(10000){vm.state.pdf!=null}
        ui.waitUntil(10000){runCatching{ui.onNodeWithContentDescription("PDF 第 1 页").assertIsDisplayed();true}.getOrDefault(false)}
        ui.onNodeWithContentDescription("下一页").performClick()
        ui.waitUntil(10000){runCatching{ui.onNodeWithContentDescription("PDF 第 2 页").assertIsDisplayed();true}.getOrDefault(false)}
        ui.onNodeWithContentDescription("放大 PDF").performClick()
        ui.onNodeWithText("125%").assertIsDisplayed()
        ui.onNodeWithContentDescription("保存 PDF").assertIsDisplayed()
        screenshot("native-pdf-preview.png")
        ui.onNodeWithContentDescription("关闭 PDF 预览").performClick()
        ui.waitUntil(5000){vm.state.pdf==null}
        Assert.assertTrue(rawFileCount.get()>0)
    }
    @Test fun markdownOutputOpensInAppWithSourceMode(){
        ui.waitUntil(10000){vm.state.projects.any{it.id=="p"}}
        ui.runOnUiThread{vm.openOutput("F:/Code/Codex-mobile-control/artifacts/report.md")}
        ui.waitUntil(10000){vm.state.markdown?.content?.contains("阅读器标题")==true}
        ui.onNodeWithText("report.md").assertIsDisplayed()
        ui.onNodeWithText("源码").performClick()
        ui.onNodeWithText("# 阅读器标题",substring=true).assertIsDisplayed()
        ui.onNodeWithText("阅读").performClick()
        screenshot("native-markdown-preview.png")
        ui.onNodeWithContentDescription("关闭阅读器").performClick()
        ui.waitUntil(5000){vm.state.markdown==null}
        Assert.assertTrue(rawFileCount.get()>0)
    }
    @Test fun uploadedMarkdownOpensInApp(){
        ui.runOnUiThread{vm.openUpload(NativeUploadedFile("markdown-test","notes.md","text/markdown",22))}
        ui.waitUntil(10000){vm.state.markdown?.content?.contains("附件阅读")==true}
        ui.onNodeWithText("notes.md").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭阅读器").performClick()
        ui.waitUntil(5000){vm.state.markdown==null}
    }
    @Test fun desktopHistoryImageRendersWithoutMarkup(){
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","history:t:8").put("text","查看这张图")
            .put("attachments",org.json.JSONArray().put(JSONObject().put("name","Image #1").put("path","C:/Users/Test/AppData/Local/Temp/codex-clipboard-test.png")
                .put("url","/api/threads/t/history-image?eventId=history%3At%3A8&index=0")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="history:t:8"}}
        ui.waitUntil(10000){runCatching{ui.onNodeWithContentDescription("图片").assertIsDisplayed();true}.getOrDefault(false)}
        ui.onNodeWithText("查看这张图").assertIsDisplayed()
        ui.onNodeWithText("<image",substring=true).assertDoesNotExist()
    }
    @Test fun multipleImagesStayCompactWithMessageText(){
        val images=org.json.JSONArray()
        repeat(4){images.put(JSONObject().put("id","pixel.png").put("name","图 ${it+1}"))}
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","image-grid").put("text","图文同条消息").put("images",images)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==4}
        val tiles=ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().map{it.boundsInRoot}.sortedWith(compareBy({it.top},{it.left}))
        val density=ApplicationProvider.getApplicationContext<Application>().resources.displayMetrics.density
        Assert.assertTrue("图片应是缩略图",tiles.all{it.width<=110f*density})
        Assert.assertTrue("第一行应有两张图片",kotlin.math.abs(tiles[0].top-tiles[1].top)<8f*density)
        Assert.assertTrue("第二行应有两张图片",kotlin.math.abs(tiles[2].top-tiles[3].top)<8f*density)
        Assert.assertTrue("两行图片应在同一条消息中",tiles[2].top>tiles[0].bottom)
        ui.onNodeWithText("图文同条消息").assertIsDisplayed()
        screenshot("native-image-message-grid.png")
    }
    @Test fun activityTimelineShowsCompactSummaryAndKeepsDetails(){
        history=org.json.JSONArray()
            .put(JSONObject().put("type","tool.started").put("threadId","t").put("eventId","tool-start").put("itemId","cmd-1").put("title","检查构建").put("command","./gradlew test"))
            .put(JSONObject().put("type","tool.output").put("threadId","t").put("eventId","tool-output").put("itemId","cmd-1").put("text","BUILD SUCCESSFUL"))
            .put(JSONObject().put("type","tool.completed").put("threadId","t").put("eventId","tool-end").put("itemId","cmd-1").put("status","completed"))
            .put(JSONObject().put("type","reasoning.summary").put("threadId","t").put("eventId","reasoning").put("text","**接下来检查界面布局。**"))
            .put(JSONObject().put("type","file.changed").put("threadId","t").put("eventId","changed").put("title","文件改动").put("detail","NativeScreen.kt"))
            .put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","answer").put("text","界面已经调整。"))
            .toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="answer"}}
        ui.onNodeWithText("处理过程 · 2 项").assertIsDisplayed()
        ui.onNodeWithText("接下来检查界面布局。").assertDoesNotExist()
        ui.onNodeWithText("BUILD SUCCESSFUL").assertDoesNotExist()
        screenshot("native-activity-compact.png")
        ui.onNodeWithText("处理过程 · 2 项").performClick()
        ui.onNodeWithText("接下来检查界面布局。").assertIsDisplayed()
        ui.onNodeWithText("**接下来检查界面布局。**").assertDoesNotExist()
        ui.onNodeWithText("编辑文件").assertIsDisplayed()
        ui.onNodeWithText("检查构建").assertIsDisplayed()
        ui.onNodeWithText("检查构建").performClick()
        ui.onNodeWithText("BUILD SUCCESSFUL",substring=true).assertIsDisplayed()
    }
    @Test fun conversationHeaderAndAttachmentMenuAreCompact(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithTag("conversationTitle").assertTextEquals("原生测试")
        ui.onNodeWithContentDescription("添加附件").performClick()
        ui.onNodeWithText("照片").assertIsDisplayed()
        ui.onNodeWithText("文件与视频").assertIsDisplayed()
        screenshot("native-attachment-menu-016.png")
    }
    @Test fun switchingConversationDiscardsPendingUploadResult(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val file=java.io.File(context.cacheDir,"switch-upload.jpg").apply{writeBytes(byteArrayOf(1,2,3))}
        val uri=android.net.Uri.fromFile(file)
        try {
            ui.runOnUiThread{vm.uploadImages(listOf(uri,uri))}
            ui.waitUntil(10000){uploadCount.get()==2&&vm.state.images.size==1}
            ui.runOnUiThread{vm.newThread()}
            releaseUpload.countDown()
            ui.waitUntil(10000){!vm.state.uploading}
            Assert.assertTrue(vm.state.images.isEmpty())
        } finally {file.delete()}
    }
    @Test fun uploadedImageAndFormulaRenderNatively(){
        val rows=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","image").put("text","检查图片和公式").put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png").put("name","pixel.png"))))
        rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","math").put("text","公式 \$x^2 + y^2 = z^2\$"))
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("图片").assertIsDisplayed()
        ui.waitUntil(10000){
            var found=false
            fun scan(v:android.view.View){if(v is android.widget.TextView){val text=v.text;if(text is android.text.Spanned&&text.getSpans(0,text.length,Any::class.java).any{it.javaClass.name.contains("JLatex")})found=true};if(v is android.view.ViewGroup)(0 until v.childCount).forEach{scan(v.getChildAt(it))}}
            ui.runOnUiThread{scan(ui.activity.window.decorView)};found
        }
        screenshot("native-image-math.png")
        ui.onNodeWithContentDescription("图片").performClick()
        ui.onNodeWithContentDescription("图片预览").assertIsDisplayed()
        ui.onNodeWithContentDescription("放大图片").performClick()
        ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"200%"))
        ui.onNodeWithContentDescription("复位图片").performClick()
        ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"100%"))
        val context=ApplicationProvider.getApplicationContext<Application>()
        val output=java.io.File(context.cacheDir,"outputs/saved-test.png").apply{parentFile!!.mkdirs();delete()}
        val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",output)
        saveTarget=uri
        try {
            ui.onNodeWithContentDescription("保存图片").performClick()
            ui.waitUntil(10000){output.exists()&&output.length()>0}
            Assert.assertEquals(1,savePickerRequests)
            Assert.assertArrayEquals(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==",0),output.readBytes())
        } finally {output.delete()}
        ui.onNodeWithContentDescription("关闭图片预览").performClick()
        ui.onNodeWithContentDescription("图片预览").assertDoesNotExist()
    }
    @Test fun darkThemeUpdatesMarkdownAndPersists(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("外观").performClick()
        ui.onNodeWithText("深色").performClick()
        ui.waitUntil(5000){ui.activity.window.statusBarColor==android.graphics.Color.rgb(20,22,26)}
        val preferences=ApplicationProvider.getApplicationContext<Application>().getSharedPreferences("appearance",0)
        Assert.assertEquals("dark",preferences.getString("theme",null))
        var readable=false
        ui.runOnUiThread{fun scan(v:android.view.View){if(v is android.widget.TextView&&v.text.contains("Markdown"))readable=v.currentTextColor==android.graphics.Color.rgb(241,242,244);if(v is android.view.ViewGroup)(0 until v.childCount).forEach{scan(v.getChildAt(it))}};scan(ui.activity.window.decorView)}
        Assert.assertTrue(readable)
        screenshot("native-dark.png")
        ui.onNodeWithContentDescription("会话菜单").performClick();ui.onNodeWithText("外观").performClick();ui.onNodeWithText("浅色").performClick()
        ui.waitUntil(5000){ui.activity.window.statusBarColor==android.graphics.Color.rgb(250,251,252)}
    }
    @Test fun richDocumentAndCopyActions(){
        val document="""
            ## 一次清晰的实现
            先把问题拆成两个步骤，再验证结果。行内公式 ${'$'}E=mc^2${'$'} 可以直接阅读。

            ${'$'}${'$'}
            \sum_{i=1}^{n} x_i^2 = \frac{n(n+1)(2n+1)}{6}
            ${'$'}${'$'}

            | 检查项 | 结果 | 说明 |
            | --- | --- | --- |
            | 连接 | 正常 | 已连接到电脑 |
            | 队列 | 就绪 | 当前任务完成后继续 |

            ```kotlin
            fun greet(name: String) = "Hello, " + name
            ```
        """.trimIndent()
        history=org.json.JSONArray().put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","rich").put("text",document)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.isNotEmpty()}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        screenshot("native-rich-050.png")
        var tableScrollable=false
        fun inspect(view:android.view.View){
            if(view is android.widget.HorizontalScrollView&&view.canScrollHorizontally(1)){view.scrollTo(100,0);tableScrollable=tableScrollable||view.scrollX>0;view.scrollTo(0,0)}
            if(view is android.view.ViewGroup)(0 until view.childCount).forEach{inspect(view.getChildAt(it))}
        }
        ui.runOnUiThread{inspect(ui.activity.window.decorView)}
        Assert.assertTrue("宽表格应能独立横向阅读",tableScrollable)
        ui.onNodeWithContentDescription("复制代码").performScrollTo().performClick()
        val clipboard=ApplicationProvider.getApplicationContext<Application>().getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        ui.runOnUiThread{Assert.assertEquals("fun greet(name: String) = \"Hello, \" + name",clipboard.primaryClip!!.getItemAt(0).text.toString())}
        ui.onNodeWithContentDescription("复制回复").performScrollTo().performClick()
        ui.runOnUiThread{Assert.assertEquals(document,clipboard.primaryClip!!.getItemAt(0).text.toString())}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        screenshot("native-drawer-050.png")
    }
}
