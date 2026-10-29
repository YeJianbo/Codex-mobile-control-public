package com.localcodex.control

import android.app.Service
import android.content.Intent
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlin.coroutines.coroutineContext

/**
 * Foreground service that keeps a lightweight gateway WebSocket alive while the app
 * is in the background and raises local notifications for approval requests and
 * completed turns. Connection failures stay silent (foreground notification only).
 */
class NotificationMonitorService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var monitor: Job? = null
    private var networkMonitor:NativeNetworkMonitor?=null
    private val notifiedKeys = LinkedHashSet<String>()
    private val threadTitles = mutableMapOf<String, String>()
    private val subagentThreads = mutableSetOf<String>()
    private val tasks = TaskNotificationTracker()
    private val pageOnlyFailures = linkedSetOf<String>()

    private val routeListener=android.content.SharedPreferences.OnSharedPreferenceChangeListener{_,key->
        if(key=="route"&&monitor!=null){monitor?.cancel();monitor=scope.launch{watch()}}
    }
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        networkMonitor=NativeNetworkMonitor(this){
            if(monitor!=null){monitor?.cancel();monitor=scope.launch{watch()}}
        }
        getSharedPreferences("connection",MODE_PRIVATE).registerOnSharedPreferenceChangeListener(routeListener)
        NotificationHelper.ensureChannels(this)
        notifiedKeys.addAll(getSharedPreferences("native",MODE_PRIVATE).getStringSet("notify.seen",emptySet()).orEmpty())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(MONITOR_NOTIFICATION_ID, NotificationHelper.monitorNotification(this))
        if (!getSharedPreferences("native", MODE_PRIVATE).getBoolean("notify.background", false)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (monitor?.isActive != true) monitor = scope.launch { watch() }
        return START_STICKY
    }

    override fun onDestroy() {
        networkMonitor?.close();networkMonitor=null
        getSharedPreferences("connection",MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(routeListener)
        monitor?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun watch() {
        var attempts = 0
        while (coroutineContext.isActive) {
            val store = ConnectionStore(this@NotificationMonitorService)
            val baseUrl = store.baseUrl()
            val token = store.token()
            if (baseUrl.isBlank() || token.isBlank()) {
                delay(UNCONFIGURED_RETRY_MS) // 未配置网关：静默等待，稍后重试
                continue
            }
            val remote = store.publicUrl().trim().trimEnd('/')
            val candidates = connectionRouteCandidates(baseUrl,remote,store.remotePassword(),store.route())
            for ((index,candidate) in candidates.withIndex()) {
                if(index==1&&candidate==baseUrl)delay(1000)
                val publicConnection = candidate == remote && remote.isNotBlank()
                var opened=false
                val client = GatewayClient(
                    candidate,
                    token,
                    remotePassword = if (publicConnection) store.remotePassword() else "",
                    certificateSha256 = if (publicConnection) "" else store.certificateSha256(),
                    useDeviceCertificate = true,
                )
                try {
                  supervisorScope {
                    val work=NativeNotificationWork(this)
                    val pendingFailures=linkedMapOf<String,ChatEvent>()
                    val threadLoads=NativeSharedLoads<Unit,List<ThreadRecord>>(this)
                    suspend fun loadThreads():List<ThreadRecord>{
                        val rows=threadLoads.get(Unit){client.listThreadsAsync()}
                        rows.forEach{threadTitles[it.id]=it.title;if(it.subagent!=null)subagentThreads.add(it.id)}
                        return rows
                    }
                    try {
                    client.events(deferActivities=true,streamThreadId="").collect { event ->
                        if (event.type == "connection.opened") {
                            opened=true
                            attempts = 0
                            work.launch("metadata"){loadThreads()}
                        }
                        handle(event,client,work,pendingFailures,::loadThreads)
                    }
                    }finally{work.clear();threadLoads.clear()}
                  }
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    // 连接失败静默重试，不发错误通知。
                }
                if(opened&&!publicConnection)break
            }
            attempts++
            delay((1000L * attempts).coerceAtMost(RETRY_CAP_MS))
        }
    }

    private fun handle(event: ChatEvent,client:GatewayClient,work:NativeNotificationWork,pendingFailures:MutableMap<String,ChatEvent>,loadThreads:suspend ()->List<ThreadRecord>) {
        if (event.type == "thread.started" && event.threadId.isNotBlank() && event.title.isNotBlank()) threadTitles[event.threadId] = event.title
        val taskEnded=tasks.accept(event)
        if (event.replayed) return
        if(event.type in setOf("turn.started","user.message")){work.cancel("task:${event.threadId}");pageOnlyFailures.remove(event.threadId);pendingFailures.remove(event.threadId)}
        if(event.type=="error"&&modelServiceIssue(event.text+"\n"+event.detail)!=null){
            pageOnlyFailures.add(event.threadId)
            if(pageOnlyFailures.size>100)pageOnlyFailures.remove(pageOnlyFailures.first())
        }
        if(event.type=="error")pendingFailures[event.threadId]?.let{completion->work.launch("task:${event.threadId}"){notifyTaskCompletion(completion,client,pendingFailures,loadThreads,event)}}
        when (event.type) {
            "approval.resolved" -> {work.cancel("approval:${event.approvalId}");NotificationHelper.cancelApproval(this,event.approvalId)}
            "goal.completed" -> {
                work.cancel("task:${event.threadId}");pendingFailures.remove(event.threadId)
                if(event.threadId in subagentThreads)return
                val notice=goalNotification(event,threadTitles[event.threadId].orEmpty())?:return
                if(rememberKey("goal:${notice.key}"))NotificationHelper.notifyTask(this,notice.key,notice.title,notice.body,notice.threadId)
            }
            "approval.requested" -> {
                val key=event.approvalId
                if(key.isBlank()||event.threadId.isBlank()||"approval:$key" in notifiedKeys||work.running("approval:$key")||!NotificationHelper.canNotify(this))return
                work.launch("approval:$key"){
                    delay(250)
                    if(!NotificationHelper.canNotify(this))return@launch
                    if(event.approvalType!="question"){
                        val policy=client.nativeJsonAsync("GET","/api/settings/remote-approval")
                        if(policy.opt("desktopAutoApprove")!=false)return@launch
                    }
                    val rows=client.nativeJsonAsync("GET","/api/approvals?threadId=${java.net.URLEncoder.encode(event.threadId,"UTF-8")}").getJSONArray("approvals")
                    val pending=(0 until rows.length()).any{index->val row=rows.getJSONObject(index);row.optString("id")==key&&row.optString("threadId")==event.threadId&&row.optString("status")=="pending"}
                    if(!pending||!NotificationHelper.canNotify(this)||!rememberKey("approval:$key"))return@launch
                    val title=if(event.approvalType=="question")"有问题待回答" else "需要你的确认"
                    NotificationHelper.notifyApproval(this@NotificationMonitorService,key,title,approvalBody(event),event.threadId)
                }
            }
            "turn.completed" -> {
                if(!taskEnded)return
                val key = event.eventId.ifBlank { "${event.threadId}:${event.createdAt}" }
                if (key.isBlank() || !rememberKey("turn:$key")) return
                if(!NotificationHelper.canNotify(this)){pendingFailures.remove(event.threadId);return}
                if(event.status.lowercase() in setOf("error","failed")){
                    // Codex 可能先发结束、再发错误；明确原因前不发送失败通知。
                    pendingFailures[event.threadId]=event
                    if(pendingFailures.size>100)pendingFailures.remove(pendingFailures.keys.first())
                }
                work.launch("task:${event.threadId}"){notifyTaskCompletion(event,client,pendingFailures,loadThreads)}
            }
        }
    }

    private suspend fun notifyTaskCompletion(event:ChatEvent,client:GatewayClient,pendingFailures:MutableMap<String,ChatEvent>,loadThreads:suspend ()->List<ThreadRecord>,errorHint:ChatEvent?=null){
        if(event.subagent||event.threadId in subagentThreads)return
        // Foreground completions are handled by the page. Avoid fetching a list
        // and transcript for a system notification that cannot be posted.
        fun eligible():Boolean {
            if(NotificationHelper.canNotify(this))return true
            if(pendingFailures[event.threadId]==event)pendingFailures.remove(event.threadId)
            return false
        }
        if(!eligible())return
        // An agent can be spawned after this socket connected. Recheck metadata
        // before posting so a fast child completion never relies on an old list.
        val current=try{loadThreads().find{it.id==event.threadId}}catch(error:CancellationException){throw error}catch(_:Exception){null}
        if(current?.subagent!=null){subagentThreads.add(event.threadId);pendingFailures.remove(event.threadId);return}
        if(!eligible())return
        val failed=event.status.lowercase() in setOf("error","failed")
        if(failed&&event.threadId in pageOnlyFailures){pendingFailures.remove(event.threadId);return}
        val notice=if(errorHint!=null)taskNotification(event,listOf(event,errorHint),emptyList(),threadTitles[event.threadId].orEmpty()) else {
            val history=try{client.nativeTaskHistoryAsync(event.threadId)}catch(error:CancellationException){throw error}catch(_:Exception){emptyList()}
            tasks.content(event,history,threadTitles[event.threadId].orEmpty())
        }
        if(failed){
            if(pendingFailures[event.threadId]!=event)return
            if(event.threadId in pageOnlyFailures||modelServiceIssue(notice.failureReason)!=null){pendingFailures.remove(event.threadId);return}
            if(notice.failureReason.isBlank())return
            pendingFailures.remove(event.threadId)
        }
        NotificationHelper.notifyTask(this@NotificationMonitorService,notice.key,notice.title,notice.body,notice.threadId)
    }

    private fun approvalBody(event: ChatEvent): String {
        val headline = if (event.approvalType == "question") questionHeadline(event.detail) else ""
        val firstLine = event.detail.lineSequence().firstOrNull { it.isNotBlank() }?.trim().orEmpty()
        return listOf(event.title, headline.ifBlank { firstLine })
            .filter { it.isNotBlank() }
            .joinToString(" · ")
            .take(180)
    }

    private fun questionHeadline(detail: String): String = runCatching {
        val questions = org.json.JSONObject(detail).getJSONArray("questions")
        (0 until questions.length()).asSequence()
            .map { questions.getJSONObject(it).optString("question") }
            .firstOrNull { it.isNotBlank() }
    }.getOrNull().orEmpty()

    /** 记录已提醒的 key，避免断线重连后重复推送；容量超限时丢弃最早的记录。 */
    private fun rememberKey(key: String): Boolean {
        if (notifiedKeys.contains(key)) return false
        if (notifiedKeys.size >= 200) {
            val oldest = notifiedKeys.firstOrNull() ?: return true
            notifiedKeys.remove(oldest)
        }
        notifiedKeys.add(key)
        getSharedPreferences("native",MODE_PRIVATE).edit().putStringSet("notify.seen",notifiedKeys.toSet()).apply()
        return true
    }

    companion object {
        const val MONITOR_NOTIFICATION_ID = 42
        private const val RETRY_CAP_MS = 15000L
        private const val UNCONFIGURED_RETRY_MS = 30000L
    }
}
