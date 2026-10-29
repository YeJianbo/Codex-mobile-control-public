package com.localcodex.control

import android.app.Application
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.mockwebserver.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class NativeHarnessSwitchTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun pendingReceiptDoesNotBlockHarnessSwitchOrMoveItsMessage(){
        val app=ApplicationProvider.getApplicationContext<Application>()
        check(app.packageName.endsWith(".remotecheck"))
        app.getSharedPreferences("native",0).edit().clear().commit()
        app.getSharedPreferences("connection",0).edit().clear().commit()
        val commands=java.util.concurrent.CopyOnWriteArrayList<JSONObject>()
        val sockets=java.util.concurrent.CopyOnWriteArrayList<WebSocket>()
        val slowListStarted=java.util.concurrent.CountDownLatch(1)
        val releaseOldList=java.util.concurrent.CountDownLatch(1)
        val slowCodexList=java.util.concurrent.atomic.AtomicBoolean(false)
        val agyLists=AtomicInteger()
        val server=MockWebServer()
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            fun json(value:String)=MockResponse().setHeader("Content-Type","application/json").setBody(value)
            return when(request.requestUrl!!.encodedPath){
                "/health"->json("""{"ok":true,"protocolVersion":1,"minAndroidProtocolVersion":1}""")
                "/ws"->MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                    override fun onOpen(socket:WebSocket,response:Response){sockets.add(socket);socket.send("""{"type":"connected"}""")}
                    override fun onMessage(socket:WebSocket,text:String){commands.add(JSONObject(text))}
                    override fun onClosing(socket:WebSocket,code:Int,reason:String){socket.close(code,reason)}
                })
                "/api/models"->json("""{"models":[{"model":"gpt-6.1-sol","displayName":"Sol"},{"model":"antigravity::default","displayName":"Antigravity"}],"backends":[{"agent":"codex","available":true},{"agent":"antigravity","available":true}]}""")
                "/api/sidebar"->json("""{"projects":[],"allowedProjects":[]}""")
                "/api/threads"->{
                    if(request.requestUrl!!.queryParameter("agent")=="antigravity"){
                        agyLists.incrementAndGet();json("""{"threads":[]}""")
                    }else{
                        if(slowCodexList.get()){slowListStarted.countDown();releaseOldList.await(60,java.util.concurrent.TimeUnit.SECONDS)}
                        json("""{"threads":[{"id":"fixture-codex","title":"原会话","status":"completed"}]}""")
                    }
                }
                "/api/threads/fixture-codex/events"->json("""{"events":[],"status":"completed"}""")
                "/api/threads/fixture-codex/submission"->json("""{"submission":{"state":"pending"}}""")
                else->json("{}")
            }
        }}
        server.start();val vm=NativeViewModel(app)
        try{
            ui.setContent{NativeApp(vm)}
            ui.runOnUiThread{vm.connect(server.url("/").toString().trimEnd('/'),"fixture")}
            ui.waitUntil(10000){vm.state.connected&&vm.state.models.size==2&&vm.state.threads.isNotEmpty()}
            slowCodexList.set(true)
            ui.runOnUiThread{vm.openThread(ThreadRecord("fixture-codex",title="原会话"))}
            ui.waitUntil(10000){slowListStarted.count==0L&&!vm.state.loadingHistory}
            ui.runOnUiThread{vm.draft("仅发给原会话");vm.send()}
            ui.waitUntil(5000){commands.any{it.optString("text")=="仅发给原会话"}}
            ui.onNodeWithContentDescription("展开侧栏").performClick()
            ui.onNodeWithContentDescription("切换助手").performTouchInput{click()}
            Assert.assertTrue("切换时原消息仍在等待回执",vm.state.sending)
            ui.onNodeWithText("Antigravity").performTouchInput{click()}
            Assert.assertEquals("等待旧回执时仍应立即切换","antigravity",vm.state.harness)
            Assert.assertTrue("新助手不应继承旧会话或消息",vm.state.threadId.isBlank()&&vm.state.draft.isBlank())
            ui.waitUntil(10000){agyLists.get()>0}
            val sent=commands.single{it.optString("text")=="仅发给原会话"}
            sockets.last().send(JSONObject().put("type","user.message").put("threadId","fixture-codex")
                .put("eventId","late-receipt").put("requestId",sent.optString("requestId")).put("text","仅发给原会话").toString())
            releaseOldList.countDown()
            ui.waitUntil(5000){app.getSharedPreferences("native",0).all.keys.none{it.startsWith("send:")}}
            Assert.assertEquals("antigravity",vm.state.harness)
            Assert.assertTrue(vm.state.threadId.isBlank()&&vm.state.draft.isBlank())
            Assert.assertEquals(1,commands.count{it.optString("text")=="仅发给原会话"})
            repeat(3){
                ui.onNodeWithContentDescription("切换助手").performTouchInput{click()}
                ui.onNode(hasText("Codex") and hasAnyAncestor(hasTestTag("modernDropdown"))).performTouchInput{click()}
                Assert.assertEquals("codex",vm.state.harness)
                ui.onNodeWithContentDescription("切换助手").performTouchInput{click()}
                ui.onNodeWithText("Antigravity").performTouchInput{click()}
                Assert.assertEquals("antigravity",vm.state.harness)
            }
        }finally{releaseOldList.countDown();ui.runOnUiThread{vm.disconnect()};server.shutdown()}
    }
    @Test fun menuRendersOfficialIconsAndConnectionFollowsSelectedHarness(){
        val app=ApplicationProvider.getApplicationContext<Application>()
        check(app.packageName.endsWith(".remotecheck"))
        app.getSharedPreferences("native",0).edit().clear().commit()
        app.getSharedPreferences("connection",0).edit().clear().commit()
        val statusReads=AtomicInteger();val forcedReads=AtomicInteger()
        val agents=listOf("codex","claude","antigravity","grok","deepseek","hermes","opencode")
        val catalog=JSONObject().put("models",JSONArray(agents.map{JSONObject().put("model",if(it=="codex")"gpt-6.1-sol" else "$it::default").put("displayName",nativeAgentName(it)).put("supportedReasoningEfforts",JSONArray())})).put("backends",JSONArray(agents.drop(1).map{JSONObject().put("agent",it).put("installed",true).put("available",true)}))
        val rows=catalog.getJSONArray("models")
        for(index in 1 until rows.length())rows.getJSONObject(index).put("displayName",nativeAgentName(agents[index])+" · 默认模型")
        rows.put(JSONObject().put("model","hermes::openai-codex:gpt-6.1-sol").put("displayName","Hermes · ChatGPT or Codex Subscription · gpt-6.1-sol").put("supportedReasoningEfforts",JSONArray()))
        rows.put(JSONObject().put("model","hermes::openai-codex:gpt-6-astra").put("displayName","Hermes · ChatGPT or Codex Subscription · gpt-6-astra").put("supportedReasoningEfforts",JSONArray()))
        val custom="deepseek::[\"deepseek-official\",\"ecnu-max\"]"
        rows.put(JSONObject().put("model",custom).put("displayName","DeepSeek Harness · ecnu-max").put("supportedReasoningEfforts",JSONArray()))
        val server=MockWebServer()
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            fun json(value:Any)=MockResponse().setHeader("Content-Type","application/json").setBody(value.toString())
            return when(request.requestUrl!!.encodedPath){
                "/health"->json("""{"ok":true,"protocolVersion":1,"minAndroidProtocolVersion":1}""")
                "/ws"->MockResponse().withWebSocketUpgrade(object:WebSocketListener(){override fun onOpen(socket:WebSocket,response:Response){socket.send("""{"type":"connected"}""")};override fun onClosing(socket:WebSocket,code:Int,reason:String){socket.close(code,reason)}})
                "/api/models"->{if(request.requestUrl!!.queryParameter("refresh")=="1")forcedReads.incrementAndGet();json(catalog)}
                "/api/codex/status"->{statusReads.incrementAndGet();json("""{"codex":{"running":true,"initialized":true}}""")}
                "/api/projects"->json("""{"projects":[]}""")
                "/api/sidebar"->json("""{"projects":[],"allowedProjects":[]}""")
                "/api/threads"->json("""{"threads":[]}""")
                else->json("{}")
            }
        }}
        server.start();val address=server.url("/").toString().trimEnd('/');val vm=NativeViewModel(app)
        try{
            ui.setContent{NativeApp(vm)}
            ui.runOnUiThread{vm.connect(address,"fixture")}
            ui.waitUntil(10000){vm.state.connected&&vm.state.models.size==10}
            ui.onNodeWithContentDescription("展开侧栏").performClick()
            ui.onNodeWithContentDescription("切换助手").performClick()
            ui.onNodeWithText("Hermes").assertIsDisplayed()
            ui.onNodeWithText("DeepSeek Harness").assertIsDisplayed()
            screenshot(app,"harness-302-menu.png")
            ui.onNodeWithText("Hermes").performClick()
            ui.waitUntil(10000){vm.state.harness=="hermes"}
            ui.onNodeWithText("默认模型").performClick()
            ui.onNode(hasText("默认模型") and hasAnyAncestor(hasTestTag("modelControls"))).performClick()
            ui.onNodeWithText("6.1 Sol").assertIsDisplayed()
            ui.onNodeWithText("6 Astra").assertIsDisplayed()
            screenshot(app,"harness-303-models.png")
            ui.onNodeWithText("6.1 Sol").performClick()
            Assert.assertEquals("hermes::openai-codex:gpt-6.1-sol",vm.state.model)
            androidx.test.espresso.Espresso.pressBack()
            ui.onNodeWithTag("connectionStatus").performClick()
            ui.onNodeWithTag("harnessConnectionStatus").assertIsDisplayed()
            val hermesReads=forcedReads.get()
            ui.onNodeWithText("重新检查 Hermes").performClick()
            ui.waitUntil(10000){forcedReads.get()>hermesReads&&!vm.state.backendStatusLoading}
            ui.onNodeWithTag("harnessConnectionStatus").assertTextEquals("Hermes 已就绪")
            ui.onNodeWithTag("codexConnectionStatus").assertDoesNotExist()
            Assert.assertEquals(0,statusReads.get())
            ui.onNodeWithContentDescription("关闭").performClick()
            ui.onNodeWithContentDescription("展开侧栏").performClick()
            ui.onNodeWithContentDescription("切换助手").performClick()
            ui.onNodeWithText("DeepSeek Harness").performClick()
            ui.waitUntil(10000){vm.state.harness=="deepseek"}
            ui.onNodeWithText("默认模型").performClick()
            ui.onNode(hasText("默认模型") and hasAnyAncestor(hasTestTag("modelControls"))).performClick()
            ui.onNodeWithText("ecnu-max").assertIsDisplayed().performClick()
            Assert.assertEquals(custom,vm.state.model)
            androidx.test.espresso.Espresso.pressBack()
            ui.onNodeWithTag("connectionStatus").performClick()
            ui.onNodeWithTag("harnessConnectionStatus").assertIsDisplayed()
            val deepseekReads=forcedReads.get()
            ui.onNodeWithText("重新检查 DeepSeek Harness").performClick()
            ui.waitUntil(10000){forcedReads.get()>deepseekReads&&!vm.state.backendStatusLoading}
            ui.onNodeWithTag("harnessConnectionStatus").assertTextEquals("DeepSeek Harness 已就绪")
            ui.onNodeWithTag("codexConnectionStatus").assertDoesNotExist()
            Assert.assertEquals(0,statusReads.get());Assert.assertTrue(forcedReads.get()>=2)
            screenshot(app,"harness-302-connection.png")
        }finally{ui.runOnUiThread{vm.disconnect()};server.shutdown()}
    }
    private fun screenshot(app:Application,name:String){
        val bitmap=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try{app.getExternalFilesDir(null)!!.resolve(name).outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}}finally{bitmap.recycle()}
    }
}
