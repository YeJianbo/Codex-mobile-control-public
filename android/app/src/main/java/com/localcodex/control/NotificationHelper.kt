package com.localcodex.control

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Notification channels + posting helpers shared by NotificationMonitorService.
 * No new dependencies: only androidx.core (already pulled in by activity-compose).
 */
object NotificationHelper {
    const val CHANNEL_APPROVAL = "approval"
    const val CHANNEL_TASK = "task"
    const val CHANNEL_MONITOR = "monitor"

    private const val ID_APPROVAL = 1001
    private const val ID_TASK = 1002

    @Volatile private var appForeground=false

    internal fun setAppForeground(context:Context,visible:Boolean){
        appForeground=visible
        if(visible){
            val manager=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.activeNotifications.filter{it.notification.channelId==CHANNEL_TASK||it.notification.channelId==CHANNEL_APPROVAL}
                .forEach{manager.cancel(it.tag,it.id)}
        }
    }

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL_APPROVAL, "审批请求", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "电脑端 Codex 请求确认或回答时提醒"
            enableVibration(true)
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
        })
        manager.createNotificationChannel(NotificationChannel(CHANNEL_TASK, "任务完成", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "电脑端任务结束时提醒"
        })
        manager.createNotificationChannel(NotificationChannel(CHANNEL_MONITOR, "保持连接", NotificationManager.IMPORTANCE_MIN).apply {
            description = "后台提醒服务的前台通知"
            setShowBadge(false)
        })
        manager.activeNotifications.filter{it.tag?.startsWith("task:")==true&&!it.notification.extras.containsKey("taskThreadId")}
            .forEach{manager.cancel(it.tag,it.id)}
    }

    fun monitorNotification(context: Context): Notification {
        ensureChannels(context)
        return NotificationCompat.Builder(context, CHANNEL_MONITOR)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Codex 控制保持连接中")
            .setContentText("后台监听审批请求与任务完成")
            .setContentIntent(contentIntent(context))
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    /** 审批请求通知。key 用于 tag 去重：同一审批重复推送时只替换不叠加。 */
    fun notifyApproval(context: Context, key: String, title: String, body: String, threadId: String = "") {
        post(context, CHANNEL_APPROVAL, "approval:$key", ID_APPROVAL, title, body, NotificationCompat.CATEGORY_ALARM, threadId)
    }
    fun cancelApproval(context:Context,key:String){NotificationManagerCompat.from(context).cancel("approval:$key",ID_APPROVAL)}

    /** 任务完成通知。 */
    fun notifyTask(context: Context, key: String, title: String, body: String, threadId: String = "") {
        post(context, CHANNEL_TASK, "task:${threadId.ifBlank{key}}", ID_TASK, title, body, NotificationCompat.CATEGORY_STATUS, threadId)
    }

    internal fun canNotify(context:Context):Boolean {
        if(appForeground)return false
        if(!NotificationManagerCompat.from(context).areNotificationsEnabled())return false
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return false
        return true
    }

    private fun post(context: Context, channel: String, tag: String, id: Int, title: String, body: String, category: String, threadId: String) {
        if(!canNotify(context))return
        ensureChannels(context)
        val manager = NotificationManagerCompat.from(context)
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(category)
            .setAutoCancel(true)
            .addExtras(android.os.Bundle().apply{if(channel==CHANNEL_TASK)putString("taskThreadId",threadId)})
            .setContentIntent(contentIntent(context, threadId))
            .build()
        runCatching { manager.notify(tag, id, notification) }
    }

    internal fun contentIntent(context: Context, threadId: String = ""): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData(android.net.Uri.Builder().scheme("codex-control").authority("thread").appendPath(threadId).build())
            .putExtra("notificationThreadId", threadId)
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
