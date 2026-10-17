package com.localcodex.control

internal class GoalRunClock {
    private var reported:Long?=null
    private var elapsedMs=0L
    private var sampledAt=0L
    private var ticking=false
    fun sample(seconds:Long?,active:Boolean,now:Long):Long? {
        if(seconds==null)return null
        if(reported==null)elapsedMs=seconds.coerceAtLeast(0)*1000
        else {
            if(ticking)elapsedMs+=(now-sampledAt).coerceAtLeast(0)
            if(seconds!=reported)elapsedMs=maxOf(elapsedMs,seconds.coerceAtLeast(0)*1000)
        }
        reported=seconds;sampledAt=now;ticking=active
        return elapsedMs/1000
    }
}

internal fun goalRunTime(seconds:Long?):String? {
    if(seconds==null)return null
    val total=seconds.coerceAtLeast(0)
    val hours=total/3600;val minutes=(total%3600)/60;val rest=total%60
    return "运行时间 "+(if(hours>0)"${hours}小时" else "")+(if(minutes>0||hours>0)"${minutes}分" else "")+"${rest}秒"
}

internal fun goalNotification(event:ChatEvent,threadTitle:String=""):TaskNotification? {
    if(event.type!="goal.completed"||event.replayed||event.subagent||event.threadId.isBlank())return null
    val title="目标已结束"+(if(threadTitle.isBlank())"" else " · ${threadTitle.take(60)}")
    val body=listOfNotNull(event.text.take(200).takeIf{it.isNotBlank()},goalRunTime(event.timeUsedSeconds)).joinToString("\n")
    return TaskNotification(event.eventId.ifBlank{"goal:${event.threadId}:${event.createdAt}"},event.threadId,title,body)
}
