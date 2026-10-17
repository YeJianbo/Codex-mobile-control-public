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
    @Test fun menuRendersOfficialIconsAndConnectionFollowsSelectedHarness(){
        val app=ApplicationProvider.getApplicationContext<Application>()
        check(app.packageName.endsWith(".remotecheck"))
        app.getSharedPreferences("native",0).edit().clear().commit()
        app.getSharedPreferences("connection",0).edit().clear().commit()
        val statusReads=AtomicInteger();val forcedReads=AtomicInteger()
        val agents=listOf("codex","claude","antigravity","grok","deepseek","hermes")
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
            ui.waitUntil(10000){vm.state.connected&&vm.state.models.size==9}
            ui.onNodeWithContentDescription("展开侧栏").performClick()
            ui.onNodeWithContentDescription("切换助手").performClick()
            ui.onNodeWithText("Hermes").assertIsDisplayed()
            ui.onNodeWithText("DeepSeek Harness").assertIsDisplayed()
            screenshot(app,"harness-302-menu.png")
            ui.onNodeWithText("Hermes").performClick()
            ui.waitUntil(10000){vm.state.harness=="hermes"}
            ui.onNodeWithText("默认模型").performClick()
            ui.onNode(hasText("默认模型") and hasAnyAncestor(hasTestTag("modelControls"))).performClick()
            ui.onNodeWithText("gpt-6.1-sol").assertIsDisplayed()
            ui.onNodeWithText("gpt-6-astra").assertIsDisplayed()
            screenshot(app,"harness-303-models.png")
            ui.onNodeWithText("gpt-6.1-sol").performClick()
            Assert.assertEquals("hermes::openai-codex:gpt-6.1-sol",vm.state.model)
            androidx.test.espresso.Espresso.pressBack()
            ui.onNodeWithTag("connectionStatus").performClick()
            ui.waitUntil(10000){forcedReads.get()>=2&&!vm.state.backendStatusLoading}
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
            ui.waitUntil(10000){forcedReads.get()>=4&&!vm.state.backendStatusLoading}
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
