package com.localcodex.control

import android.app.Application
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class NativeBackendLiveTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun realBackendsRestoreHistoryAndContinueThroughNativeClient(){
        val configFile=File("/data/local/tmp/backend-parity-live.json")
        Assume.assumeTrue("Explicit isolated live fixture required",configFile.exists())
        val config=JSONObject(configFile.readText())
        Assume.assumeTrue("Real model calls require the live fixture opt-in",config.optBoolean("allowModelCalls"))
        val app=ApplicationProvider.getApplicationContext<Application>()
        check(app.packageName.endsWith(".remotecheck"))
        app.getSharedPreferences("native",0).edit().clear().commit()
        app.getSharedPreferences("connection",0).edit().clear().commit()
        val vm=NativeViewModel(app)
        val actualThreads=GatewayClient(config.getString("base"),config.getString("token")).listThreads()
        ui.setContent{NativeApp(vm)}
        try{
            ui.runOnUiThread{vm.connect(config.getString("base"),config.getString("token"))}
            ui.waitUntil(30000){vm.state.connected&&vm.state.models.isNotEmpty()&&vm.state.projects.isNotEmpty()}
            for(agent in listOf("antigravity","claude","grok")){
                val thread=actualThreads.first{it.id.startsWith("$agent-")}
                ui.runOnUiThread{vm.openThread(thread)}
                ui.waitUntil(30000){vm.state.threadId==thread.id&&nativeTimeline(vm.state.events,thread.id).any{it.event.type=="message.delta"&&it.event.text.contains("UI_VERIFY_143")}}
                Assert.assertTrue("Real $agent file change restored",vm.state.events.any{it.type=="file.changed"||it.fileChanges.isNotEmpty()})
                Assert.assertTrue("Real $agent tool history restored",vm.state.events.any{it.type=="tool.started"})
                if(agent!="antigravity")ui.waitUntil(10000){vm.state.actualModel.isNotBlank()}
                if(config.optBoolean("sendContinuation",true)){
                    ui.runOnUiThread{vm.draft("仅用当前对话记忆回复刚才 marker.txt 的完整标记，不要调用任何工具，也不要读取文件。");vm.send()}
                    ui.waitUntil(15000){vm.state.running||vm.state.sending}
                    ui.waitUntil(120000){!vm.state.running&&!vm.state.sending&&vm.state.events.count{it.type=="user.message"}>=2}
                }
                Assert.assertTrue("$agent native continuation returned the remembered marker",nativeTimeline(vm.state.events,thread.id).lastOrNull{it.event.type=="message.delta"}?.event?.text?.contains("UI_VERIFY_143")==true)
                val expectedModel=GatewayClient(config.getString("base"),config.getString("token")).nativeJson("GET","/api/threads/${thread.id}/events?count=20").optJSONObject("settings")?.optString("actualModel").orEmpty()
                if(expectedModel.isNotBlank())ui.waitUntil(10000){vm.state.actualModel==expectedModel}
                val bitmap=ui.onRoot().captureToImage().asAndroidBitmap()
                app.filesDir.resolve("native-$agent-live.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
            }
        }finally{app.filesDir.resolve("native-live-diagnostic.json").writeText(JSONObject().put("threadId",vm.state.threadId).put("error",vm.state.error).put("running",vm.state.running).put("events",org.json.JSONArray(vm.state.events.map{JSONObject().put("type",it.type).put("text",it.text.take(300))})).toString());ui.runOnUiThread{vm.disconnect()}}
    }
}
