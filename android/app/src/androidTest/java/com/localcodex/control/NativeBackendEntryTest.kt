package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.*
import okhttp3.mockwebserver.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class NativeBackendEntryTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val app get()=ApplicationProvider.getApplicationContext<Application>()
    private val server=MockWebServer()
    private val commands=CopyOnWriteArrayList<JSONObject>()
    private val history=CopyOnWriteArrayList<JSONObject>()
    private lateinit var vm:NativeViewModel
    private var agent="claude"
    private var blocked=false
    @Volatile private var active=false
    @Volatile private var running=false
    private var address=""
    private val longAnswer="AGY_HEAD|"+(0 until 6100).joinToString(""){"段🙂$it|"}+"AGY_END"
    private val id get()="$agent-fixture"
    @Before fun guard(){check(app.packageName.endsWith(".remotecheck"));app.getSharedPreferences("native",0).edit().clear().commit();app.getSharedPreferences("connection",0).edit().clear().commit()}
    private fun setup(source:String="claude",publicBlocked:Boolean=false){
        agent=source;blocked=publicBlocked
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            val path=request.requestUrl!!.encodedPath
            fun json(body:Any)=MockResponse().setHeader("Content-Type","application/json").setBody(body.toString())
            if(path=="/ws")return MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                override fun onOpen(socket:WebSocket,response:Response){socket.send("""{"type":"connected","serverVersion":"fixture","protocolVersion":1,"capabilities":[]}""")}
                override fun onClosing(socket:WebSocket,code:Int,reason:String){socket.close(code,reason)}
                override fun onMessage(socket:WebSocket,text:String){
                    val command=JSONObject(text);commands.add(command)
                    if(command.optString("type")=="turn.interrupt"){running=false;socket.send(JSONObject().put("type","turn.completed").put("threadId",id).put("status","interrupted").toString());return}
                    if(command.optString("type") !in listOf("thread.start","turn.start"))return
                    val prompt=command.optString("initialText",command.optString("text"));active=true;running=true
                    if(command.optString("type")=="thread.start")socket.send(JSONObject().put("type","thread.started").put("threadId",id).put("requestId",command.getString("requestId")).put("thread",thread()).toString())
                    socket.send(JSONObject().put("type","turn.started").put("threadId",id).put("requestId",command.getString("requestId")).toString())
                    val user=JSONObject().put("type","user.message").put("eventId","user-"+commands.size).put("threadId",id).put("requestId",command.getString("requestId")).put("text",prompt);history.add(user);socket.send(user.toString())
                    if(prompt=="LONG"){
                        val pieces=listOf("AGY_HEAD|")+(0 until 6100).map{"段🙂$it|"}+"AGY_END"
                        pieces.forEachIndexed{index,chunk->val reply=JSONObject().put("type","message.delta").put("threadId",id).put("eventId","long-$index").put("itemId","long-reply").put("text",chunk);history.add(reply);socket.send(reply.toString())}
                    }else{
                        val reply=JSONObject().put("type","message.delta").put("eventId","reply-"+commands.size).put("threadId",id).put("itemId","reply-"+commands.size).put("text",if(prompt=="SLOW")"waiting" else "$agent fixture $prompt");history.add(reply);socket.send(reply.toString())
                    }
                    if(prompt!="SLOW"){running=false;val end=JSONObject().put("type","turn.completed").put("threadId",id).put("status","completed");history.add(end);socket.send(end.toString())}
                }
            })
            if(path=="/health")return json("""{"ok":true,"protocolVersion":1,"minAndroidProtocolVersion":1,"capabilities":[]}""")
            if(path=="/api/models")return json(JSONObject().put("models",JSONArray().put(JSONObject().put("model","$agent::default").put("displayName",nativeAgentName(agent)).put("supportedReasoningEfforts",JSONArray()).put("available",!blocked).put("unavailableReason",if(blocked)"当前公网入口不支持该助手" else ""))).put("backends",JSONArray().put(JSONObject().put("agent",agent).put("available",!blocked).put("installed",true).put("reason",if(blocked)"当前公网入口不支持该助手，请使用已配对的局域网连接" else ""))))
            if(path=="/api/projects"||path=="/api/sidebar")return json("""{"projects":[{"id":"p","name":"Fixture","path":"X:/fixture","trusted":true}],"allowedProjects":[{"id":"p","name":"Fixture","path":"X:/fixture","trusted":true}]}""")
            if(path=="/api/threads")return json(JSONObject().put("threads",if(active)JSONArray().put(thread())else JSONArray()).put("hasMore",false))
            if(path=="/api/approvals")return json("""{"approvals":[]}""")
            if(path.endsWith("/queue"))return json("""{"messages":[],"canSteer":false}""")
            if(path.endsWith("/events"))return json(JSONObject().put("events",JSONArray(history)).put("status",if(running)"running" else "completed").put("hasMore",false).put("settings",JSONObject().put("model","$agent::default").put("actualModel",if(agent=="claude")"grok-fixture" else "")))
            return json("{}")
        }}
        server.start();app.getSharedPreferences("native",0).edit().putString("harness",agent).commit();vm=NativeViewModel(app)
        ui.setContent{NativeApp(vm)}
        address=server.url("/").toString().trimEnd('/')
        ui.runOnUiThread{vm.connect(address,"fixture-token")}
        ui.waitUntil(15000){vm.state.connected&&vm.state.backends.isNotEmpty()&&vm.state.projects.isNotEmpty()}
    }
    private fun thread()=JSONObject().put("id",id).put("title","$agent fixture").put("projectPath","X:/fixture").put("status",if(running)"running" else "completed")
    @After fun teardown(){if(::vm.isInitialized)ui.runOnUiThread{vm.disconnect()};runCatching{server.shutdown()}}
    private fun flow(source:String){
        setup(source);ui.runOnUiThread{vm.switchHarness(source);vm.newThread(vm.state.projects.first());vm.draft("START");vm.send()}
        ui.waitUntil(15000){vm.state.threadId==id&&!vm.state.running&&!vm.state.sending&&vm.state.events.any{it.text.contains("fixture START")}}
        ui.runOnUiThread{vm.draft("CONTINUE");vm.send()}
        ui.waitUntil(15000){!vm.state.running&&!vm.state.sending&&vm.state.events.any{it.text.contains("fixture CONTINUE")}}
        ui.runOnUiThread{vm.draft("SLOW");vm.send()};ui.waitUntil(10000){vm.state.running&&vm.state.events.any{it.text=="waiting"}}
        ui.runOnUiThread{vm.stop()};ui.waitUntil(10000){!vm.state.running&&!vm.state.stopping}
        Assert.assertEquals(1,commands.count{it.optString("type")=="thread.start"});Assert.assertEquals(2,commands.count{it.optString("type")=="turn.start"});Assert.assertEquals(1,commands.count{it.optString("type")=="turn.interrupt"})
    }
    private fun screenshot(name:String){val bitmap=ui.onRoot().captureToImage().asAndroidBitmap();app.filesDir.resolve(name).outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}}
    @Test fun claudeStartsContinuesStopsAndReportsActualModel(){flow("claude");ui.waitUntil(10000){vm.state.actualModel=="grok-fixture"};ui.onNodeWithTag("backend-model-notice").assertTextContains("grok-fixture",substring=true);screenshot("native-claude-backend.png")}
    @Test fun agyStartsContinuesStopsAndDoesNotInventAnActualModel(){flow("antigravity");ui.onNodeWithTag("backend-model-notice").assertTextContains("未提供",substring=true);screenshot("native-agy-backend.png")}
    @Test fun grokStartsContinuesAndStops(){flow("grok");screenshot("native-grok-backend.png")}
    @Test fun agyPlanModeSurvivesNativeSubmission(){setup("antigravity");ui.runOnUiThread{vm.newThread(vm.state.projects.first());vm.togglePlan();vm.draft("PLAN");vm.send()};ui.waitUntil(10000){commands.any{it.optString("type")=="thread.start"}};Assert.assertEquals("plan",commands.first{it.optString("type")=="thread.start"}.optString("mode"))}
    @Test fun unsupportedGrokModesReportAnErrorInsteadOfPretendingToEnable(){setup("grok");ui.runOnUiThread{vm.togglePlan()};Assert.assertTrue(vm.state.error.contains("计划模式"));Assert.assertEquals("default",vm.state.nextMode);ui.runOnUiThread{vm.toggleFast()};Assert.assertTrue(vm.state.error.contains("快速模式"))}
    @Test fun publicClaudeIsExplicitlyUnavailableAndCannotSend(){setup("claude",true);ui.runOnUiThread{vm.draft("must not send");vm.send()};Assert.assertTrue(vm.state.error.contains("公网"));Assert.assertTrue(commands.isEmpty());ui.onNodeWithTag("backend-model-notice").assertTextContains("已配对的局域网连接",substring=true)}
    @Test fun longAgyReplyKeepsExactBodyAcrossWebSocketAndReconnection(){
        setup("antigravity");ui.runOnUiThread{vm.newThread(vm.state.projects.first());vm.draft("LONG");vm.send()}
        ui.waitUntil(60000){!vm.state.running&&!vm.state.sending&&vm.state.events.any{it.text=="AGY_END"}}
        fun body()=nativeTimeline(vm.state.events,id).filter{it.event.type=="message.delta"}.joinToString(""){it.event.text}
        fun sha(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
        Assert.assertEquals(sha(longAnswer),sha(body()));Assert.assertEquals(longAnswer.length,body().length)
        ui.runOnUiThread{vm.disconnect();vm.connect(address,"fixture-token")};ui.waitUntil(15000){vm.state.connected&&vm.state.threads.any{it.id==id}}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first{it.id==id})};ui.waitUntil(60000){vm.state.events.any{it.text=="AGY_END"}}
        Assert.assertEquals(sha(longAnswer),sha(body()));Assert.assertEquals(1,commands.count{it.optString("type")=="thread.start"})
        app.filesDir.resolve("native-agy-integrity.json").writeText(JSONObject().put("chunkCount",6102).put("utf16Length",longAnswer.length).put("sha256",sha(longAnswer)).put("liveWebSocket",true).put("reconnectedHistory",true).put("realModelRequests",0).toString())
        screenshot("native-agy-long-complete.png")
    }
}
