package com.localcodex.control

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class NotificationFlowTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private lateinit var context:Application
    private lateinit var server:MockWebServer
    private lateinit var manager:NotificationManager
    private val sockets=CopyOnWriteArrayList<WebSocket>()
    @Volatile private var history=JSONArray()

    @Before fun start(){
        context=ApplicationProvider.getApplicationContext()
        manager=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancelAll()
        context.getSharedPreferences("native",Context.MODE_PRIVATE).edit().putBoolean("notify.background",true).remove("notify.seen").commit()
        server=MockWebServer().apply{
            dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse {
                val path=request.requestUrl?.encodedPath.orEmpty()
                if(path=="/ws")return MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                    override fun onOpen(webSocket:WebSocket,response:Response){sockets.add(webSocket)}
                    override fun onClosing(webSocket:WebSocket,code:Int,reason:String){webSocket.close(code,reason)}
                })
                val body=when(path){
                    "/api/threads"->JSONObject().put("threads",JSONArray().put(JSONObject().put("id","t").put("title","完善统计信息").put("status","completed")))
                    "/api/threads/t/events"->JSONObject().put("events",history).put("status","completed")
                    else->JSONObject()
                }
                return MockResponse().setHeader("Content-Type","application/json").setBody(body.toString())
            }}
            start()
        }
        ConnectionStore(context).save(server.url("/").toString().trimEnd('/'),"test")
    }

    @After fun stop(){
        context.stopService(Intent(context,NotificationMonitorService::class.java))
        context.getSharedPreferences("native",Context.MODE_PRIVATE).edit().putBoolean("notify.background",false).remove("notify.seen").commit()
        context.getSharedPreferences("connection",Context.MODE_PRIVATE).edit().clear().commit()
        manager.cancelAll()
        sockets.forEach{it.close(1000,"test complete")}
        server.shutdown()
    }

    private fun event(type:String,id:String,text:String="",status:String="",replay:Boolean=false)=JSONObject().put("type",type).put("threadId","t").put("eventId",id).put("text",text).put("status",status).put("replayed",replay)
    private fun send(event:JSONObject){Assert.assertTrue(sockets.last().send(event.toString()))}
    private fun notices()=manager.activeNotifications.filter{it.tag?.startsWith("task:")==true}

    @Test fun foregroundClearsAndSuppressesSystemReminders(){
        fun reminders()=manager.activeNotifications.filter{it.notification.channelId==NotificationHelper.CHANNEL_TASK||it.notification.channelId==NotificationHelper.CHANNEL_APPROVAL}
        NotificationHelper.setAppForeground(context,false)
        try{
            NotificationHelper.notifyTask(context,"done","任务完成","内容","t")
            NotificationHelper.notifyApproval(context,"request","请求审批","内容","t")
            ui.waitUntil(5000){reminders().size==2}
            NotificationHelper.setAppForeground(context,true)
            ui.waitUntil(5000){reminders().isEmpty()}
            NotificationHelper.notifyTask(context,"foreground-done","任务完成","内容","other")
            NotificationHelper.notifyApproval(context,"foreground-request","请求审批","内容","other")
            Assert.assertTrue(reminders().isEmpty())
            NotificationHelper.setAppForeground(context,false)
            NotificationHelper.notifyTask(context,"background-done","任务完成","内容","other")
            ui.waitUntil(5000){reminders().size==1}
        }finally{NotificationHelper.setAppForeground(context,false)}
    }

    @Test fun quotaAndCapacityOnlyNotifyInsideThePageWithBackgroundMonitoringEnabled(){
        ui.runOnUiThread{context.startForegroundService(Intent(context,NotificationMonitorService::class.java))}
        ui.waitUntil(10000){sockets.isNotEmpty()}
        send(event("user.message","quota-start","测试额度"))
        send(event("error","quota-error","usage_limit_reached"))
        send(event("turn.completed","quota-done",status="error"))
        send(event("approval.requested","quota-barrier"))
        ui.waitUntil(10000){manager.activeNotifications.any{it.tag=="approval:quota-barrier"}}
        Thread.sleep(600)
        Assert.assertTrue("额度错误只在页面提醒",notices().isEmpty())
        send(event("user.message","capacity-start","测试容量"))
        // 错误晚于结束也不能触发状态栏任务失败通知。
        send(event("turn.completed","capacity-done",status="error"))
        send(event("error","capacity-error","UNAVAILABLE (code 503): No capacity available"))
        send(event("approval.requested","capacity-barrier"))
        ui.waitUntil(10000){manager.activeNotifications.any{it.tag=="approval:capacity-barrier"}}
        Thread.sleep(600)
        Assert.assertTrue("容量错误只在页面提醒",notices().isEmpty())
        send(event("user.message","next-start","普通任务"))
        send(event("message.delta","next-answer","已完成。"))
        send(event("turn.completed","next-done",status="completed"))
        ui.waitUntil(10000){notices().singleOrNull()?.notification?.extras?.getString(Notification.EXTRA_TEXT)=="已完成。"}
    }

    @Test fun lateFailureReasonNeverFlashesAModelErrorInTheStatusBar(){
        ui.runOnUiThread{context.startForegroundService(Intent(context,NotificationMonitorService::class.java))}
        ui.waitUntil(10000){sockets.isNotEmpty()}
        send(event("user.message","late-start","检查"))
        send(event("message.delta","progress","正在处理"))
        send(event("turn.completed","late-done",status="error"))
        send(event("approval.requested","before-error-barrier"))
        ui.waitUntil(10000){manager.activeNotifications.any{it.tag=="approval:before-error-barrier"}}
        Thread.sleep(1000)
        Assert.assertTrue("原因尚未到达时不能先发任务失败通知",notices().isEmpty())
        send(event("error","late-error","No capacity available"))
        send(event("approval.requested","after-error-barrier"))
        ui.waitUntil(10000){manager.activeNotifications.any{it.tag=="approval:after-error-barrier"}}
        Assert.assertTrue(notices().isEmpty())
        send(event("user.message","generic-start","下一轮"))
        send(event("turn.completed","generic-done",status="error"))
        send(event("approval.requested","generic-barrier"))
        ui.waitUntil(10000){manager.activeNotifications.any{it.tag=="approval:generic-barrier"}}
        Thread.sleep(600)
        send(event("error","generic-error","电脑进程意外退出"))
        ui.waitUntil(10000){notices().singleOrNull()?.notification?.extras?.getString(Notification.EXTRA_TEXT)=="电脑进程意外退出"}
    }

    @Test fun serviceShowsTheAnswerAndReplacesThePreviousTurnWithoutDuplicateAlerts(){
        NotificationHelper.ensureChannels(context)
        manager.notify("task:legacy",1002,Notification.Builder(context,NotificationHelper.CHANNEL_TASK).setSmallIcon(R.drawable.ic_notification).setContentTitle("任务已结束").setContentText("新对话").build())
        ui.runOnUiThread{context.startForegroundService(Intent(context,NotificationMonitorService::class.java))}
        ui.waitUntil(10000){sockets.isNotEmpty()}
        Assert.assertTrue("旧版错误通知应在启动时移除",notices().isEmpty())
        send(event("turn.completed","old",status="completed",replay=true))
        send(event("user.message","question","当前问题"))
        send(event("message.delta","answer-1","已完成统计"))
        send(event("message.delta","answer-2","与模型管理。"))
        val done=event("turn.completed","done",status="completed")
        history=JSONArray().put(event("user.message","question","当前问题")).put(event("message.delta","answer","已完成统计与模型管理。")).put(done)
        send(done)
        ui.waitUntil(10000){notices().singleOrNull()?.notification?.extras?.getString(Notification.EXTRA_TEXT)=="已完成统计与模型管理。"}
        val first=notices().single()
        Assert.assertEquals("任务已完成 · 完善统计信息",first.notification.extras.getString(Notification.EXTRA_TITLE))
        Assert.assertEquals("t",first.notification.extras.getString("taskThreadId"))
        send(event("turn.completed","duplicate",status="completed"))
        send(event("approval.requested","duplicate-barrier"))
        ui.waitUntil(10000){manager.activeNotifications.any{it.tag=="approval:duplicate-barrier"}}
        Assert.assertEquals("重复结束不能重新发出完成提醒",first.postTime,notices().single().postTime)
        val next=event("turn.completed","next-done",status="completed")
        send(event("user.message","next-question","下一轮问题"))
        send(event("message.delta","next-answer","下一轮已验证。"))
        history=JSONArray().put(event("user.message","next-question","下一轮问题")).put(event("message.delta","next-answer","下一轮已验证。")).put(next)
        send(next)
        ui.waitUntil(10000){notices().singleOrNull()?.notification?.extras?.getString(Notification.EXTRA_TEXT)=="下一轮已验证。"}
        Assert.assertEquals("task:t",notices().single().tag)
        val nextPostTime=notices().single().postTime
        val second=NotificationHelper.contentIntent(context,"other-thread")
        Assert.assertNotEquals("不同会话必须使用各自的点击 Intent",notices().single().notification.contentIntent,second)
        ui.runOnUiThread{context.stopService(Intent(context,NotificationMonitorService::class.java))}
        ui.waitUntil(10000){manager.activeNotifications.none{it.id==NotificationMonitorService.MONITOR_NOTIFICATION_ID}}
        val previousConnections=sockets.size
        ui.runOnUiThread{context.startForegroundService(Intent(context,NotificationMonitorService::class.java))}
        ui.waitUntil(10000){sockets.size>previousConnections}
        send(next)
        send(event("approval.requested","restart-barrier"))
        ui.waitUntil(10000){manager.activeNotifications.any{it.tag=="approval:restart-barrier"}}
        Assert.assertEquals("服务重启仍应记住已发出的轮次",nextPostTime,notices().single().postTime)
        send(event("turn.completed","next-replay",status="completed",replay=true))
        send(event("user.message","barrier","继续处理"))
        // 下一轮完成用于等待流处理结束，旧结束事件不能增加一条通知。
        send(event("turn.completed","barrier-done",status="interrupted"))
        ui.waitUntil(10000){notices().singleOrNull()?.notification?.extras?.getString(Notification.EXTRA_TITLE)?.startsWith("任务已中断")==true}
        Assert.assertEquals(1,notices().size)
    }
}
