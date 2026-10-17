package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect

@RunWith(AndroidJUnit4::class)
class NativeOutputFlowTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @get:Rule val testName=org.junit.rules.TestName()
    private val server=MockWebServer()
    private val reads=CopyOnWriteArrayList<RecordedRequest>()
    private val wireMessages=CopyOnWriteArrayList<String>()
    private val liveSocket=java.util.concurrent.atomic.AtomicReference<okhttp3.WebSocket>()
    @Volatile private var wireReply:((okhttp3.WebSocket,String)->Unit)?=null
    private lateinit var vm:NativeViewModel
    private var historyText:String?=null
    @Volatile private var retryImageAvailable=true
    private val application get()=ApplicationProvider.getApplicationContext<Application>()
    @Before fun setup(){
        check(application.packageName.endsWith(".remotecheck"))
        application.getSharedPreferences("native",0).edit().clear().commit()
        application.getSharedPreferences("connection",0).edit().clear().commit()
        val bitmap=android.graphics.Bitmap.createBitmap(400,400,android.graphics.Bitmap.Config.ARGB_8888).apply{eraseColor(android.graphics.Color.rgb(90,145,110))}
        val image=java.io.ByteArrayOutputStream().also{bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,90,it)}.toByteArray()
        bitmap.recycle()
        fun fixtureImage(width:Int,height:Int):ByteArray{
            val source=android.graphics.Bitmap.createBitmap(width,height,android.graphics.Bitmap.Config.ARGB_8888).apply{eraseColor(android.graphics.Color.rgb(90,145,110))}
            return try{java.io.ByteArrayOutputStream().also{source.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}.toByteArray()}finally{source.recycle()}
        }
        val wide=fixtureImage(900,150);val tall=fixtureImage(150,900)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            reads.add(request)
            val path=request.requestUrl!!.encodedPath
            fun json(text:String)=MockResponse().setHeader("Content-Type","application/json").setBody(text)
            if(path=="/health")return json("""{"ok":true,"protocolVersion":1,"minAndroidProtocolVersion":1,"capabilities":["local-thread-output-files","new-thread-goals"]}""")
            if(path=="/ws")return MockResponse().withWebSocketUpgrade(object:okhttp3.WebSocketListener(){override fun onOpen(socket:okhttp3.WebSocket,response:okhttp3.Response){liveSocket.set(socket);socket.send("""{"type":"connected","capabilities":["local-thread-output-files","new-thread-goals"]}""")};override fun onMessage(socket:okhttp3.WebSocket,text:String){wireMessages.add(text);wireReply?.invoke(socket,text)};override fun onClosing(socket:okhttp3.WebSocket,code:Int,reason:String){socket.close(code,reason)}})
            if(path=="/api/projects")return json("""{"projects":[]}""")
            if(path=="/api/sidebar")return json("""{"projects":[],"allowedProjects":[]}""")
            if(path=="/api/threads")return json("""{"threads":[{"id":"t","title":"照片预览","projectPath":"E:/Pictures/720","status":"idle"}]}""")
            if(path=="/api/models")return json("""{"models":[{"model":"gpt-6-sol","displayName":"Sol","supportedReasoningEfforts":[{"reasoningEffort":"high"}]}]}""")
            if(path=="/api/approvals")return json("""{"approvals":[]}""")
            if(path=="/api/threads/t/events"&&historyText!=null)return json(org.json.JSONObject().put("status","idle").put("hasMore",false).put("events",org.json.JSONArray().put(org.json.JSONObject().put("type","message.delta").put("threadId","t").put("eventId","history:photo").put("text",historyText))).toString())
            if(path=="/api/threads/t/events")return json("""{"status":"idle","hasMore":false,"events":[{"type":"user.message","threadId":"t","eventId":"u","text":"朋友圈选9图"},{"type":"message.delta","threadId":"t","eventId":"history:photo","text":"**逆光暗调可以保留。**其余照片无需调整。\n\n![九宫格预览](E:/Pictures/720/九宫格.jpg)"}]}""")
            if(path.contains("/output-file/")&&request.requestUrl!!.queryParameter("path")?.endsWith("slow.md")==true)
                return MockResponse().setBody("旧会话文档").setHeadersDelay(3,java.util.concurrent.TimeUnit.SECONDS)
            if(path.contains("/output-file/")&&request.requestUrl!!.queryParameter("path")?.endsWith("fresh.md")==true)
                return MockResponse().setBody("新会话文档")
            val output=request.requestUrl!!.queryParameter("path").orEmpty()
            if(path.contains("/output-file/")&&output.endsWith("retry.png")&&!retryImageAvailable)return MockResponse().setResponseCode(404)
            if(path.contains("/output-file/")&&(output.endsWith("wide.png")||output.endsWith("tall.png")))
                return MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(if(output.endsWith("wide.png"))wide else tall))
            if(path.contains("/output-file/"))return MockResponse().setHeader("Content-Type","image/jpeg").setBody(okio.Buffer().write(image))
            if(path.endsWith("/queue"))return json("""{"messages":[],"canSteer":false}""")
            return json("{}")
        }}
        server.start()
        val address=server.url("/").toString().trimEnd('/')
        if(testName.methodName=="legacyMessagesCanBeReviewedAndCopiedWithoutRemoteRequests"){
            val legacy=org.json.JSONObject().put("id","unassigned-record").put("address",address).put("certificateSha256",org.json.JSONObject.NULL)
                .put("threadId","t").put("text","需要保留的旧消息").put("submittedAt","2026-10-01T09:30:00Z")
                .put("images",org.json.JSONArray().put(org.json.JSONObject().put("id","unassigned-image").put("name","旧图片.png")))
                .put("uploads",org.json.JSONArray().put(org.json.JSONObject().put("id","unassigned-file").put("name","旧文档.pdf").put("mime","application/pdf").put("size",8)))
            application.getSharedPreferences("native",0).edit().putString("send:unassigned-record",legacy.toString()).commit()
        }
        ui.runOnUiThread{vm=NativeViewModel(application);vm.connect(address,"fixture")}
        ui.setContent{NativeApp(vm)}
        ui.waitUntil(15000){vm.state.connected&&vm.state.threads.isNotEmpty()}
    }
    @After fun cleanup(){ui.runOnUiThread{vm.disconnect()};server.shutdown()}
    @Test fun connectionValidationKeepsInputsUntilCorrected(){
        val originalAddress=vm.state.address
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("连接电脑",useUnmergedTree=true).performScrollTo().performClick()
        fun field(tag:String)=ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag(tag)))
        field("connectionPassword").performScrollTo().performTextReplacement("retained-draft")
        field("connectionPassword").assert(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsProperties.Password))
        ui.onNodeWithText("显示密码").performScrollTo().performClick()
        field("connectionPassword").assertTextEquals("retained-draft")
        ui.onNodeWithText("隐藏密码").performClick()
        field("connectionPassword").assert(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsProperties.Password))
        ui.onNodeWithText("显示密码").performClick()
        field("connectionCertificate").performScrollTo().performTextReplacement("invalid")
        ui.onNodeWithText("保存并连接").performScrollTo().performClick()
        ui.onNodeWithTag("connectionFormError").assertTextEquals("本地证书指纹应为 64 位 SHA-256 十六进制字符")
        field("connectionCertificate").assertTextEquals("invalid")
        field("connectionPassword").assertTextEquals("retained-draft")
        ui.runOnIdle{Assert.assertTrue(vm.state.connected);Assert.assertEquals("",ConnectionStore(application).remotePassword())}
        field("connectionCertificate").performScrollTo().performTextReplacement("")
        field("connectionPublicUrl").performScrollTo().performTextReplacement("http://example.invalid")
        ui.onNodeWithText("保存并连接").performScrollTo().performClick()
        ui.onNodeWithTag("connectionFormError").assertTextEquals("公网地址必须是 HTTPS 地址")
        field("connectionPublicUrl").performScrollTo().performTextReplacement("")
        ui.onNodeWithText("保存并连接").performScrollTo().performClick()
        ui.onNodeWithTag("connectionCertificate").assertDoesNotExist()
        ui.waitUntil(15000){vm.state.connected}
        ui.runOnIdle{Assert.assertEquals(originalAddress,vm.state.address);Assert.assertEquals("retained-draft",ConnectionStore(application).remotePassword())}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("连接电脑",useUnmergedTree=true).performScrollTo().performClick()
        field("connectionPassword").assert(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsProperties.Password))
        ui.onNodeWithText("显示密码").assertExists()
        java.io.File(application.getExternalFilesDir(null),"connection-fields-223.png").outputStream().use{ui.onNodeWithTag("sheetPanel").captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
    @Test fun terminalSessionsAndEarlyOutputStayWithTheirProject(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val starts=CopyOnWriteArrayList<String>()
        val inputs=CopyOnWriteArrayList<Pair<String,String>>()
        fun output(id:String,text:String){liveSocket.get().send(org.json.JSONObject().put("type","terminal.output").put("threadId","terminal:$id").put("commandId",id).put("text",text).put("status","running").toString())}
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path.endsWith("/terminal/session")){
                val project=path.split('/')[3];starts.add(project)
                if(project=="first"){output("session-first","first startup\n");entered.countDown();release.await(10,java.util.concurrent.TimeUnit.SECONDS)}
                return MockResponse().setBody("""{"sessionId":"session-$project","threadId":"terminal:session-$project"}""")
            }
            if(path.endsWith("/input")){
                val session=path.split('/')[4];val text=org.json.JSONObject(request.body.readUtf8()).getString("text")
                inputs.add(session to text);output(session,"$text output\n")
                return MockResponse().setBody("{}")
            }
            return original.dispatch(request)
        }}
        val first=Project("first","第一项目","E:/First",true)
        val second=Project("second","第二项目","E:/Second",true)
        try{
            ui.runOnUiThread{vm.newThread(first)}
            ui.onNodeWithContentDescription("会话菜单").performClick()
            ui.onNodeWithText("终端",useUnmergedTree=true).performScrollTo().performClick()
            ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("terminalEditor"))).performTextReplacement("pwd")
            ui.onNodeWithTag("terminalExecute").performClick()
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.terminal();vm.newThread(second);vm.openTerminal();Assert.assertEquals("",vm.state.terminalDraft);vm.editTerminal("second command");vm.terminal()}
            ui.waitUntil(10000){!vm.state.terminalBusy&&vm.state.terminal.contains("second command output")}
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("session-second",vm.state.terminalSession);Assert.assertFalse(vm.state.terminal.contains("first startup"))}
            Assert.assertEquals(listOf("first","second"),starts.toList())
            Assert.assertEquals(listOf("session-second" to "second command","session-first" to "pwd"),inputs.toList())
            ui.runOnUiThread{vm.newThread(first);vm.openTerminal();Assert.assertEquals("session-first",vm.state.terminalSession);Assert.assertTrue(vm.state.terminal.contains("first startup"));vm.editTerminal("again");vm.terminal()}
            ui.waitUntil(10000){!vm.state.terminalBusy&&inputs.size==3}
            Assert.assertEquals(2,starts.size);Assert.assertEquals("session-first" to "again",inputs.last())
        }finally{release.countDown()}
    }
    @Test fun terminalFailureKeepsInputAndLateStopCannotClearAnotherProject(){
        val original=server.dispatcher
        val stopEntered=java.util.concurrent.CountDownLatch(1)
        val releaseStop=java.util.concurrent.CountDownLatch(1)
        val inputs=java.util.concurrent.atomic.AtomicInteger()
        val starts=CopyOnWriteArrayList<String>()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path.endsWith("/terminal/session")){val project=path.split('/')[3];starts.add(project);return MockResponse().setBody("""{"sessionId":"session-$project"}""")}
            if(path.endsWith("/input"))return if(inputs.incrementAndGet()==1)MockResponse().setResponseCode(500).setBody("{\"error\":\"input rejected\"}") else MockResponse().setBody("{}")
            if(path=="/api/terminal/sessions/session-first/stop"){stopEntered.countDown();releaseStop.await(10,java.util.concurrent.TimeUnit.SECONDS);return MockResponse().setResponseCode(500).setBody("{\"error\":\"交互式终端会话不存在或已结束\"}")}
            return original.dispatch(request)
        }}
        val first=Project("first","第一项目","E:/First",true)
        val second=Project("second","第二项目","E:/Second",true)
        try{
            ui.runOnUiThread{vm.newThread(first);vm.openTerminal();vm.editTerminal("keep after failure");vm.terminal()}
            ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("keep after failure",vm.state.terminalDraft);Assert.assertTrue(vm.state.terminalError.isNotBlank())}
            ui.runOnUiThread{vm.terminal()};ui.waitUntil(10000){!vm.state.workBusy&&vm.state.terminalDraft.isEmpty()}
            ui.runOnIdle{Assert.assertEquals("",vm.state.terminalError)}
            Assert.assertEquals(1,starts.size)
            ui.runOnUiThread{vm.stopTerminal()};Assert.assertTrue(stopEntered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.newThread(second);vm.openTerminal();vm.editTerminal("second");vm.terminal()}
            ui.waitUntil(10000){!vm.state.terminalBusy&&vm.state.terminalSession=="session-second"}
            releaseStop.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("session-second",vm.state.terminalSession)}
            ui.runOnUiThread{vm.newThread(first);vm.openTerminal();Assert.assertEquals("",vm.state.terminalSession);Assert.assertEquals("",vm.state.terminalError)}
        }finally{releaseStop.countDown()}
    }
    @Test fun failedToolReadDoesNotClearPendingMessageSubmission(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val socket=java.util.concurrent.atomic.AtomicReference<okhttp3.WebSocket>()
        val command=java.util.concurrent.atomic.AtomicReference<org.json.JSONObject>()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/api/projects/first/diff"){
                entered.countDown();release.await(10,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setResponseCode(500).setBody("{\"error\":\"改动读取失败\"}")
            }
            return original.dispatch(request)
        }}
        wireReply={ws,text->val value=org.json.JSONObject(text);if(value.optString("type")=="thread.start"){socket.set(ws);command.set(value)}}
        try{
            ui.runOnUiThread{vm.newThread(Project("first","第一项目","E:/First",true));vm.diff()}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.draft("正在发送的消息");vm.send()}
            ui.waitUntil(5000){command.get()!=null}
            release.countDown();ui.waitUntil(5000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertTrue(vm.state.error.isNotBlank());Assert.assertTrue(vm.state.sending)}
            socket.get().send(org.json.JSONObject().put("type","command.accepted").put("threadId","t").put("requestId",command.get().getString("requestId")).toString())
            ui.waitUntil(5000){!vm.state.sending}
        }finally{release.countDown()}
    }
    @Test fun oldDiffResponseCannotReplaceTheSelectedProject(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            when(request.requestUrl!!.encodedPath){
                "/api/projects/first/diff"->{entered.countDown();release.await(10,java.util.concurrent.TimeUnit.SECONDS);return MockResponse().setBody("""{"diff":"旧项目改动","stat":""}""")}
                "/api/projects/second/diff"->return MockResponse().setBody("""{"diff":"当前项目改动","stat":""}""")
            }
            return original.dispatch(request)
        }}
        try{
            ui.runOnUiThread{vm.newThread(Project("first","第一项目","E:/First",true));vm.diff()}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.newThread(Project("second","第二项目","E:/Second",true));Assert.assertEquals("",vm.state.diff);vm.diff()}
            ui.waitUntil(10000){vm.state.diff=="当前项目改动"}
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("second",vm.state.projectId);Assert.assertEquals("当前项目改动",vm.state.diff)}
        }finally{release.countDown()}
    }
    @Test fun fileEditorKeepsDraftAcrossPanelCloseAndEditsDuringSave(){
        val original=server.dispatcher
        val content=java.util.concurrent.atomic.AtomicReference("原始内容")
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val writes=java.util.concurrent.atomic.AtomicInteger()
        val project="""{"id":"files","name":"文件项目","path":"E:/Fixture","trusted":true}"""
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/projects")return MockResponse().setBody(if(request.method=="POST")"""{"project":$project}""" else """{"projects":[$project]}""")
            if(path=="/api/sidebar")return MockResponse().setBody("""{"projects":[$project],"allowedProjects":[$project]}""")
            if(path=="/api/projects/files/files")return MockResponse().setBody("""{"files":[{"name":"notes.txt","path":"notes.txt","kind":"file"}]}""")
            if(path=="/api/projects/files/file"){
                if(request.method=="PUT"){
                    val submitted=org.json.JSONObject(request.body.readUtf8()).getString("content")
                    if(writes.incrementAndGet()==1){entered.countDown();release.await(10,java.util.concurrent.TimeUnit.SECONDS)}
                    content.set(submitted);return MockResponse().setBody("{\"ok\":true}")
                }
                return MockResponse().setBody(org.json.JSONObject().put("content",content.get()).put("encoding","utf8").toString())
            }
            return original.dispatch(request)
        }}
        fun openEditor(){
            ui.onNodeWithContentDescription("会话菜单").performClick()
            ui.onNodeWithText("文件",useUnmergedTree=true).performScrollTo().performClick()
            ui.waitUntil(10000){!vm.state.fileBusy&&vm.state.files.isNotEmpty()}
            ui.onNodeWithText("notes.txt").performClick()
            ui.waitUntil(10000){!vm.state.fileBusy&&vm.state.file?.path=="notes.txt"}
        }
        fun editor()=ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("fileEditor")))
        try{
            ui.runOnUiThread{vm.newThread();vm.selectNewProject(Project("files","文件项目","E:/Fixture",true))}
            ui.waitUntil(10000){vm.state.projectId=="files"&&!vm.state.workBusy}
            openEditor();ui.onNodeWithTag("fileSaveButton").assertIsNotEnabled()
            editor().performTextReplacement("第一次修改")
            ui.onNodeWithTag("fileSaveButton").assertIsEnabled()
            ui.onNodeWithContentDescription("关闭").performClick();ui.waitForIdle()
            openEditor();editor().assertTextEquals("第一次修改")
            ui.onNodeWithTag("fileSaveButton").performClick()
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.hideFileFeedback()}
            editor().performTextReplacement("保存期间的新修改")
            release.countDown();ui.waitUntil(10000){!vm.state.fileBusy}
            Assert.assertEquals("第一次修改",content.get())
            editor().assertTextEquals("保存期间的新修改")
            ui.onNodeWithTag("fileSaveState").assertTextEquals("有未保存的修改")
            ui.onNodeWithTag("fileSaveButton").performClick()
            ui.waitUntil(10000){!vm.state.fileBusy&&content.get()=="保存期间的新修改"}
            ui.onNodeWithTag("fileSaveButton").assertIsNotEnabled()
            ui.onNodeWithTag("fileSaveState").assertTextEquals("内容已保存")
            java.io.File(application.getExternalFilesDir(null),"file-editor-207.png").outputStream().use{ui.onNodeWithTag("sheetPanel").captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        }finally{release.countDown()}
    }
    @Test fun queueAcknowledgementClearsOriginalDraftAfterNavigation(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/uploads/files")return MockResponse().setBody("""{"id":"queued-file","name":"queued.txt","mime":"text/plain","size":5}""")
            if(path=="/api/threads/t/events")return MockResponse().setBody("""{"status":"running","events":[]}""")
            if(path=="/api/threads/other/events")return MockResponse().setBody("""{"status":"idle","events":[]}""")
            if(path=="/api/threads/t/queue"&&request.method=="POST"){
                val message=org.json.JSONObject(request.body.readUtf8()).put("status","queued")
                entered.countDown();release.await(10,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody(org.json.JSONObject().put("message",message).toString())
            }
            return original.dispatch(request)
        }}
        val first=ThreadRecord(id="t",title="第一会话")
        val second=ThreadRecord(id="other",title="第二会话")
        val file=java.io.File(application.cacheDir,"queued.txt").apply{writeText("queue")}
        try{
            ui.runOnUiThread{vm.openThread(first);vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
            ui.waitUntil(10000){vm.state.running&&!vm.state.uploading&&vm.state.uploads.size==1}
            ui.runOnUiThread{vm.draft("已提交的待发消息");vm.send()}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.openThread(second);vm.draft("另一会话的新草稿")}
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnUiThread{
                Assert.assertEquals("另一会话的新草稿",vm.state.draft)
                vm.openThread(first);Assert.assertEquals("",vm.state.draft);Assert.assertTrue(vm.state.uploads.isEmpty())
                vm.openThread(second);Assert.assertEquals("另一会话的新草稿",vm.state.draft)
            }
        }finally{release.countDown()}
    }
    @Test fun oldComputerWorkDoesNotDisableNewQuestion()=questionWhileOldWorkPending(true)
    @Test fun oldConversationWorkDoesNotDisableNewQuestion()=questionWhileOldWorkPending(false)
    private fun questionWhileOldWorkPending(otherComputer:Boolean){
        val original=server.dispatcher
        val oldEntered=java.util.concurrent.CountDownLatch(1)
        val oldRelease=java.util.concurrent.CountDownLatch(1)
        val newEntered=java.util.concurrent.CountDownLatch(1)
        val newRelease=java.util.concurrent.CountDownLatch(1)
        val answered=java.util.concurrent.atomic.AtomicBoolean(false)
        val detail="""{"questions":[{"id":"choice","question":"新会话可以操作吗？"}]}"""
        val operationDispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/approvals/old-work/resolve"){
                oldEntered.countDown();oldRelease.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("{}")
            }
            if(path=="/api/approvals/new-question/answer"){
                newEntered.countDown();newRelease.await(15,java.util.concurrent.TimeUnit.SECONDS)
                answered.set(true);return MockResponse().setBody("{}")
            }
            if(path=="/api/approvals")return MockResponse().setBody(org.json.JSONObject().put("approvals",org.json.JSONArray().apply{
                if(request.requestUrl!!.queryParameter("threadId")=="other"&&!answered.get())put(org.json.JSONObject().put("id","new-question").put("threadId","other").put("status","pending").put("approvalType","question").put("detail",detail))
            }).toString())
            if(path=="/api/threads/other/events")return MockResponse().setBody("""{"status":"idle","events":[]}""")
            return original.dispatch(request)
        }}
        server.dispatcher=operationDispatcher
        val second=MockWebServer().apply{this.dispatcher=operationDispatcher;start()}
        val address=second.url("/").toString().trimEnd('/')
        lateinit var oldJob:kotlinx.coroutines.Job
        try{
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"));oldJob=vm.approve("old-work",false)!!}
            Assert.assertTrue(oldEntered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnIdle{Assert.assertTrue(vm.currentWorkBusy())}
            if(otherComputer){
                ui.runOnUiThread{vm.connect(address,"fixture")}
                ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==address}
            }
            ui.runOnUiThread{vm.openThread(ThreadRecord("other"))}
            ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.pendingApprovals.isNotEmpty()}
            ui.runOnIdle{Assert.assertTrue(vm.state.workBusy);Assert.assertFalse(vm.currentWorkBusy())}
            ui.onNodeWithTag("questionAnswer:choice").performTextReplacement("可以继续")
            ui.onNodeWithText("提交回答").assertIsEnabled().performClick()
            Assert.assertTrue(newEntered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.onNodeWithText("提交回答").assertIsNotEnabled()
            oldRelease.countDown();ui.waitUntil(10000){oldJob.isCompleted}
            ui.runOnIdle{Assert.assertTrue(vm.currentWorkBusy())}
            ui.onNodeWithText("提交回答").assertIsNotEnabled()
            newRelease.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertFalse(vm.currentWorkBusy());Assert.assertTrue("new-question" in vm.state.approvals)}
        }finally{oldRelease.countDown();newRelease.countDown();ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun compactFailureStaysWithOriginalComputer()=backgroundOperationAfterComputerSwitch("compact")
    @Test fun continueGoalFailureStaysWithOriginalComputer()=backgroundOperationAfterComputerSwitch("continue")
    @Test fun automationFailureStaysWithOriginalComputer()=backgroundOperationAfterComputerSwitch("automation")
    @Test fun snapshotImportDoesNotCloseNewComputerPage()=backgroundOperationAfterComputerSwitch("import")
    private fun backgroundOperationAfterComputerSwitch(operation:String){
        val original=server.dispatcher
        val endpoint=when(operation){"compact"->"/api/threads/t/compact";"continue"->"/api/threads/t/goal/continue";"automation"->"/api/automations";else->"/api/cloud-snapshots/import"}
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val done=java.util.concurrent.atomic.AtomicInteger(0)
        val health="""{"ok":true,"protocolVersion":1,"minAndroidProtocolVersion":1,"capabilities":["local-thread-output-files","new-thread-goals","cloud-snapshot-readonly"]}"""
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/health")return MockResponse().setBody(health)
            if(request.requestUrl!!.encodedPath==endpoint&&request.method=="POST"){
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return if(operation=="import")MockResponse().setBody("{}") else MockResponse().setResponseCode(500).setBody("old $operation failure")
            }
            return original.dispatch(request)
        }}
        val newCalls=CopyOnWriteArrayList<String>()
        val second=MockWebServer().apply{dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.method=="POST")newCalls.add(request.requestUrl!!.encodedPath)
            return original.dispatch(request)
        }};start()}
        val firstAddress=server.url("/").toString().trimEnd('/')
        val secondAddress=second.url("/").toString().trimEnd('/')
        try{
            ui.runOnUiThread{vm.connect(firstAddress,"fixture")}
            ui.waitUntil(15000){vm.state.connected&&"cloud-snapshot-readonly" in vm.state.capabilities}
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
            ui.waitUntil(10000){!vm.state.loadingHistory}
            ui.runOnUiThread{when(operation){
                "compact"->vm.compactContext()
                "continue"->vm.continueGoal("t")
                "automation"->vm.saveAutomation(null,org.json.JSONObject().put("name","测试自动化")){done.incrementAndGet()}
                else->vm.importCloudSnapshot("{} "){done.incrementAndGet()}
            }}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.connect(secondAddress,"fixture")}
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==secondAddress}
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"));vm.draft("新电脑继续输入")}
            ui.waitUntil(10000){!vm.state.loadingHistory}
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("",vm.state.error);Assert.assertEquals("新电脑继续输入",vm.state.draft);Assert.assertEquals(secondAddress,vm.state.address)}
            Assert.assertEquals(0,done.get());Assert.assertTrue(newCalls.isEmpty())
        }finally{release.countDown();ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun olderCodexStatusCannotOverwriteCompletedStart(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/api/codex/status"){
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("""{"codex":{"initialized":false}}""")
            }
            if(request.requestUrl!!.encodedPath=="/api/codex/start")return MockResponse().setBody("""{"codex":{"initialized":true}}""")
            return original.dispatch(request)
        }}
        lateinit var read:kotlinx.coroutines.Job
        lateinit var start:kotlinx.coroutines.Job
        try{
            ui.runOnUiThread{read=vm.refreshCodex()!!}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{Assert.assertTrue(vm.state.codexStatusLoading);start=vm.startDesktopCodex()!!}
            ui.waitUntil(10000){start.isCompleted}
            ui.runOnIdle{Assert.assertTrue(vm.state.codexReady);Assert.assertFalse(vm.state.codexStarting)}
            release.countDown();ui.waitUntil(10000){read.isCompleted}
            ui.runOnIdle{Assert.assertTrue(vm.state.codexReady);Assert.assertFalse(vm.state.codexStatusLoading)}
        }finally{release.countDown()}
    }
    @Test fun oldCodexStartDoesNotChangeNewComputerAndStatusCanRetry(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/api/codex/start"){
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("""{"codex":{"initialized":true}}""")
            }
            return original.dispatch(request)
        }}
        val fail=java.util.concurrent.atomic.AtomicBoolean(true)
        val second=MockWebServer().apply{dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/api/codex/status")return if(fail.get())MockResponse().setResponseCode(500).setBody("status temporarily unavailable") else MockResponse().setBody("""{"codex":{"initialized":false}}""")
            return original.dispatch(request)
        }};start()}
        val address=second.url("/").toString().trimEnd('/')
        lateinit var start:kotlinx.coroutines.Job
        try{
            ui.runOnUiThread{start=vm.startDesktopCodex()!!}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.connect(address,"fixture")}
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==address}
            ui.runOnIdle{Assert.assertFalse(vm.state.codexReady);Assert.assertFalse(vm.state.codexStarting)}
            ui.onNodeWithTag("connectionStatus").performClick()
            ui.waitUntil(10000){!vm.state.codexStatusLoading&&vm.state.codexStatusError.isNotBlank()}
            ui.onNodeWithTag("codexConnectionStatus").assertTextContains("无法检查 Codex",substring=true)
            fail.set(false)
            ui.onNodeWithText("重新检查").performClick()
            ui.waitUntil(10000){!vm.state.codexStatusLoading&&vm.state.codexStatusError.isBlank()}
            ui.onNodeWithTag("codexConnectionStatus").assertTextContains("Codex 未连接",substring=true)
            release.countDown();ui.waitUntil(10000){start.isCompleted}
            ui.runOnIdle{Assert.assertFalse(vm.state.codexReady);Assert.assertFalse(vm.state.codexStarting);Assert.assertEquals("",vm.state.codexStatusError)}
        }finally{release.countDown();ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun turnCompletionKeepsQueueSubmissionBusy()=completionDuringHttpSubmission(false)
    @Test fun turnCompletionKeepsGoalSubmissionBusy()=completionDuringHttpSubmission(true)
    private fun completionDuringHttpSubmission(goal:Boolean){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val completed=java.util.concurrent.atomic.AtomicBoolean(false)
        val submissions=java.util.concurrent.atomic.AtomicInteger(0)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/threads/t/events")return MockResponse().setBody(org.json.JSONObject().put("status",if(completed.get())"idle" else "running").put("events",org.json.JSONArray()).toString())
            if(path=="/api/threads/t/${if(goal)"goal" else "queue"}"&&request.method==if(goal)"PATCH" else "POST"){
                val body=org.json.JSONObject(request.body.readUtf8())
                submissions.incrementAndGet();entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return if(goal)MockResponse().setBody("""{"goal":{"goalId":"g","objective":"提交期间完成旧任务","status":"active"}}""")
                    else MockResponse().setBody(org.json.JSONObject().put("message",body.put("status","queued")).toString())
            }
            return original.dispatch(request)
        }}
        try{
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
            ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.running}
            ui.runOnUiThread{vm.draft(if(goal)"/goal 提交期间完成旧任务" else "下一步消息");vm.send()}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            completed.set(true)
            liveSocket.get().send("""{"type":"turn.completed","threadId":"t","eventId":"complete-during-http"}""")
            ui.waitUntil(10000){!vm.state.running}
            ui.runOnIdle{Assert.assertTrue("任务完成不等于提交请求已完成",vm.state.sending);vm.send()}
            Assert.assertEquals(1,submissions.get())
            Assert.assertTrue(wireMessages.none{it.contains("turn.start")||it.contains("thread.start")})
            release.countDown()
            ui.waitUntil(10000){!vm.state.sending&&!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("",vm.state.draft)}
        }finally{release.countDown()}
    }
    @Test fun questionDraftSurvivesDismissalAndStaysWithComputer(){
        val original=server.dispatcher
        val failed=java.util.concurrent.atomic.AtomicBoolean(false)
        val answered=java.util.concurrent.atomic.AtomicBoolean(false)
        val detail="""{"questions":[{"id":"choice","question":"保留这次回答吗？"}]}"""
        fun dispatcher(first:Boolean)=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/approvals")return MockResponse().setBody(org.json.JSONObject().put("approvals",org.json.JSONArray().apply{
                if(!first||!answered.get())put(org.json.JSONObject().put("id","draft-question").put("threadId","t").put("status","pending").put("approvalType","question").put("detail",detail))
            }).toString())
            if(path=="/api/approvals/draft-question/answer"){
                if(!failed.getAndSet(true))return MockResponse().setResponseCode(500).setBody("temporary answer failure")
                answered.set(true);return MockResponse().setBody("{}")
            }
            return original.dispatch(request)
        }}
        server.dispatcher=dispatcher(true)
        val second=MockWebServer().apply{dispatcher=dispatcher(false);start()}
        val firstAddress=server.url("/").toString().trimEnd('/')
        val secondAddress=second.url("/").toString().trimEnd('/')
        fun connect(address:String){
            ui.runOnUiThread{vm.connect(address,"fixture")}
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==address}
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
            ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.pendingApprovals.isNotEmpty()}
        }
        try{
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
            ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.pendingApprovals.isNotEmpty()}
            ui.onNodeWithTag("questionAnswer:choice").performTextReplacement("电脑 A 尚未提交的回答")
            ui.onNodeWithContentDescription("关闭").performClick()
            ui.onNodeWithTag("questionAnswer:choice").assertDoesNotExist()
            ui.onNodeWithText("保留这次回答吗？").performScrollTo().performClick()
            ui.onNodeWithTag("questionAnswer:choice").assertTextEquals("电脑 A 尚未提交的回答")
            connect(secondAddress)
            ui.onNodeWithTag("questionAnswer:choice").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText,androidx.compose.ui.text.AnnotatedString("")))
            ui.onNodeWithTag("questionAnswer:choice").performTextReplacement("电脑 B 的回答")
            connect(firstAddress)
            ui.onNodeWithTag("questionAnswer:choice").assertTextEquals("电脑 A 尚未提交的回答")
            val firstKey=vm.questionDraftKey("t","draft-question")
            ui.onNodeWithText("提交回答").performClick()
            ui.waitUntil(10000){!vm.state.workBusy&&vm.state.error.isNotBlank()}
            ui.onNodeWithTag("questionAnswer:choice").assertTextEquals("电脑 A 尚未提交的回答")
            ui.onNodeWithText("提交回答").performClick()
            ui.waitUntil(10000){!vm.state.workBusy&&"draft-question" in vm.state.approvals}
            ui.runOnIdle{Assert.assertTrue(vm.questionDraft(firstKey).isEmpty())}
            connect(secondAddress)
            ui.onNodeWithTag("questionAnswer:choice").assertTextEquals("电脑 B 的回答")
        }finally{ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun approvalRepliesRemainWithOriginalComputer(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(2)
        val release=java.util.concurrent.CountDownLatch(1)
        val oldAnswers=CopyOnWriteArrayList<String>()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/approvals/confirmed-before/resolve")return MockResponse().setBody("{}")
            if(path=="/api/approvals/shared-confirm/resolve"||path=="/api/approvals/shared-question/answer"){
                if(path.endsWith("/answer"))oldAnswers.add(request.body.readUtf8())
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("{}")
            }
            return original.dispatch(request)
        }}
        val handled=CopyOnWriteArrayList<String>()
        val second=MockWebServer().apply{dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/approvals")return MockResponse().setBody(org.json.JSONObject().put("approvals",org.json.JSONArray().apply{
                listOf("shared-confirm","shared-question").filter{it !in handled}.forEach{id->put(org.json.JSONObject().put("id",id).put("threadId","t").put("status","pending").put("approvalType",if(id.endsWith("question"))"question" else "command").put("title","第二台电脑请求"))}
            }).toString())
            if(path.startsWith("/api/approvals/")&&request.method=="POST"){
                handled.add(path.split('/')[3]);return MockResponse().setBody("{}")
            }
            return original.dispatch(request)
        }};start()}
        val secondAddress=second.url("/").toString().trimEnd('/')
        try{
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"));vm.approve("confirmed-before",true)}
            ui.waitUntil(10000){!vm.state.workBusy&&"confirmed-before" in vm.state.approvals}
            ui.runOnUiThread{vm.approve("shared-confirm",true);vm.answerQuestions("shared-question",mapOf("choice" to "原电脑回答"))}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.connect(secondAddress,"fixture")}
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==secondAddress}
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
            ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.pendingApprovals.size==2}
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertTrue(vm.state.approvalResults.isEmpty());Assert.assertTrue(vm.state.approvals.isEmpty());Assert.assertEquals(2,vm.state.pendingApprovals.size)}
            Assert.assertTrue(handled.isEmpty())
            Assert.assertEquals("t",org.json.JSONObject(oldAnswers.single()).getString("threadId"))
            Assert.assertEquals("原电脑回答",org.json.JSONObject(oldAnswers.single()).getJSONObject("answers").getJSONObject("choice").getJSONArray("answers").getString(0))
            ui.runOnUiThread{vm.approve("shared-confirm",false);vm.answerQuestions("shared-question",mapOf("choice" to "新电脑回答"))}
            ui.waitUntil(10000){!vm.state.workBusy&&vm.state.pendingApprovals.isEmpty()}
            ui.runOnIdle{Assert.assertEquals("declined",vm.state.approvalResults[nativeApprovalKey("t","shared-confirm")]);Assert.assertEquals("answered",vm.state.approvalResults[nativeApprovalKey("t","shared-question")])}
            Assert.assertEquals(setOf("shared-confirm","shared-question"),handled.toSet())
        }finally{release.countDown();ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun sidebarMutationsDoNotChangeAnotherComputer(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(2)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/threads/t"&&request.method=="PATCH"){
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("""{"thread":{"id":"t","title":"原电脑重命名"}}""")
            }
            if(path=="/api/threads/t/pin"){
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("{}")
            }
            return original.dispatch(request)
        }}
        val second=MockWebServer().apply{dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val response=original.dispatch(request)
            return if(request.requestUrl!!.encodedPath=="/api/threads")response.setHeadersDelay(200,java.util.concurrent.TimeUnit.MILLISECONDS) else response
        }};start()}
        val observed=CopyOnWriteArrayList<Pair<String,Int>>()
        var observer:kotlinx.coroutines.Job?=null
        val secondAddress=second.url("/").toString().trimEnd('/')
        try{
            ui.runOnUiThread{val thread=vm.state.threads.first();vm.renameThread(thread,"原电脑重命名");vm.pinThread(thread,true)}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.connect(secondAddress,"fixture")}
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==secondAddress&&vm.state.threads.any{it.id=="t"}}
            val title=vm.state.threads.first{it.id=="t"}.title
            val pinned=vm.state.threads.first{it.id=="t"}.pinnedIndex
            ui.runOnUiThread{observer=kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main.immediate).launch{
                androidx.compose.runtime.snapshotFlow{vm.state.threads.firstOrNull{it.id=="t"}?.let{it.title to it.pinnedIndex}}.collect{value->if(value!=null)observed.add(value)}
            }}
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals(title,vm.state.threads.first{it.id=="t"}.title);Assert.assertEquals(pinned,vm.state.threads.first{it.id=="t"}.pinnedIndex)}
            Assert.assertTrue("其他电脑的会话信息不能被旧回包短暂覆盖",observed.isNotEmpty()&&observed.all{it==title to pinned})
            Assert.assertTrue((0 until second.requestCount).mapNotNull{second.takeRequest(1,java.util.concurrent.TimeUnit.SECONDS)}.none{it.method=="PATCH"||it.requestUrl!!.encodedPath.endsWith("/pin")})
        }finally{release.countDown();observer?.cancel();ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun delayedProjectStartKeepsNewlySelectedConversation(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/api/projects"&&request.method=="POST"){
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("""{"project":{"id":"added","name":"慢项目","path":"E:/Slow","trusted":true}}""")
            }
            if(request.requestUrl!!.encodedPath=="/api/threads/other/events")return MockResponse().setBody("""{"status":"idle","events":[]}""")
            return original.dispatch(request)
        }}
        try{
            ui.runOnUiThread{vm.startInProject(Project("slow","慢项目","E:/Slow",true))}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.openThread(ThreadRecord("other"));vm.draft("继续当前会话")}
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("other",vm.state.threadId);Assert.assertEquals("继续当前会话",vm.state.draft)}
            // A normal subsequent start still selects the requested project.
            ui.runOnUiThread{vm.startInProject(Project("added","慢项目","E:/Slow",true))}
            ui.waitUntil(10000){!vm.state.workBusy&&vm.state.threadId.isBlank()&&vm.state.projectId=="added"}
        }finally{release.countDown()}
    }
    @Test fun goalReplyClearsOriginalDraftAfterComputerSwitch()=goalReplyAfterReconnect(true)
    @Test fun goalReplyClearsCurrentDraftAfterReconnect()=goalReplyAfterReconnect(false)
    private fun goalReplyAfterReconnect(otherComputer:Boolean){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/api/threads/t/goal"&&request.method=="PATCH"){
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("""{"goal":{"goalId":"saved-goal","objective":"保留目标归属","status":"active"}}""")
            }
            return original.dispatch(request)
        }}
        val second=MockWebServer().apply{dispatcher=original;start()}
        val firstAddress=server.url("/").toString().trimEnd('/')
        val secondAddress=second.url("/").toString().trimEnd('/')
        val thread=ThreadRecord("t")
        fun connect(address:String){
            ui.runOnUiThread{vm.connect(address,"fixture")}
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==address}
            ui.runOnUiThread{vm.openThread(thread)}
            ui.waitUntil(10000){!vm.state.loadingHistory}
        }
        try{
            ui.runOnUiThread{vm.openThread(thread)}
            ui.waitUntil(10000){!vm.state.loadingHistory}
            ui.runOnUiThread{vm.draft("/goal 保留目标归属");vm.send()}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            connect(if(otherComputer)secondAddress else firstAddress)
            ui.runOnUiThread{
                if(otherComputer)vm.draft("另一电脑的新草稿")
                else Assert.assertEquals("/goal 保留目标归属",vm.state.draft)
            }
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals(if(otherComputer)"另一电脑的新草稿" else "",vm.state.draft);Assert.assertFalse(vm.state.sending)}
            if(otherComputer){
                connect(firstAddress)
                ui.runOnIdle{Assert.assertEquals("",vm.state.draft)}
                connect(secondAddress)
                ui.runOnIdle{Assert.assertEquals("另一电脑的新草稿",vm.state.draft)}
            }
        }finally{release.countDown();ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun oldQueueReplyDoesNotUnlockNewGoalSubmission(){
        val original=server.dispatcher
        val queueEntered=java.util.concurrent.CountDownLatch(1)
        val queueRelease=java.util.concurrent.CountDownLatch(1)
        val goalEntered=java.util.concurrent.CountDownLatch(1)
        val goalRelease=java.util.concurrent.CountDownLatch(1)
        val goalRequests=java.util.concurrent.atomic.AtomicInteger(0)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/threads/t/events")return MockResponse().setBody("""{"status":"running","events":[]}""")
            if(path=="/api/threads/other/events")return MockResponse().setBody("""{"status":"idle","events":[]}""")
            if(path=="/api/threads/t/queue"&&request.method=="POST"){
                val message=org.json.JSONObject(request.body.readUtf8()).put("status","queued")
                queueEntered.countDown();queueRelease.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody(org.json.JSONObject().put("message",message).toString())
            }
            if(path=="/api/threads/other/goal"&&request.method=="PATCH"){
                goalRequests.incrementAndGet();goalEntered.countDown();goalRelease.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("""{"goal":{"goalId":"new-goal","objective":"继续新任务","status":"active"}}""")
            }
            return original.dispatch(request)
        }}
        try{
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
            ui.waitUntil(10000){vm.state.running&&!vm.state.loadingHistory}
            val oldScope=org.json.JSONArray(listOf(vm.state.address,"","native:t")).toString()
            ui.runOnUiThread{vm.draft("原会话入队");vm.send()}
            Assert.assertTrue(queueEntered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.openThread(ThreadRecord("other"))}
            ui.waitUntil(10000){!vm.state.loadingHistory}
            ui.runOnUiThread{vm.draft("/goal 继续新任务");vm.send()}
            Assert.assertTrue(goalEntered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            queueRelease.countDown()
            ui.waitUntil(10000){ConnectionStore(application).chatDraft(oldScope).isEmpty()}
            // Keep the new request blocked while observing the older completion.
            repeat(10){
                Thread.sleep(50)
                ui.runOnIdle{Assert.assertTrue("旧入队回包不能解除新目标提交状态",vm.state.sending);vm.send()}
            }
            Assert.assertEquals(1,goalRequests.get())
            goalRelease.countDown()
            ui.waitUntil(10000){!vm.state.sending&&!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("",vm.state.draft)}
        }finally{queueRelease.countDown();goalRelease.countDown()}
    }
    @Test fun queuedSuccessClearsOnlyOriginalComputerDraft()=queueReplyAfterComputerSwitch(true)
    @Test fun queuedFailurePreservesOriginalComputerDraft()=queueReplyAfterComputerSwitch(false)
    private fun queueReplyAfterComputerSwitch(accepted:Boolean){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/uploads/files")return MockResponse().setBody("""{"id":"old-file","name":"old.txt","mime":"text/plain","size":3}""")
            if(path=="/api/threads/t/events")return MockResponse().setBody("""{"status":"running","events":[]}""")
            if(path=="/api/threads/t/queue"&&request.method=="POST"){
                val message=org.json.JSONObject(request.body.readUtf8()).put("status","queued")
                entered.countDown();release.await(15,java.util.concurrent.TimeUnit.SECONDS)
                return if(accepted)MockResponse().setBody(org.json.JSONObject().put("message",message).toString()) else MockResponse().setResponseCode(500).setBody("old enqueue failure")
            }
            return original.dispatch(request)
        }}
        val second=MockWebServer().apply{dispatcher=original;start()}
        val firstAddress=server.url("/").toString().trimEnd('/')
        val secondAddress=second.url("/").toString().trimEnd('/')
        val thread=ThreadRecord("t",title="相同会话 ID")
        val file=java.io.File(application.cacheDir,"old.txt").apply{writeText("old")}
        fun connect(address:String){
            ui.runOnUiThread{vm.connect(address,"fixture")}
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==address}
            ui.runOnUiThread{vm.openThread(thread)}
            ui.waitUntil(10000){!vm.state.loadingHistory}
        }
        try{
            ui.runOnUiThread{vm.openThread(thread);vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
            ui.waitUntil(10000){vm.state.running&&!vm.state.uploading&&vm.state.uploads.size==1}
            ui.runOnUiThread{vm.draft("原电脑待发内容");vm.send()}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            connect(secondAddress)
            ui.runOnUiThread{vm.draft("新电脑草稿")}
            release.countDown();ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("",vm.state.error);Assert.assertEquals("新电脑草稿",vm.state.draft);Assert.assertTrue(vm.state.uploads.isEmpty())}
            connect(firstAddress)
            ui.runOnIdle{
                Assert.assertEquals(if(accepted)"" else "原电脑待发内容",vm.state.draft)
                Assert.assertEquals(if(accepted)emptyList<String>() else listOf("old-file"),vm.state.uploads.map{it.id})
            }
            connect(secondAddress)
            ui.runOnIdle{Assert.assertEquals("新电脑草稿",vm.state.draft)}
        }finally{release.countDown();ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun queueMutationFeedbackStaysWithOriginatingConversation(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val edited=java.util.concurrent.atomic.AtomicBoolean(false)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/threads/t/queue/old"&&request.method=="DELETE"){
                entered.countDown();release.await(10,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setResponseCode(500).setBody("old queue failure")
            }
            if(path=="/api/threads/other/queue/current"&&request.method=="PATCH"){
                Assert.assertEquals("修改后的队列消息",org.json.JSONObject(request.body.readUtf8()).getString("text"))
                edited.set(true);return MockResponse().setBody("{}")
            }
            if(path=="/api/threads/other/queue")return MockResponse().setBody(if(edited.get())"""{"canSteer":false,"messages":[{"id":"current","text":"修改后的队列消息","status":"queued"}]}""" else """{"canSteer":false,"messages":[]}""")
            if(path=="/api/threads/other/events")return MockResponse().setBody("""{"status":"idle","hasMore":false,"events":[]}""")
            return original.dispatch(request)
        }}
        try{
            ui.runOnUiThread{vm.openThread(vm.state.threads.first{it.id=="t"})}
            ui.waitUntil(10000){!vm.state.loadingHistory}
            ui.runOnUiThread{vm.queueAction(NativeQueued("old","旧队列消息","queued","",false),"delete")}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.openThread(ThreadRecord("other","新会话"));vm.draft("新会话草稿")}
            ui.waitUntil(10000){!vm.state.loadingHistory}
            release.countDown()
            ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("",vm.state.error);Assert.assertEquals("新会话草稿",vm.state.draft);Assert.assertEquals("other",vm.state.threadId)}
            ui.runOnUiThread{vm.queueAction(NativeQueued("current","原队列消息","queued","",false),"edit","修改后的队列消息")}
            ui.waitUntil(10000){!vm.state.workBusy&&vm.state.queue.any{it.text=="修改后的队列消息"}}
            ui.runOnIdle{Assert.assertEquals("新会话草稿",vm.state.draft)}
        }finally{release.countDown()}
    }
    @Test fun queuedMessageRestoresOriginalDraftAfterSwitchingConversation(){
        val original=server.dispatcher
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val deletes=java.util.concurrent.atomic.AtomicInteger()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.method=="DELETE"&&request.requestUrl!!.encodedPath=="/api/threads/t/queue/restore-me"){
                deletes.incrementAndGet();entered.countDown();release.await(10,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("{}")
            }
            if(request.requestUrl!!.encodedPath.endsWith("/events"))return MockResponse().setBody("""{"status":"idle","events":[]}""")
            return original.dispatch(request)
        }}
        val first=ThreadRecord(id="t",title="第一会话")
        val second=ThreadRecord(id="other",title="第二会话")
        val item=NativeQueued("restore-me","取回的待发内容","queued","",false,listOf(NativeImage("restored-image","image.png")),listOf(NativeUploadedFile("restored-file","file.txt","text/plain",5)))
        try{
            ui.runOnUiThread{vm.openThread(first);vm.draft("原会话草稿");vm.restoreQueued(item);vm.restoreQueued(item)}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.openThread(second);vm.draft("另一会话草稿")}
            release.countDown()
            ui.waitUntil(10000){!vm.state.workBusy}
            ui.runOnUiThread{
                Assert.assertEquals("other",vm.state.threadId);Assert.assertEquals("另一会话草稿",vm.state.draft)
                Assert.assertTrue(vm.state.images.isEmpty());Assert.assertTrue(vm.state.uploads.isEmpty())
                vm.openThread(first)
                Assert.assertEquals("取回的待发内容\n\n原会话草稿",vm.state.draft)
                Assert.assertEquals(listOf("restored-image"),vm.state.images.map{it.id})
                Assert.assertEquals(listOf("restored-file"),vm.state.uploads.map{it.id})
            }
            Assert.assertEquals(1,deletes.get())
        }finally{release.countDown()}
    }
    @Test fun attachmentDraftsBelongToTheirConversationAndSurviveClientRecreation(){
        val original=server.dispatcher
        val uploads=java.util.concurrent.atomic.AtomicInteger()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/uploads/images")return MockResponse().setBody("""{"id":"draft-image","name":"draft.png"}""")
            if(path=="/api/uploads/files"){
                val index=uploads.incrementAndGet()
                return MockResponse().setBody("""{"id":"draft-file-$index","name":"draft-$index.txt","mime":"text/plain","size":5}""")
            }
            if(path.endsWith("/events"))return MockResponse().setBody("""{"status":"idle","events":[]}""")
            return original.dispatch(request)
        }}
        val file=java.io.File(application.cacheDir,"draft.txt").apply{writeText("draft")}
        val image=java.io.File(application.cacheDir,"draft.png")
        android.graphics.Bitmap.createBitmap(8,8,android.graphics.Bitmap.Config.ARGB_8888).let{bitmap->
            image.outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
        }
        val first=ThreadRecord(id="t",title="第一会话")
        val second=ThreadRecord(id="other",title="第二会话")
        ui.runOnUiThread{vm.openThread(first);vm.draft("第一份草稿");vm.uploadImages(listOf(android.net.Uri.fromFile(image)))}
        ui.waitUntil(10000){!vm.state.uploading&&vm.state.images.size==1}
        ui.runOnUiThread{vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
        ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==1}
        ui.runOnUiThread{
            vm.openThread(second)
            Assert.assertTrue(vm.state.images.isEmpty());Assert.assertTrue(vm.state.uploads.isEmpty())
            vm.draft("第二份草稿");vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))
        }
        ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==1}
        ui.runOnUiThread{
            vm.openThread(first)
            Assert.assertEquals("第一份草稿",vm.state.draft)
            Assert.assertEquals(listOf("draft-image"),vm.state.images.map{it.id})
            Assert.assertEquals(listOf("draft-file-1"),vm.state.uploads.map{it.id})
            vm.newThread();Assert.assertTrue(vm.state.images.isEmpty());Assert.assertTrue(vm.state.uploads.isEmpty())
            vm.openThread(second);Assert.assertEquals("第二份草稿",vm.state.draft)
            Assert.assertEquals(listOf("draft-file-2"),vm.state.uploads.map{it.id})
            vm.removeUpload("draft-file-2");vm.openThread(first);vm.openThread(second);Assert.assertTrue(vm.state.uploads.isEmpty())
            val restored=NativeViewModel(application)
            restored.openThread(first)
            Assert.assertEquals(listOf("draft-image"),restored.state.images.map{it.id})
            Assert.assertEquals(listOf("draft-file-1"),restored.state.uploads.map{it.id})
            restored.disconnect();vm.openThread(first)
        }
        wireReply={socket,text->val command=org.json.JSONObject(text);socket.send(org.json.JSONObject().put("type","command.accepted").put("threadId","t").put("requestId",command.getString("requestId")).toString())}
        ui.runOnUiThread{vm.send()}
        ui.waitUntil(10000){!vm.state.sending&&wireMessages.isNotEmpty()}
        ui.runOnUiThread{vm.openThread(second);vm.openThread(first);Assert.assertTrue(vm.state.images.isEmpty());Assert.assertTrue(vm.state.uploads.isEmpty())}
    }
    @Test fun queueReceiptKeepsMessageVisibleAndRejectsOlderEmptyRefresh(){
        val original=server.dispatcher
        val slowQueue=java.util.concurrent.atomic.AtomicBoolean(false)
        val queueRead=java.util.concurrent.CountDownLatch(1)
        val releaseQueue=java.util.concurrent.CountDownLatch(1)
        val postRead=java.util.concurrent.CountDownLatch(1)
        val secondPostRead=java.util.concurrent.CountDownLatch(1)
        val published=CopyOnWriteArrayList<org.json.JSONObject>()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path.endsWith("/events"))return MockResponse().setBody("""{"status":"running","events":[]}""")
            if(path.endsWith("/queue")&&request.method=="POST"){
                val message=org.json.JSONObject(request.body.readUtf8()).put("status","queued")
                published.add(message);postRead.countDown();if(published.size==2)secondPostRead.countDown()
                return MockResponse().setHeadersDelay(700,java.util.concurrent.TimeUnit.MILLISECONDS).setBody(org.json.JSONObject().put("message",message).toString())
            }
            if(path.endsWith("/queue")&&slowQueue.get()){
                queueRead.countDown();releaseQueue.await(8,java.util.concurrent.TimeUnit.SECONDS)
                return MockResponse().setBody("""{"canSteer":true,"messages":[]}""")
            }
            if(path.endsWith("/queue"))return MockResponse().setBody(org.json.JSONObject().put("canSteer",true).put("messages",org.json.JSONArray(published)).toString())
            return original.dispatch(request)
        }}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.running&&!vm.state.loadingHistory}
        slowQueue.set(true)
        val refresh=kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch { vm.refresh() }
        try{
            Assert.assertTrue(queueRead.await(3,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.draft("弱网时消息保持可见");vm.send()}
            Assert.assertTrue(postRead.await(3,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnIdle{Assert.assertEquals("弱网时消息保持可见",vm.state.draft)}
            ui.waitUntil(5000){!vm.state.sending}
            ui.runOnIdle{Assert.assertEquals("",vm.state.draft);Assert.assertEquals("弱网时消息保持可见",vm.state.queue.single().text)}
            releaseQueue.countDown()
            ui.waitUntil(5000){!refresh.isActive}
            ui.runOnIdle{Assert.assertEquals("弱网时消息保持可见",vm.state.queue.single().text)}
            slowQueue.set(false)
            ui.runOnUiThread{vm.draft("重连期间保留入队回执");vm.send()}
            Assert.assertTrue(secondPostRead.await(3,java.util.concurrent.TimeUnit.SECONDS))
            ui.runOnUiThread{vm.connect(server.url("/").toString().trimEnd('/'),"fixture")}
            ui.waitUntil(5000){vm.state.connected&&!vm.state.sending}
            ui.runOnIdle{Assert.assertEquals("",vm.state.draft);Assert.assertTrue(vm.state.queue.any{it.text=="重连期间保留入队回执"})}
        }finally{releaseQueue.countDown();refresh.cancel()}
    }
    @Test fun failedConnectionKeepsOneCompleteProfileForRetryAndRecreation(){
        val original=server.dispatcher
        val ready=java.util.concurrent.atomic.AtomicBoolean(false)
        val healthReads=java.util.concurrent.atomic.AtomicInteger()
        val second=MockWebServer().apply{dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/health"){
                healthReads.incrementAndGet()
                if(!ready.get())return MockResponse().setResponseCode(503).setBody("not ready")
            }
            return original.dispatch(request)
        }};start()}
        val address=second.url("/").toString().trimEnd('/')
        val certificate="b".repeat(64)
        val store=ConnectionStore(application)
        try{
            ui.runOnUiThread{
                vm.connect(address,"target-token",publicUrl="https://offline.example.invalid",remotePassword="target-password",certificateSha256=certificate,route=ConnectionRoute.LOCAL)
                Assert.assertEquals(address,store.baseUrl());Assert.assertEquals("target-token",store.token())
                Assert.assertEquals(certificate,store.certificateSha256());Assert.assertEquals(ConnectionRoute.LOCAL,store.route())
                Assert.assertEquals("https://offline.example.invalid",store.publicUrl());Assert.assertEquals("target-password",store.remotePassword())
                Assert.assertNull(vm.client)
            }
            ui.waitUntil(10000){healthReads.get()>0&&vm.state.error.contains("503")}
            ui.runOnUiThread{
                val restored=NativeViewModel(application)
                Assert.assertEquals(address,restored.state.address);Assert.assertEquals(certificate,restored.state.certificateSha256)
                Assert.assertEquals(ConnectionRoute.LOCAL,restored.state.route);Assert.assertEquals("target-password",restored.state.remotePassword)
                restored.disconnect();ready.set(true);vm.retryConnect()
            }
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==address}
            Assert.assertEquals(address,store.baseUrl());Assert.assertEquals(certificate,store.certificateSha256())
        }finally{ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun pairingRetryRetainsCodeUntilClaimAndThenUsesOnlyNewToken(){
        val original=server.dispatcher
        val allowPair=java.util.concurrent.atomic.AtomicBoolean(false)
        val healthy=java.util.concurrent.atomic.AtomicBoolean(false)
        val claims=java.util.concurrent.atomic.AtomicInteger()
        val requests=CopyOnWriteArrayList<RecordedRequest>()
        val second=MockWebServer().apply{dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            requests.add(request)
            if(request.requestUrl!!.encodedPath=="/api/pair/claim"){
                claims.incrementAndGet()
                Assert.assertNull(request.getHeader("Authorization"))
                Assert.assertEquals("pair-fixture",org.json.JSONObject(request.body.readUtf8()).getString("code"))
                if(!allowPair.get())return MockResponse().setResponseCode(503).setBody("pair not ready")
                return MockResponse().setBody("""{"token":"claimed-token","device":{"id":"fixture-device","name":"Android"}}""")
            }
            if(request.requestUrl!!.encodedPath=="/health"&&!healthy.get())return MockResponse().setResponseCode(503).setBody("health not ready")
            return original.dispatch(request)
        }};start()}
        val address=second.url("/").toString().trimEnd('/')
        val store=ConnectionStore(application)
        try{
            ui.runOnUiThread{
                vm.connect(address,code="pair-fixture",certificateSha256="c".repeat(64),route=ConnectionRoute.LOCAL)
                Assert.assertEquals(address,store.baseUrl());Assert.assertEquals("",store.token())
                Assert.assertFalse(vm.hasSavedPairing())
            }
            ui.waitUntil(10000){claims.get()>0&&vm.state.error.contains("503")}
            ui.runOnUiThread{allowPair.set(true);vm.retryConnect()}
            ui.waitUntil(10000){store.token()=="claimed-token"&&vm.state.error.contains("503")}
            val claimed=claims.get()
            ui.runOnUiThread{healthy.set(true);vm.retryConnect()}
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==address}
            Assert.assertEquals(claimed,claims.get())
            Assert.assertEquals("claimed-token",requests.last{it.requestUrl!!.encodedPath=="/ws"}.requestUrl!!.queryParameter("token"))
            Assert.assertEquals("claimed-token",store.token())
        }finally{ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun legacyMessagesCanBeReviewedAndCopiedWithoutRemoteRequests(){
        val original=application.getSharedPreferences("native",0).getString("send:unassigned-record",null)
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        Assert.assertTrue(vm.failedMessages().isEmpty())
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("连接电脑",useUnmergedTree=true).performScrollTo().performClick()
        ui.onNodeWithTag("legacyMessagesEntry").performClick()
        ui.onNodeWithTag("legacyMessage:unassigned-record").performClick()
        ui.onNodeWithTag("legacyMessageText").assertTextEquals("需要保留的旧消息")
        ui.onNodeWithText("旧图片.png").assertIsDisplayed()
        ui.onNodeWithText("旧文档.pdf").assertIsDisplayed()
        ui.onNodeWithTag("copyLegacyMessage").performClick()
        ui.onNodeWithText("已复制文字").assertIsDisplayed()
        ui.runOnIdle{
            val clipboard=application.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            Assert.assertEquals("需要保留的旧消息",clipboard.primaryClip?.getItemAt(0)?.text?.toString())
        }
        Assert.assertEquals(original,application.getSharedPreferences("native",0).getString("send:unassigned-record",null))
        Assert.assertTrue(reads.none{it.path.orEmpty().contains("unassigned-")})
        Assert.assertTrue(wireMessages.none{org.json.JSONObject(it).optString("type") in listOf("thread.start","turn.start")})
        java.io.File(application.getExternalFilesDir(null),"legacy-message-220.png").outputStream().use{ui.onNodeWithTag("sheetPanel").captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.onNodeWithTag("legacyMessage:unassigned-record").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.onNodeWithTag("legacyMessagesEntry").assertIsDisplayed()
    }
    @Test fun computerSwitchKeepsSameProjectAndThreadDraftsSeparate(){
        val original=server.dispatcher
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/api/uploads/files")return MockResponse().setBody("""{"id":"computer-a-file","name":"a.txt","mime":"text/plain","size":4}""")
            return original.dispatch(request)
        }}
        val second=MockWebServer().apply{dispatcher=server.dispatcher;start()}
        val firstAddress=server.url("/").toString().trimEnd('/')
        val secondAddress=second.url("/").toString().trimEnd('/')
        val project=Project("same","同名项目","E:/Same",true)
        val thread=ThreadRecord("t",title="相同会话 ID")
        val file=java.io.File(application.cacheDir,"computer-a.txt").apply{writeText("file")}
        fun connect(address:String){
            ui.runOnUiThread{
                vm.connect(address,"fixture")
                Assert.assertEquals("",vm.state.threadId)
                Assert.assertEquals("",vm.state.draft)
                Assert.assertTrue(vm.state.events.isEmpty())
            }
            ui.waitUntil(15000){vm.state.connected&&vm.state.activeAddress==address}
        }
        try{
            ui.runOnUiThread{vm.newThread(project);vm.draft("电脑 A 的项目草稿");vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
            ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==1}
            ui.runOnUiThread{vm.openThread(thread);vm.draft("电脑 A 的会话草稿")}
            connect(secondAddress)
            ui.runOnUiThread{
                vm.newThread(project);Assert.assertEquals("",vm.state.draft);Assert.assertTrue(vm.state.uploads.isEmpty())
                vm.draft("电脑 B 的项目草稿")
                vm.openThread(thread);Assert.assertEquals("",vm.state.draft);vm.draft("电脑 B 的会话草稿")
            }
            connect(firstAddress)
            ui.runOnUiThread{
                vm.newThread(project);Assert.assertEquals("电脑 A 的项目草稿",vm.state.draft)
                Assert.assertEquals(listOf("computer-a-file"),vm.state.uploads.map{it.id})
                vm.openThread(thread);Assert.assertEquals("电脑 A 的会话草稿",vm.state.draft)
            }
            connect(secondAddress)
            ui.runOnUiThread{
                vm.newThread(project);Assert.assertEquals("电脑 B 的项目草稿",vm.state.draft);Assert.assertTrue(vm.state.uploads.isEmpty())
                vm.openThread(thread);Assert.assertEquals("电脑 B 的会话草稿",vm.state.draft)
                val restored=NativeViewModel(application);restored.openThread(thread)
                Assert.assertEquals("电脑 B 的会话草稿",restored.state.draft);restored.disconnect()
            }
        }finally{ui.runOnUiThread{vm.disconnect()};second.shutdown()}
    }
    @Test fun changedCertificateDoesNotExposePriorDraftOrFailedMessage(){
        val address=server.url("/").toString().trimEnd('/')
        val thread=ThreadRecord("t",title="证书隔离")
        ui.runOnUiThread{vm.openThread(thread);vm.draft("原电脑未发送的消息");vm.send()}
        ui.waitUntil(10000){wireMessages.any{org.json.JSONObject(it).optString("type")=="turn.start"}}
        val command=wireMessages.map{org.json.JSONObject(it)}.first{it.optString("type")=="turn.start"}
        liveSocket.get().send(org.json.JSONObject().put("type","error").put("threadId","t").put("requestId",command.getString("requestId")).put("message","模拟未提交").toString())
        ui.waitUntil(10000){!vm.state.sending&&vm.failedMessages().size==1}
        ui.runOnUiThread{vm.connect(address,"fixture",certificateSha256="a".repeat(64))}
        ui.waitUntil(15000){vm.state.connected&&vm.state.certificateSha256=="a".repeat(64)}
        ui.runOnUiThread{
            vm.openThread(thread)
            Assert.assertEquals("",vm.state.draft);Assert.assertTrue(vm.failedMessages().isEmpty())
            vm.draft("新证书电脑的草稿")
            vm.connect(address,"fixture",certificateSha256="")
        }
        ui.waitUntil(15000){vm.state.connected&&vm.state.certificateSha256.isEmpty()}
        ui.runOnUiThread{
            vm.openThread(thread)
            Assert.assertEquals("原电脑未发送的消息",vm.state.draft)
            Assert.assertEquals("原电脑未发送的消息",vm.failedMessages().single().text)
        }
    }
    @Test fun legacyNativeDraftsMigrateOnlyToTheirConfiguredComputer(){
        val store=ConnectionStore(application)
        val address=store.baseUrl()
        store.saveChatDraft("native:new:","旧版新会话草稿")
        store.saveChatDraft("native:t","旧版会话草稿")
        store.saveChatDraft("global","其他界面的草稿")
        val legacy=org.json.JSONObject().put("id","legacy-send").put("address",address+"/").put("threadId","t").put("text","旧失败消息")
        store.save(address+"/",store.token())
        application.getSharedPreferences("native",0).edit().putString("send:legacy-send",legacy.toString()).commit()
        ui.runOnUiThread{
            val restored=NativeViewModel(application)
            Assert.assertEquals("旧版新会话草稿",restored.state.draft)
            restored.openThread(ThreadRecord("t"));Assert.assertEquals("旧版会话草稿",restored.state.draft)
            Assert.assertEquals("旧失败消息",restored.failedMessages().single().text)
            restored.connect(address,"fixture")
            Assert.assertEquals("t",restored.state.threadId)
            Assert.assertEquals("旧版会话草稿",restored.state.draft)
            restored.disconnect()
        }
        Assert.assertEquals("",store.chatDraft("native:t"))
        val target=org.json.JSONArray(listOf(address,"","native:t")).toString()
        Assert.assertEquals("旧版会话草稿",store.chatDraft(target))
        store.migrateNativeChatDrafts("http://127.0.0.1:1","")
        Assert.assertEquals("",store.chatDraft(org.json.JSONArray(listOf("http://127.0.0.1:1","","native:t")).toString()))
        Assert.assertEquals("其他界面的草稿",store.chatDraft("global"))
    }
    @Test fun reusingHistoryKeepsCurrentDraftAndUploadedAttachments(){
        val original=server.dispatcher
        val historical="用于再次使用的历史消息"
        val image=java.io.File(application.cacheDir,"reuse.png")
        android.graphics.Bitmap.createBitmap(8,8,android.graphics.Bitmap.Config.ARGB_8888).let{bitmap->
            image.outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
        }
        fun file(id:String,name:String)=org.json.JSONObject().put("id",id).put("name",name).put("mime","text/plain").put("size",4)
        val event=org.json.JSONObject().put("type","user.message").put("threadId","t").put("eventId","reuse-history").put("text",historical)
            .put("images",org.json.JSONArray().put(org.json.JSONObject().put("id","reuse-old-image").put("name","历史图片")))
            .put("files",org.json.JSONArray().put(file("reuse-old-file","history.txt")))
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            return when(val path=request.requestUrl!!.encodedPath){
                "/api/threads/t/events"->MockResponse().setBody(org.json.JSONObject().put("status","idle").put("hasMore",false).put("events",org.json.JSONArray().put(event)).toString())
                "/api/uploads/images"->MockResponse().setBody("""{"id":"reuse-new-image","name":"新图片"}""")
                "/api/uploads/files"->MockResponse().setBody(file("reuse-new-file","new.txt").toString())
                else->if(path.startsWith("/api/uploads/images/"))MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(image.readBytes())) else original.dispatch(request)
            }
        }}
        val currentFile=java.io.File(application.cacheDir,"reuse.txt").apply{writeText("file")}
        val thread=ThreadRecord("t",title="历史消息复用")
        ui.runOnUiThread{vm.openThread(thread);vm.draft("尚未发送的草稿");vm.uploadImages(listOf(android.net.Uri.fromFile(image)))}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.uploading&&vm.state.images.size==1}
        ui.runOnUiThread{vm.uploadFiles(listOf(android.net.Uri.fromFile(currentFile)))}
        ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==1}
        repeat(2){
            ui.onNodeWithText(historical,useUnmergedTree=true).performTouchInput{longClick()}
            ui.onNodeWithText("再次使用",useUnmergedTree=true).performClick()
            ui.runOnIdle{
                Assert.assertEquals(historical+"\n\n尚未发送的草稿",vm.state.draft)
                Assert.assertEquals(listOf("reuse-old-image","reuse-new-image"),vm.state.images.map{it.id})
                Assert.assertEquals(listOf("reuse-old-file","reuse-new-file"),vm.state.uploads.map{it.id})
            }
        }
        Assert.assertTrue(wireMessages.none{org.json.JSONObject(it).optString("type") in listOf("thread.start","turn.start")})
        ui.runOnUiThread{
            vm.newThread();vm.openThread(thread)
            Assert.assertEquals(historical+"\n\n尚未发送的草稿",vm.state.draft)
            val restored=NativeViewModel(application);restored.openThread(thread)
            Assert.assertEquals(vm.state.draft,restored.state.draft)
            Assert.assertEquals(vm.state.images,restored.state.images)
            Assert.assertEquals(vm.state.uploads,restored.state.uploads)
            restored.disconnect()
        }
    }
    @Test fun failedSendKeepsLaterAttachmentsSeparateThroughRetry(){
        val original=server.dispatcher
        val uploads=java.util.concurrent.atomic.AtomicInteger()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/uploads/files"){
                val index=uploads.incrementAndGet()
                return MockResponse().setBody(org.json.JSONObject().put("id","failure-file-$index").put("name","file-$index.txt").put("mime","text/plain").put("size",4).toString())
            }
            if(path=="/api/uploads/images")return MockResponse().setBody("""{"id":"failure-new-image","name":"后续图片"}""")
            if(path.endsWith("/submission"))return MockResponse().setBody("""{"submission":{"state":"failed","retryAllowed":false}}""")
            return original.dispatch(request)
        }}
        val file=java.io.File(application.cacheDir,"failure.txt").apply{writeText("file")}
        val image=java.io.File(application.cacheDir,"failure.png")
        android.graphics.Bitmap.createBitmap(8,8,android.graphics.Bitmap.Config.ARGB_8888).let{bitmap->
            image.outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
        }
        val thread=ThreadRecord("t",title="失败重试")
        ui.runOnUiThread{vm.openThread(thread);vm.draft("原始消息");vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
        ui.waitUntil(10000){!vm.state.uploading&&!vm.state.loadingHistory&&vm.state.uploads.size==1}
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){wireMessages.any{org.json.JSONObject(it).optString("type")=="turn.start"}}
        val first=wireMessages.map{org.json.JSONObject(it)}.first{it.optString("type")=="turn.start"}
        ui.runOnUiThread{vm.uploadImages(listOf(android.net.Uri.fromFile(image)))}
        ui.waitUntil(10000){!vm.state.uploading&&vm.state.images.size==1}
        ui.runOnUiThread{vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
        ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==1}
        liveSocket.get().send(org.json.JSONObject().put("type","error").put("threadId","t").put("requestId",first.getString("requestId")).put("message","模拟发送失败").toString())
        ui.waitUntil(10000){!vm.state.sending&&vm.failedMessages().isNotEmpty()}
        fun assertNextDraft(){
            Assert.assertEquals("",vm.state.draft)
            Assert.assertEquals(listOf("failure-new-image"),vm.state.images.map{it.id})
            Assert.assertEquals(listOf("failure-file-2"),vm.state.uploads.map{it.id})
        }
        ui.runOnIdle{
            assertNextDraft()
            Assert.assertEquals(listOf("failure-file-1"),vm.failedMessages().single().uploads.map{it.id})
        }
        wireReply=reply@{socket,text->
            val command=org.json.JSONObject(text)
            if(command.optString("type")!="turn.start")return@reply
            socket.send(org.json.JSONObject().put("type","command.accepted").put("threadId","t").put("requestId",command.getString("requestId")).toString())
        }
        ui.onNodeWithText("重试",useUnmergedTree=true).performClick()
        ui.waitUntil(10000){!vm.state.sending&&vm.failedMessages().isEmpty()}
        val commands=wireMessages.map{org.json.JSONObject(it)}.filter{it.optString("type")=="turn.start"}
        Assert.assertEquals(2,commands.size)
        Assert.assertEquals("原始消息",commands.last().getString("text"))
        Assert.assertEquals("failure-file-1",commands.last().getJSONArray("files").getJSONObject(0).getString("id"))
        Assert.assertEquals(1,commands.last().getJSONArray("files").length())
        Assert.assertEquals(0,commands.last().optJSONArray("images")?.length()?:0)
        ui.runOnUiThread{
            assertNextDraft();vm.newThread();vm.openThread(thread);assertNextDraft()
        }
    }
    @Test fun draftAndLateUploadFollowCreatedConversation()=auditCreatedConversationDraft(true)
    @Test fun draftFollowsConfirmationWithoutCreationEvent()=auditCreatedConversationDraft(false)
    private fun auditCreatedConversationDraft(creationEvent:Boolean){
        val original=server.dispatcher
        val uploads=java.util.concurrent.atomic.AtomicInteger()
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath=="/api/uploads/files"){
                val index=uploads.incrementAndGet()
                if(index==2){entered.countDown();release.await(10,java.util.concurrent.TimeUnit.SECONDS)}
                return MockResponse().setBody(org.json.JSONObject().put("id","draft-next-$index").put("name","next-$index.txt").put("mime","text/plain").put("size",4).toString())
            }
            return original.dispatch(request)
        }}
        val file=java.io.File(application.cacheDir,"next.txt").apply{writeText("next")}
        val target=ThreadRecord("created-draft",title="新会话草稿")
        try{
            ui.runOnUiThread{vm.newThread();vm.draft("继续输入");vm.send()}
            ui.waitUntil(10000){wireMessages.any{org.json.JSONObject(it).optString("type")=="thread.start"}}
            val command=wireMessages.map{org.json.JSONObject(it)}.first{it.optString("type")=="thread.start"}
            ui.onNodeWithTag("composer").performTextReplacement("继续输入")
            ui.runOnUiThread{vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
            ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==1}
            ui.runOnUiThread{vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
            Assert.assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS))
            fun reply(type:String){liveSocket.get().send(org.json.JSONObject().put("type",type).put("threadId",target.id).put("requestId",command.getString("requestId")).put("status","idle").put("thread",org.json.JSONObject().put("id",target.id).put("title",target.title)).toString())}
            reply(if(creationEvent)"thread.started" else "command.accepted")
            ui.waitUntil(10000){vm.state.threadId==target.id}
            release.countDown()
            ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==2}
            if(creationEvent)reply("command.accepted")
            ui.waitUntil(10000){!vm.state.sending}
            ui.runOnIdle{Assert.assertEquals("继续输入",vm.state.draft)}
            ui.runOnUiThread{
                vm.newThread()
                Assert.assertEquals("",vm.state.draft)
                Assert.assertTrue(vm.state.uploads.isEmpty())
                vm.openThread(target)
                Assert.assertEquals("继续输入",vm.state.draft)
                Assert.assertEquals(listOf("draft-next-1","draft-next-2"),vm.state.uploads.map{it.id})
                val restored=NativeViewModel(application)
                restored.openThread(target)
                Assert.assertEquals("继续输入",restored.state.draft)
                Assert.assertEquals(listOf("draft-next-1","draft-next-2"),restored.state.uploads.map{it.id})
                restored.disconnect()
            }
        }finally{release.countDown()}
    }
    @Test fun freshConversationGoalUsesSubmissionReceiptAndKeepsUnsentFiles()=auditFreshGoalRetry(false)
    @Test fun partiallyCreatedGoalRetriesOriginalSubmissionFromComposer()=auditFreshGoalRetry(true)
    private fun auditFreshGoalRetry(partial:Boolean){
        val original=server.dispatcher
        val saved=java.util.concurrent.atomic.AtomicReference<org.json.JSONObject?>(null)
        val attempts=java.util.concurrent.atomic.AtomicInteger()
        val uploads=java.util.concurrent.atomic.AtomicInteger()
        val submissions=java.util.concurrent.atomic.AtomicInteger()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/uploads/files"){
                val second=uploads.incrementAndGet()>1
                return MockResponse().setBody(org.json.JSONObject().put("id",if(second)"70f9db6b-845a-4c58-8026-32b6651b99b7" else "70f9db6b-845a-4c58-8026-32b6651b99b6").put("name",if(second)"goal-extra.txt" else "goal-notes.txt").put("mime","text/plain").put("size",5).toString())
            }
            if(path.endsWith("/submission")){submissions.incrementAndGet();return MockResponse().setBody("""{"submission":{"state":"failed","retryAllowed":$partial}}""")}
            val status=if(saved.get()?.optString("status")=="active")"running" else "idle"
            if(path=="/api/threads"&&saved.get()!=null)return MockResponse().setBody(org.json.JSONObject().put("threads",org.json.JSONArray().put(org.json.JSONObject().put("id","fresh-goal").put("title",saved.get()!!.getString("objective")).put("status",status).put("goal",saved.get()))).toString())
            if(path=="/api/threads/fresh-goal/events")return MockResponse().setBody("""{"status":"$status","hasMore":false,"events":[]}""")
            return original.dispatch(request)
        }}
        wireReply=reply@{socket,text->
            val command=org.json.JSONObject(text)
            if(command.optString("type")=="thread.start"){
                if(attempts.incrementAndGet()==1){
                    if(partial){
                        saved.set(org.json.JSONObject().put("goalId","fresh").put("objective",nativeGoalObjective(command.optString("initialText"))).put("status","paused"))
                        socket.send(org.json.JSONObject().put("type","thread.started").put("threadId","fresh-goal").put("requestId",command.getString("requestId")).put("thread",org.json.JSONObject().put("id","fresh-goal").put("title",saved.get()!!.getString("objective")).put("status","idle")).toString())
                    }
                    socket.send(org.json.JSONObject().put("type","error").put("requestId",command.getString("requestId")).put("message","暂时无法创建目标").toString())
                    return@reply
                }
                val objective=nativeGoalObjective(command.optString("initialText"))!!
                saved.set(org.json.JSONObject().put("goalId","fresh").put("objective",objective).put("status","active"))
                if(!partial)socket.send(org.json.JSONObject().put("type","thread.started").put("threadId","fresh-goal").put("requestId",command.getString("requestId")).put("thread",org.json.JSONObject().put("id","fresh-goal").put("title",objective).put("status","running")).toString())
                socket.send(org.json.JSONObject().put("type","command.accepted").put("threadId","fresh-goal").put("requestId",command.getString("requestId")).toString())
            }
        }
        val file=java.io.File(application.cacheDir,"goal-notes.txt").apply{writeText("notes")}
        ui.runOnUiThread{vm.newThread();vm.uploadFiles(listOf(android.net.Uri.fromFile(file)))}
        ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==1}
        val objective="从新会话建立目标"
        ui.onNodeWithTag("composer").performTextReplacement("/goal $objective")
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){!vm.state.sending&&vm.state.error.isNotEmpty()}
        val extra=java.io.File(application.cacheDir,"goal-extra.txt").apply{writeText("extra")}
        ui.runOnUiThread{Assert.assertEquals("/goal $objective",vm.state.draft);vm.uploadFiles(listOf(android.net.Uri.fromFile(extra)))}
        ui.waitUntil(10000){!vm.state.uploading&&vm.state.uploads.size==2}
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){!vm.state.sending&&vm.state.threadId=="fresh-goal"&&vm.state.threads.any{it.id=="fresh-goal"&&it.goal?.objective==objective}}
        ui.onNodeWithTag("goalHeaderTitle",useUnmergedTree=true).assertTextEquals("目标：$objective")
        ui.runOnIdle{Assert.assertEquals("",vm.state.draft);Assert.assertEquals(listOf("goal-notes.txt","goal-extra.txt"),vm.state.uploads.map{it.name})}
        val commands=wireMessages.map{org.json.JSONObject(it)}.filter{it.optString("type")=="thread.start"}
        Assert.assertEquals(2,commands.size)
        if(partial)Assert.assertEquals(commands[0].toString(),commands[1].toString())
        Assert.assertTrue(commands.all{(it.optJSONArray("files")?.length()?:0)==0})
        Assert.assertTrue(submissions.get()>0)
        Assert.assertTrue(reads.none{it.requestUrl!!.encodedPath.endsWith("/goal")})
        java.io.File(application.getExternalFilesDir(null),if(partial)"partial-goal-205.png" else "fresh-goal-199.png").outputStream().use{ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
    @Test fun inlineGoalCommandShowsGoalAndPreservesFailedDraft(){
        val original=server.dispatcher
        val requests=CopyOnWriteArrayList<org.json.JSONObject>()
        val fail=java.util.concurrent.atomic.AtomicBoolean(true)
        val hold=java.util.concurrent.atomic.AtomicBoolean(false)
        val release=java.util.concurrent.CountDownLatch(1)
        var saved:org.json.JSONObject?=null
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/threads")return MockResponse().setBody(org.json.JSONObject().put("threads",org.json.JSONArray().put(org.json.JSONObject().put("id","t").put("title","目标命令检查").put("status","idle").apply{saved?.let{put("goal",it)}}).put(org.json.JSONObject().put("id","other").put("title","另一会话").put("status","idle"))).toString())
            if(path.endsWith("/goal")&&request.method=="PATCH"){
                val body=org.json.JSONObject(request.body.readUtf8());requests.add(body)
                if(fail.getAndSet(false))return MockResponse().setResponseCode(503).setBody("""{"message":"目标保存失败"}""")
                if(hold.get())release.await(5,java.util.concurrent.TimeUnit.SECONDS)
                saved=org.json.JSONObject().put("goalId","inline-goal").put("objective",body.getString("objective")).put("status",body.getString("status"))
                return MockResponse().setBody(org.json.JSONObject().put("goal",saved).toString())
            }
            return original.dispatch(request)
        }}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.threadId=="t"}
        val objective="基于本地科研工作流优化项目和使用体验"
        val command="/goal $objective"
        ui.onNodeWithTag("composer").performTextReplacement(command)
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){requests.size==1&&!vm.state.sending&&vm.state.error.isNotEmpty()}
        ui.runOnIdle{Assert.assertEquals(command,vm.state.draft)}
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){requests.size==2&&!vm.state.sending&&vm.state.threads.first{it.id=="t"}.goal?.objective==objective}
        ui.onNodeWithTag("goalHeaderTitle",useUnmergedTree=true).assertTextEquals("目标：$objective")
        ui.runOnIdle{Assert.assertEquals("",vm.state.draft)}
        Assert.assertTrue(wireMessages.none{it.contains("turn.start")||it.contains("thread.start")})
        fun capture(name:String){java.io.File(application.getExternalFilesDir(null),name).outputStream().use{ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}
        capture("goal-command-198.png")
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithTag("threadRow:t").assertIsDisplayed()
        ui.waitForIdle()
        ui.mainClock.autoAdvance=false
        try{
            ui.onNodeWithTag("threadRow:t").performTouchInput{down(center)}
            ui.mainClock.advanceTimeBy(120)
            capture("sidebar-pressed-198.png")
            ui.onNodeWithTag("threadRow:t").performTouchInput{up()}
        }finally{ui.mainClock.autoAdvance=true}
        ui.waitForIdle()
        ui.waitUntil(5000){vm.state.threadId=="t"&&!vm.state.loadingHistory}
        hold.set(true)
        ui.runOnUiThread{vm.draft("/goal 保存期间切换会话");vm.send()}
        ui.waitUntil(5000){requests.size==3&&vm.state.sending}
        try{
            ui.runOnUiThread{vm.openThread(ThreadRecord(id="other",title="另一会话"));vm.draft("另一会话的新消息");vm.send()}
            ui.waitUntil(3000){wireMessages.any{it.contains("另一会话的新消息")}}
            release.countDown()
            ui.waitUntil(5000){!vm.state.workBusy}
            ui.runOnIdle{Assert.assertEquals("other",vm.state.threadId);Assert.assertTrue("旧目标回包不能结束新消息的发送状态",vm.state.sending)}
        }finally{release.countDown()}
    }
    @Test fun runningGoalCanPauseAndResumeWithoutStartingAnotherTurn(){
        val original=server.dispatcher
        val statuses=CopyOnWriteArrayList<String>()
        var goalStatus="active"
        fun goal()=org.json.JSONObject().put("goalId","g").put("objective","保持当前会话运行").put("status",goalStatus)
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/threads")return MockResponse().setBody(org.json.JSONObject().put("threads",org.json.JSONArray().put(org.json.JSONObject().put("id","t").put("title","Goal 测试").put("status","running").put("goal",goal()))).toString())
            if(path.endsWith("/events"))return MockResponse().setBody("""{"status":"running","events":[]}""")
            if(path.endsWith("/goal")&&request.method=="PATCH"){
                goalStatus=org.json.JSONObject(request.body.readUtf8()).getString("status");statuses.add(goalStatus)
                return MockResponse().setBody(org.json.JSONObject().put("goal",goal()).toString())
            }
            return original.dispatch(request)
        }}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.running&&vm.state.threads.firstOrNull{it.id=="t"}?.goal!=null}
        ui.onNodeWithTag("goalExpand").performClick()
        ui.onNodeWithText("暂停",useUnmergedTree=true).performClick()
        ui.waitUntil(10000){!vm.state.workBusy&&vm.state.threads.first{it.id=="t"}.goal?.status=="paused"}
        ui.onNodeWithText("继续",useUnmergedTree=true).assertIsEnabled().performClick()
        ui.waitUntil(10000){!vm.state.workBusy&&vm.state.threads.first{it.id=="t"}.goal?.status=="active"}
        ui.runOnIdle{Assert.assertTrue(vm.state.running);Assert.assertEquals("t",vm.state.threadId)}
        Assert.assertEquals(listOf("paused","active"),statuses.toList())
        Assert.assertTrue(reads.none{it.requestUrl!!.encodedPath.endsWith("/goal/continue")})
    }
    @Test fun enqueueAndQuestionPanelKeepWindowAndConversationBounds(){
        val original=server.dispatcher
        val messages=CopyOnWriteArrayList<org.json.JSONObject>()
        val questionVisible=java.util.concurrent.atomic.AtomicBoolean(false)
        val answered=java.util.concurrent.atomic.AtomicBoolean(false)
        val detail=org.json.JSONObject().put("questions",org.json.JSONArray().put(org.json.JSONObject().put("id","choice").put("question","接下来检查哪一处动画？").put("options",org.json.JSONArray().put(org.json.JSONObject().put("label","消息入队")).put(org.json.JSONObject().put("label","回答弹窗"))))).toString()
        historyText=(1..40).joinToString("\n\n"){"### 正文 $it\n\n运行中的 **格式化消息**，用于检查入队和回答弹窗是否干扰聊天绘制。"}
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path.endsWith("/events"))return original.dispatch(request).also{response->response.setBody(org.json.JSONObject(response.getBody()!!.clone().readUtf8()).put("status","running").toString())}
            if(path.endsWith("/queue")){
                if(request.method=="POST"){
                    val message=org.json.JSONObject(request.body.readUtf8()).put("status","queued").put("canSteer",true)
                    messages.add(message)
                    return MockResponse().setHeadersDelay(350,java.util.concurrent.TimeUnit.MILLISECONDS).setBody(org.json.JSONObject().put("message",message).toString())
                }
                return MockResponse().setBody(org.json.JSONObject().put("messages",org.json.JSONArray(messages)).put("canSteer",true).toString())
            }
            if(path=="/api/approvals")return MockResponse().setBody(org.json.JSONObject().put("approvals",org.json.JSONArray().apply{if(questionVisible.get()&&!answered.get())put(org.json.JSONObject().put("id","question-frame").put("threadId","t").put("approvalType","question").put("status","pending").put("detail",detail))}).toString())
            if(path.endsWith("/question-frame/answer")){answered.set(true);return MockResponse().setBody("{}")}
            return original.dispatch(request)
        }}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.running}
        ui.waitForIdle()
        ui.runOnUiThread{vm.draft("检查消息入队动画");vm.send()}
        ui.waitUntil(10000){!vm.state.sending&&vm.state.queue.isNotEmpty()}
        ui.onNodeWithText("检查消息入队动画").assertIsDisplayed()
        val messageBounds=ui.onNodeWithTag("messages").fetchSemanticsNode().boundsInRoot
        var windowCount=0
        ui.runOnUiThread{windowCount=android.view.inspector.WindowInspector.getGlobalWindowViews().size}
        questionVisible.set(true)
        val refresh=kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch{vm.refresh()}
        ui.waitUntil(10000){!refresh.isActive&&vm.state.pendingApprovals.isNotEmpty()}
        ui.onAllNodesWithText("接下来检查哪一处动画？").onLast().assertIsDisplayed()
        ui.runOnUiThread{Assert.assertEquals("回答面板不应新建窗口",windowCount,android.view.inspector.WindowInspector.getGlobalWindowViews().size)}
        Assert.assertEquals(messageBounds,ui.onNodeWithTag("messages").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithText("回答弹窗").performClick()
        ui.onNodeWithText("提交回答").performClick()
        ui.waitUntil(10000){"question-frame" in vm.state.approvals}
    }
    @Test fun conversationAndQueuePopupFrameTrace(){
        val original=server.dispatcher
        historyText=(1..50).joinToString("\n\n"){"### 段落 $it\n\n这是一段用于会话切换的 **格式化正文**，包含 [文件](E:/Pictures/720/note.md) 和若干普通文字。"}
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            if(request.requestUrl!!.encodedPath.endsWith("/queue"))return MockResponse().setBody("""{"canSteer":true,"messages":[{"id":"q","text":"继续检查","status":"queued","canSteer":true}]}""")
            return original.dispatch(request)
        }}
        var phase="";var previous=0L
        val samples=linkedMapOf<String,MutableList<Double>>()
        lateinit var callback:android.view.Choreographer.FrameCallback
        ui.runOnUiThread{
            callback=android.view.Choreographer.FrameCallback{time->
                if(phase.isNotBlank()&&previous>0&&time>previous)samples.getOrPut(phase){mutableListOf()}.add((time-previous)/1_000_000.0)
                previous=time;android.view.Choreographer.getInstance().postFrameCallback(callback)
            }
            android.view.Choreographer.getInstance().postFrameCallback(callback)
        }
        try{
            ui.runOnUiThread{phase="conversation";previous=System.nanoTime();vm.openThread(vm.state.threads.first())}
            ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.queue.isNotEmpty()}
            ui.waitForIdle();android.os.SystemClock.sleep(300)
            ui.runOnUiThread{phase="";vm.newThread()}
            ui.waitForIdle()
            ui.runOnUiThread{phase="conversation-cached";previous=System.nanoTime();vm.openThread(vm.state.threads.first())}
            ui.waitUntil(10000){vm.state.queue.isNotEmpty()}
            ui.waitForIdle();android.os.SystemClock.sleep(300)
            ui.runOnUiThread{phase="queue-popup";previous=System.nanoTime()}
            ui.onNodeWithContentDescription("待发消息操作").performClick()
            ui.onNodeWithText("改为引导").assertIsDisplayed()
            android.os.SystemClock.sleep(300)
        }finally{
            ui.runOnUiThread{phase="";android.view.Choreographer.getInstance().removeFrameCallback(callback)}
        }
        samples.forEach{(stage,values)->val sorted=values.sorted();android.util.Log.i("UiFrameTrace","$stage samples=${values.size} maxMs=${sorted.lastOrNull()} over33ms=${values.count{it>33.4}} p95Ms=${sorted.getOrNull((sorted.size*0.95).toInt())}")}
    }
    @Test fun sidebarRestoresAndPrefetchesThreadsBeforeSocketAndSlowProjects(){
        ui.waitUntil(10000){!vm.state.loadingSidebar}
        val original=server.dispatcher
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            if(path=="/api/threads")return MockResponse().setHeader("Content-Type","application/json")
                .setBody("""{"threads":[{"id":"t","title":"已预取会话","projectPath":"E:/Pictures/720","status":"idle"}]}""")
            return original.dispatch(request).also{if(path=="/ws"||path=="/api/sidebar")it.setHeadersDelay(4,java.util.concurrent.TimeUnit.SECONDS)}
        }}
        lateinit var restored:NativeViewModel
        ui.runOnUiThread{
            vm.disconnect()
            restored=NativeViewModel(application)
            Assert.assertEquals("t",restored.state.threads.first().id)
            Assert.assertFalse(restored.state.connected)
            restored.connect(server.url("/").toString().trimEnd('/'),"fixture")
        }
        try{
            ui.waitUntil(2500){restored.state.threads.firstOrNull()?.title=="已预取会话"}
            ui.runOnIdle{Assert.assertFalse(restored.state.connected);Assert.assertTrue(restored.state.loadingSidebar)}
        }finally{ui.runOnUiThread{restored.disconnect()}}
    }
    @Test fun sidebarDeltaReordersAndRemovesOnlyRowsInItsPage(){
        val initial=org.json.JSONObject("""{"sidebarRevision":"one","projects":[{"id":"a","path":"P:/a","name":"A"},{"id":"b","path":"P:/b","name":"B"}],"hasMore":true}""")
        val delta=org.json.JSONObject("""{"sidebarDelta":true,"sidebarBase":"one","sidebarRevision":"two","changed":{"projects":[{"id":"c","path":"P:/c","name":"C"}]},"removed":{"projects":["[\"b\",\"P:/b\"]"]},"order":{"projects":["[\"c\",\"P:/c\"]","[\"a\",\"P:/a\"]"]},"hasMore":true}""")
        val result=mergeSidebarDelta(initial,delta)
        Assert.assertEquals(listOf("c","a"),(0 until result.getJSONArray("projects").length()).map{result.getJSONArray("projects").getJSONObject(it).getString("id")})
        Assert.assertTrue(result.getBoolean("hasMore"))
        Assert.assertEquals(2,initial.getJSONArray("projects").length())
    }
    @Test fun unreachableLanHealthDoesNotDelayPublicHealth():Unit=kotlinx.coroutines.runBlocking{
        val stalled=MockWebServer()
        stalled.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        stalled.start()
        try{
            val local=stalled.url("/").toString().trimEnd('/')
            val remote=server.url("/").toString().trimEnd('/')
            val clients=listOf(local,remote).associateWith{GatewayClient(it,"fixture")}
            val started=android.os.SystemClock.elapsedRealtime()
            val chosen=kotlinx.coroutines.withTimeout(2500){
                firstResponsiveRoute(listOf(local,remote)){clients.getValue(it).probeHealth()}
            }
            val elapsed=android.os.SystemClock.elapsedRealtime()-started
            Assert.assertEquals(remote,chosen.first)
            Assert.assertTrue(chosen.second.ok)
            Assert.assertNotNull(stalled.takeRequest(1,java.util.concurrent.TimeUnit.SECONDS))
            android.util.Log.i("ConnectionRaceTest","Unreachable LAN fallback completed in ${elapsed}ms")
        }finally{stalled.shutdown()}
    }
    @Test fun composerKeepsBracketInsertionThroughImeCompositionAndRefresh(){
        ui.onNodeWithTag("composer").performClick()
        lateinit var connection:android.view.inputmethod.InputConnection
        fun edit(action:android.view.inputmethod.InputConnection.()->Unit){
            ui.runOnUiThread{connection.action()}
            ui.waitForIdle()
        }
        fun expect(text:String,cursor:Int){
            ui.runOnIdle{
                Assert.assertEquals(text,vm.state.draft)
                val value=connection.getExtractedText(android.view.inputmethod.ExtractedTextRequest(),0)
                Assert.assertEquals(text,value.text.toString())
                Assert.assertEquals(cursor,value.selectionStart)
                Assert.assertEquals(cursor,value.selectionEnd)
            }
        }
        for(pair in listOf("()","（）")){
            ui.onNodeWithTag("composer").performTextClearance()
            ui.runOnIdle {
                connection=checkNotNull(ui.activity.window.decorView.findFocus()
                    ?.onCreateInputConnection(android.view.inputmethod.EditorInfo()))
            }
            edit{commitText(pair,1)}
            edit{setSelection(1,1)}
            expect(pair,1)
            edit{setComposingText("ni",1)}
            expect("${pair[0]}ni${pair[1]}",3)
            // A normal ViewModel update must not reset the IME's composing range.
            ui.runOnUiThread{vm.togglePlan()}
            ui.waitForIdle()
            edit{setComposingText("nihao",1)}
            expect("${pair[0]}nihao${pair[1]}",6)
            edit{commitText("你好",1)}
            edit{finishComposingText()}
            expect("${pair[0]}你好${pair[1]}",3)
            edit{setSelection(2,2)}
            edit{commitText("的",1)}
            expect("${pair[0]}你的好${pair[1]}",3)
        }
    }
    @Test fun imageFileLinkPreviewsWithoutSavingToGallery(){
        fun galleryCount()=application.contentResolver.query(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,arrayOf("_id"),null,null,null)?.use{it.count}?:0
        val before=galleryCount()
        ui.runOnUiThread{vm.openOutput("E:/Pictures/720/preview-only.jpg","history:photo","t")}
        ui.waitUntil(10000){vm.state.openedImage!=null&&!vm.state.fileBusy}
        ui.onNodeWithContentDescription("关闭图片预览").assertIsDisplayed()
        Assert.assertEquals(before,galleryCount())
        Assert.assertFalse(vm.state.storagePermissionRequired)
        Assert.assertEquals("",vm.state.fileError)
    }
    @Test fun wideAndTallImagesKeepTheirRatioWithinTheHeightLimit(){
        historyText="![横图](E:/Pictures/720/wide.png)\n\n![长图](E:/Pictures/720/tall.png)"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(15000){!vm.state.loadingHistory&&ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==2}
        val density=application.resources.displayMetrics.density
        val limit=minOf(320f,application.resources.configuration.screenHeightDp*0.5f)*density
        val bounds=ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().map{it.boundsInRoot}
        Assert.assertEquals(6f,bounds[0].width/bounds[0].height,0.05f)
        Assert.assertEquals(1f/6f,bounds[1].width/bounds[1].height,0.01f)
        bounds.forEach{Assert.assertTrue("Image height must stay capped",it.height<=limit+2f)}
        val screenshot=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        java.io.File(application.getExternalFilesDir(null),"experience-165-image-ratios.png").outputStream().use{screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
    @Test fun missingOutputImageCanBeRetriedInTheSameConversation(){
        historyText="![重试图片](E:/Pictures/720/retry.png)";retryImageAvailable=false
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(15000){ui.onAllNodes(hasText("图片读取失败（HTTP 404），点击重试")).fetchSemanticsNodes().isNotEmpty()}
        retryImageAvailable=true
        ui.onNodeWithText("图片读取失败（HTTP 404），点击重试").performClick()
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("图片").assertIsDisplayed()
        Assert.assertTrue(reads.count{it.requestUrl!!.queryParameter("path")?.endsWith("retry.png")==true}>=2)
    }
    @Test fun switchingConversationCancelsSlowDocumentAndKeepsTheNewPreview(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(15000){!vm.state.loadingHistory}
        ui.runOnUiThread{vm.openOutput("E:/Pictures/720/slow.md","history:photo","t")}
        ui.waitUntil(10000){reads.any{it.requestUrl!!.queryParameter("path")?.endsWith("slow.md")==true}}
        ui.runOnUiThread{
            vm.newThread()
            Assert.assertFalse(vm.state.fileBusy)
            Assert.assertNull(vm.state.markdown)
            vm.openOutput("E:/Pictures/720/fresh.md","history:photo","t")
        }
        ui.waitUntil(10000){vm.state.markdown?.content=="新会话文档"&&!vm.state.fileBusy}
        android.os.SystemClock.sleep(3500)
        ui.runOnIdle{
            Assert.assertEquals("新会话文档",vm.state.markdown?.content)
            Assert.assertEquals("",vm.state.fileError)
            Assert.assertFalse(vm.state.fileFeedbackVisible)
            Assert.assertTrue(java.io.File(application.cacheDir,"markdown-previews").listFiles().orEmpty().isEmpty())
        }
    }
    @Test fun unregisteredConversationOutputShowsAnImageAndCorrectBoldText(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(15000){!vm.state.loadingHistory&&reads.any{it.requestUrl!!.encodedPath.contains("/output-file/")}&&ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().isNotEmpty()}
        val request=reads.first{it.requestUrl!!.encodedPath.contains("/output-file/")}
        Assert.assertEquals("history:photo",request.requestUrl!!.queryParameter("eventId"))
        Assert.assertEquals("E:/Pictures/720/九宫格.jpg",request.requestUrl!!.queryParameter("path"))
        Assert.assertTrue(reads.none{it.method=="POST"&&it.requestUrl!!.encodedPath=="/api/projects"})
        androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("逆光暗调可以保留。其余照片无需调整。"))
            .check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()))
        ui.onNodeWithContentDescription("图片").assertIsDisplayed().performClick()
        ui.waitForIdle()
        val screenshot=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        java.io.File(application.getExternalFilesDir(null),"native-output-preview-0.6.128.png").outputStream().use{screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        Assert.assertEquals("",vm.state.fileError)
        Assert.assertTrue(vm.state.projects.isEmpty())
    }
}
