package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.viewModelScope
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.launch
import okhttp3.*
import okhttp3.mockwebserver.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

@RunWith(AndroidJUnit4::class)
class NativeStreamRecoveryTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val server=MockWebServer()
    private val sockets=CopyOnWriteArrayList<WebSocket>()
    private val reads=AtomicInteger()
    private val delayNext=AtomicLong()
    @Volatile private var history="[]"
    private lateinit var vm:NativeViewModel
    private val application get()=ApplicationProvider.getApplicationContext<Application>()
    private fun event(i:Int,text:String="前文第 $i 段。\n\n",item:String="reply",id:String="delta-$i")=JSONObject()
        .put("type","message.delta").put("threadId","t").put("eventId",id).put("itemId",item).put("text",text)
        .put("createdAt","2026-10-04T06:26:%02dZ".format(i.coerceAtMost(59)))
    private fun body(events:List<JSONObject>)=JSONArray().apply{events.forEach{put(it)}}.toString()
    private fun currentText()=nativeTimeline(vm.state.events,"t",running=true).filter{it.event.type=="message.delta"}.joinToString(""){it.event.text}
    private fun refresh(){ui.runOnUiThread{vm.viewModelScope.launch{vm.refresh()}}}
    @Before fun setup(){
        check(application.packageName.endsWith(".remotecheck"))
        application.getSharedPreferences("native",0).edit().clear().commit()
        application.getSharedPreferences("connection",0).edit().clear().commit()
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse{
            fun json(text:String)=MockResponse().setHeader("Content-Type","application/json").setBody(text)
            return when(val path=request.requestUrl!!.encodedPath){
                "/health"->json("""{"ok":true,"protocolVersion":1,"minAndroidProtocolVersion":1}""")
                "/ws"->MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                    override fun onOpen(socket:WebSocket,response:Response){sockets.add(socket)}
                    override fun onClosing(socket:WebSocket,code:Int,reason:String){socket.close(code,reason)}
                })
                "/api/projects","/api/sidebar"->json("""{"projects":[],"allowedProjects":[]}""")
                "/api/threads"->json("""{"threads":[{"id":"t","title":"流式正文恢复","status":"running"}]}""")
                "/api/models"->json("""{"models":[]}""")
                "/api/approvals"->json("""{"approvals":[]}""")
                "/api/threads/t/events"->{
                    val snapshot=history;val delay=delayNext.getAndSet(0);reads.incrementAndGet()
                    json("""{"status":"running","hasMore":false,"events":$snapshot}""").setBodyDelay(delay,java.util.concurrent.TimeUnit.MILLISECONDS)
                }
                else->if(path.endsWith("/queue"))json("""{"messages":[],"canSteer":false}""") else json("{}")
            }
        }}
        server.start()
        val address=server.url("/").toString().trimEnd('/')
        ui.runOnUiThread{vm=NativeViewModel(application);vm.connect(address,"fixture")}
        ui.setContent{NativeApp(vm)}
        ui.waitUntil(15000){vm.state.connected&&vm.state.threads.isNotEmpty()&&sockets.isNotEmpty()}
    }
    @After fun cleanup(){ui.runOnUiThread{vm.disconnect()};server.shutdown()}
    private fun open(){ui.runOnUiThread{vm.openThread(vm.state.threads.first())};ui.waitUntil(15000){!vm.state.loadingHistory};ui.waitForIdle()}
    @Test fun delayedSuffixPollKeepsEveryFragmentAndTheReadingViewport(){
        val pieces=(0 until 350).map{event(it)}
        history=body(pieces);open()
        ui.waitUntil(10000){vm.state.events.size==350}
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,90f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0);ui.waitForIdle()
        fun position()=ui.onNodeWithTag("messages").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        fun textTop():Int{
            var top=Int.MIN_VALUE
            ui.runOnIdle{
                fun visit(view:android.view.View){
                    if(view is android.widget.TextView&&view.text.toString().startsWith("前文第 0 段。")){
                        val location=IntArray(2);view.getLocationOnScreen(location);top=location[1]
                    }
                    if(view is android.view.ViewGroup)for(i in 0 until view.childCount)visit(view.getChildAt(i))
                };visit(ui.activity.window.decorView)
            };return top
        }
        val before=position()
        val beforeTop=textTop();Assert.assertTrue(beforeTop!=Int.MIN_VALUE)
        history=body(pieces.takeLast(200));delayNext.set(1200)
        val previousReads=reads.get();refresh();ui.waitUntil(10000){reads.get()>previousReads}
        for(i in 350 until 380)sockets.first().send(event(i).toString())
        val expected=(0 until 380).joinToString(""){event(it).getString("text")}
        ui.waitUntil(10000){currentText()==expected}
        android.os.SystemClock.sleep(1800);ui.waitForIdle()
        Assert.assertEquals(expected,currentText())
        Assert.assertEquals("旧快照与追加内容不能移动阅读位置",before,position(),1f)
        Assert.assertEquals("实际正文在屏幕上的像素位置必须稳定",beforeTop,textTop())
        var displayed=""
        ui.runOnIdle{
            fun visit(view:android.view.View){
                if(view is android.widget.TextView&&view.text.toString().startsWith("前文第 0 段。"))displayed=view.text.toString()
                if(view is android.view.ViewGroup)for(i in 0 until view.childCount)visit(view.getChildAt(i))
            };visit(ui.activity.window.decorView)
        }
        Assert.assertTrue("实际 TextView 应保留首段及新末段",displayed.contains("前文第 0 段。")&&displayed.contains("前文第 379 段。"))
        val screenshot=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        java.io.File(application.getExternalFilesDir(null),"native-stream-prefix-147.png").outputStream().use{screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
    @Test fun finalizedSnapshotDoesNotDuplicateLiveOutputAndFollowingStillReachesTheEnd(){
        history=body(listOf(event(0,"正文开始\n\n")));open()
        val pieces=(1 until 50).map{event(it)}
        pieces.forEach{sockets.first().send(it.toString())}
        val expected="正文开始\n\n"+pieces.joinToString(""){it.getString("text")}
        ui.waitUntil(10000){currentText()==expected}
        history=body(listOf(event(59,expected,id="history:final").put("textComplete",true)));refresh()
        ui.waitUntil(10000){vm.state.events.singleOrNull()?.eventId=="history:final"};ui.waitForIdle()
        Assert.assertEquals(expected,currentText())
        // A delayed duplicate can arrive after polling replaced all live rows
        // with a complete saved item; its old ID is no longer a rendered row.
        sockets.first().send(pieces.last().toString())
        sockets.first().send(event(49,pieces.last().getString("text"),id="late-first-delivery").toString())
        android.os.SystemClock.sleep(200);ui.waitForIdle()
        Assert.assertEquals("完整历史替换后不能重复追加迟到的通知",expected,currentText())
        val range=ui.onNodeWithTag("messages").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
        Assert.assertTrue("保留正常的跟随末尾行为",range.maxValue()-range.value()<4f)
        ui.onNodeWithContentDescription("回到最新").assertDoesNotExist()
    }
}
