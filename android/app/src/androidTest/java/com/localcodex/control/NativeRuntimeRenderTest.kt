package com.localcodex.control

import android.app.Application
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Choreographer
import android.view.FrameMetrics
import android.view.KeyEvent
import android.view.Window
import android.view.accessibility.AccessibilityNodeInfo
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.launch
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response
import okhttp3.mockwebserver.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

/** Uses MainActivity's normal recomposer and real clock, without a Compose test rule. */
@RunWith(AndroidJUnit4::class)
class NativeRuntimeRenderTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private fun main(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun awaitState(message:String,condition:()->Boolean){
        val deadline=SystemClock.uptimeMillis()+10000
        while(!condition()&&SystemClock.uptimeMillis()<deadline)SystemClock.sleep(25)
        assertTrue(message,condition())
    }
    private fun node(label:String):AccessibilityNodeInfo {
        var result:AccessibilityNodeInfo?=null
        fun find(current:AccessibilityNodeInfo?):AccessibilityNodeInfo? {
            if(current==null)return null
            if(current.text?.toString()==label||current.contentDescription?.toString()==label)return current
            for(index in 0 until current.childCount)find(current.getChild(index))?.let{return it}
            return null
        }
        awaitState("未找到 $label"){
            val automation=instrumentation.uiAutomation
            result=(automation.windows.map{it.root}+automation.rootInActiveWindow).firstNotNullOfOrNull{find(it)}
            result!=null
        }
        var found=result!!
        while(!found.isClickable&&found.parent!=null)found=found.parent
        return found
    }
    private data class Phase(val name:String,val start:Long,@Volatile var end:Long=Long.MAX_VALUE)
    private data class Draw(val timestamp:Long,val total:Long,val layout:Long,val draw:Long,val sync:Long,val issue:Long,val swap:Long,val delay:Long)

    @Test fun queueMenuAndQuestionUseRealRuntimeFrames(){
        val app=ApplicationProvider.getApplicationContext<Application>()
        check(app.packageName.endsWith(".remotecheck"))
        val automation=instrumentation.uiAutomation
        automation.serviceInfo=automation.serviceInfo.apply{flags=flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS}
        listOf("native","connection","sidebar").forEach{app.getSharedPreferences(it,0).edit().clear().commit()}
        val server=MockWebServer()
        val queued=CopyOnWriteArrayList<JSONObject>()
        val question=AtomicBoolean(false)
        val answered=AtomicBoolean(false)
        val detail=JSONObject().put("questions",JSONArray().put(JSONObject().put("id","choice").put("question","检查真实动画运行").put("options",JSONArray().put(JSONObject().put("label","继续检查"))))).toString()
        val text=(1..40).joinToString("\n\n"){"### 段落 $it\n\n这里是运行中的 **格式化正文**，包含 [文档](P:/workspace/note.md)，用于记录正常时钟下的布局和绘制。"}
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse {
            fun json(body:String)=MockResponse().setHeader("Content-Type","application/json").setBody(body)
            val path=request.requestUrl!!.encodedPath
            return when {
                path=="/health"->json("""{"ok":true,"protocolVersion":1,"minAndroidProtocolVersion":1}""")
                path=="/ws"->MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                    override fun onOpen(socket:WebSocket,response:Response){socket.send("""{"type":"connected"}""")}
                    override fun onClosing(socket:WebSocket,code:Int,reason:String){socket.close(code,reason)}
                })
                path=="/api/projects"->json("""{"projects":[]}""")
                path=="/api/sidebar"->json("""{"projects":[],"allowedProjects":[]}""")
                path=="/api/threads"->json("""{"threads":[{"id":"runtime","title":"真实时钟检查","projectPath":"P:/workspace","status":"running"}]}""")
                path=="/api/models"->json("""{"models":[{"model":"gpt-6-sol","displayName":"Sol","supportedReasoningEfforts":[{"reasoningEffort":"high"}]}]}""")
                path.endsWith("/events")->json(JSONObject().put("status","running").put("hasMore",false).put("events",JSONArray().put(JSONObject().put("type","message.delta").put("threadId","runtime").put("eventId","history:runtime").put("text",text))).toString())
                path.endsWith("/queue")&&request.method=="POST"->{
                    val message=JSONObject(request.body.readUtf8()).put("status","queued").put("canSteer",true)
                    queued.add(message)
                    json(JSONObject().put("message",message).toString()).setHeadersDelay(350,java.util.concurrent.TimeUnit.MILLISECONDS)
                }
                path.endsWith("/queue")->json(JSONObject().put("canSteer",true).put("messages",JSONArray(queued)).toString())
                path=="/api/approvals"->json(JSONObject().put("approvals",JSONArray().apply{if(question.get()&&!answered.get())put(JSONObject().put("id","runtime-question").put("threadId","runtime").put("status","pending").put("approvalType","question").put("detail",detail))}).toString())
                path.endsWith("/runtime-question/answer")->{answered.set(true);json("{}")}
                else->json("{}")
            }
        }}
        server.start()
        val address=server.url("/").toString().trimEnd('/')
        val phases=CopyOnWriteArrayList<Phase>()
        val draws=CopyOnWriteArrayList<Draw>()
        val intervals=CopyOnWriteArrayList<Pair<Long,Double>>()
        val handlerThread=HandlerThread("runtime-frame-metrics").apply{start()}
        val listener=Window.OnFrameMetricsAvailableListener{_,metrics,_->draws.add(Draw(
            metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP),metrics.getMetric(FrameMetrics.TOTAL_DURATION),
            metrics.getMetric(FrameMetrics.LAYOUT_MEASURE_DURATION),metrics.getMetric(FrameMetrics.DRAW_DURATION),
            metrics.getMetric(FrameMetrics.SYNC_DURATION),metrics.getMetric(FrameMetrics.COMMAND_ISSUE_DURATION),
            metrics.getMetric(FrameMetrics.SWAP_BUFFERS_DURATION),metrics.getMetric(FrameMetrics.UNKNOWN_DELAY_DURATION))) }
        var previous=0L
        lateinit var callback:Choreographer.FrameCallback
        lateinit var vm:NativeViewModel
        lateinit var window:Window
        var initialized=false
        var tracing=false
        var refreshRate=0f
        val scenario=ActivityScenario.launch(MainActivity::class.java)
        try{
            scenario.onActivity{activity->
                window=activity.window;refreshRate=activity.window.decorView.display.refreshRate
                vm=ViewModelProvider(activity).get(NativeViewModel::class.java)
                vm.connect(address,"fixture")
                window.addOnFrameMetricsAvailableListener(listener,Handler(handlerThread.looper))
                callback=Choreographer.FrameCallback{time->
                    if(previous>0)intervals.add(time to (time-previous)/1_000_000.0)
                    previous=time;Choreographer.getInstance().postFrameCallback(callback)
                }
                Choreographer.getInstance().postFrameCallback(callback)
                initialized=true
            }
            awaitState("连接未完成"){vm.state.connected&&vm.state.threads.isNotEmpty()}
            if(InstrumentationRegistry.getArguments().getString("sampleMethods")=="true"){
                android.os.Debug.startMethodTracingSampling(java.io.File(app.getExternalFilesDir(null),"native-runtime.trace").absolutePath,16*1024*1024,2000)
                tracing=true
            }
            fun phase(name:String,duration:Long=1200,onMain:Boolean=true,action:()->Unit){
                lateinit var current:Phase
                main{current=Phase(name,System.nanoTime());phases.add(current)}
                if(onMain)main(action) else action()
                SystemClock.sleep(duration)
                main{current.end=System.nanoTime()}
            }
            phase("conversation",2500){vm.openThread(vm.state.threads.first())}
            awaitState("正文未显示"){!vm.state.loadingHistory&&vm.state.events.isNotEmpty()}
            main{vm.draft("继续检查实际入队动画")};SystemClock.sleep(300)
            phase("enqueue"){vm.send()}
            awaitState("消息未入队"){!vm.state.sending&&vm.state.queue.isNotEmpty()}
            val menu=node("待发消息操作")
            phase("queue-menu",onMain=false){assertTrue(menu.performAction(AccessibilityNodeInfo.ACTION_CLICK))}
            node("改为引导")
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);SystemClock.sleep(250)
            question.set(true)
            phase("question-open"){vm.viewModelScope.launch{vm.refresh()}}
            val option=node("继续检查")
            assertTrue(option.performAction(AccessibilityNodeInfo.ACTION_CLICK));SystemClock.sleep(250)
            val submit=node("提交回答")
            phase("question-submit",onMain=false){assertTrue(submit.performAction(AccessibilityNodeInfo.ACTION_CLICK))}
            awaitState("回答未提交"){"runtime-question" in vm.state.approvals}
            SystemClock.sleep(100)
            val results=JSONArray()
            phases.forEach{phase->
                val rendered=draws.filter{it.timestamp in phase.start..phase.end}
                val gaps=intervals.filter{it.first in phase.start..phase.end}.map{it.second}
                fun stats(values:List<Double>):JSONObject {
                    val sorted=values.sorted()
                    return JSONObject().put("count",sorted.size).put("maxMs",sorted.lastOrNull()).put("p95Ms",sorted.getOrNull(((sorted.size-1)*0.95).toInt().coerceAtLeast(0))).put("over33ms",values.count{it>33.4})
                }
                val worst=rendered.maxByOrNull{it.total}
                val row=JSONObject().put("phase",phase.name).put("activityFrames",stats(rendered.map{it.total/1_000_000.0})).put("mainFrameIntervals",stats(gaps))
                worst?.let{row.put("worstFrame",JSONObject().put("layoutMs",it.layout/1e6).put("drawMs",it.draw/1e6).put("syncMs",it.sync/1e6).put("issueMs",it.issue/1e6).put("swapMs",it.swap/1e6).put("delayMs",it.delay/1e6))}
                results.put(row);android.util.Log.i("RuntimeFrames",row.toString())
                assertTrue("${phase.name} 没有真实时钟回调",gaps.size>=10)
                if(phase.name!="queue-menu")assertTrue("${phase.name} 没有实际绘制",rendered.isNotEmpty())
            }
            val report=JSONObject().put("version",BuildConfig.VERSION_NAME).put("debug",BuildConfig.DEBUG).put("refreshRate",refreshRate).put("model",android.os.Build.MODEL).put("clock","MainActivity normal runtime").put("phases",results)
            java.io.File(app.getExternalFilesDir(null),"native-runtime-frames.json").writeText(report.toString(2))
        }finally{
            if(tracing)android.os.Debug.stopMethodTracing()
            main{if(initialized){vm.disconnect();window.removeOnFrameMetricsAvailableListener(listener);Choreographer.getInstance().removeFrameCallback(callback)}}
            scenario.close();handlerThread.quitSafely();handlerThread.join();server.shutdown()
        }
    }
}
