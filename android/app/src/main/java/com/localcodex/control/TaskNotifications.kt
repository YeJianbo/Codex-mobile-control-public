package com.localcodex.control

data class TaskNotification(val key:String,val threadId:String,val title:String,val body:String,val failureReason:String="")

/** 同一个结束消息可能从桌面与网关分别到达，直到下一轮开始才重新允许提醒。 */
internal class TaskNotificationTracker {
    private data class Turn(var ended:Boolean=false,val events:MutableList<ChatEvent> = mutableListOf())
    private val turns=linkedMapOf<String,Turn>()
    private val seen=linkedSetOf<String>()

    fun accept(event:ChatEvent):Boolean {
        if(event.subagent)return false
        if(event.threadId.isBlank()||event.threadId=="unknown"||event.threadId=="debug"||event.threadId.startsWith("terminal:"))return false
        if(event.eventId.isNotBlank()&&!seen.add(event.eventId))return false
        if(seen.size>400)seen.remove(seen.first())
        val turn=turns.getOrPut(event.threadId){Turn()}
        if(turns.size>100)turns.remove(turns.keys.first())
        when(event.type){
            "turn.started","user.message"->{turn.ended=false;turn.events.clear()}
            "thread.started"->if(event.status=="running"&&turn.ended){turn.ended=false;turn.events.clear()}
            "message.delta","error"->if(!turn.ended){
                val previous=turn.events.lastOrNull()
                if(event.type=="message.delta"&&previous?.type==event.type&&previous.itemId==event.itemId){
                    turn.events[turn.events.lastIndex]=previous.copy(text=(previous.text+event.text).take(6000))
                }else{
                    turn.events.add(event.copy(text=event.text.take(6000)))
                    if(turn.events.size>20)turn.events.removeAt(0)
                }
            }
            "turn.completed"->{
                val notify=!event.replayed&&!turn.ended
                turn.ended=true
                return notify
            }
            else->if(turn.events.lastOrNull()?.type=="message.delta")turn.events.add(ChatEvent(type="boundary"))
        }
        return false
    }

    fun content(completion:ChatEvent,history:List<ChatEvent>,threadTitle:String):TaskNotification {
        val live=turns[completion.threadId]?.events.orEmpty()
        return taskNotification(completion,history,live,threadTitle)
    }
}

internal fun taskNotification(completion:ChatEvent,history:List<ChatEvent>,live:List<ChatEvent>,threadTitle:String):TaskNotification {
    val sameThread=history.filter{it.threadId==completion.threadId}
    // 历史中定位本次结束，防止请求期间开始的新一轮或旧答复进入通知。
    val end=sameThread.indexOfLast{it.type=="turn.completed"&&(
        completion.eventId.isNotBlank()&&it.eventId==completion.eventId||
        completion.createdAt.isNotBlank()&&it.createdAt==completion.createdAt
    )}
    val round=if(end>=0){
        var cursor=end-1
        while(cursor>=0&&sameThread[cursor].type in setOf("turn.completed","thread.started"))cursor--
        val start=(cursor downTo 0).firstOrNull{sameThread[it].type in setOf("turn.completed","turn.started","user.message")}?:-1
        sameThread.subList(start+1,end)
    }else live
    val success=completion.status.lowercase() in setOf("ok","completed","complete","success","idle")
    val interrupted=completion.status.lowercase() in setOf("interrupted","cancelled","canceled","aborted")
    val status=when{success->"任务已完成";interrupted->"任务已中断";completion.status.lowercase() in setOf("error","failed")->"任务失败";else->"任务已结束"}
    val title=threadTitle.trim().takeUnless{it.isBlank()||it in setOf("新对话","新会话","New conversation","New thread")}
    val answer=notificationAnswer(round).ifBlank{notificationAnswer(live)}
    // 网关的失败原因可能紧接在结束事件之后到达。
    val trailingError=if(end<0)null else sameThread.drop(end+1).takeWhile{
        it.type !in setOf("user.message","turn.started","message.delta")&&!(it.type=="thread.started"&&it.status=="running")
    }.lastOrNull{it.type=="error"}
    val error=(trailingError?:round.lastOrNull{it.type=="error"}?:live.lastOrNull{it.type=="error"})?.let{it.detail.ifBlank{it.text}}.orEmpty()
    val text=(if(!success&&!interrupted)error.ifBlank{answer} else answer).ifBlank{
        when{interrupted->"本轮已停止，可打开会话查看进度";success->"本轮没有文本答复，可打开会话查看结果";else->"打开会话查看本轮详情"}
    }
    val plain=text.replace(Regex("!?\\[([^]]+)]\\([^)]+\\)"),"$1")
        .replace(Regex("(?m)^\\s{0,3}#{1,6}\\s+"),"")
        .replace("```","").replace("**","").replace("`","")
        .replace(Regex("\\s+")," ").trim()
    return TaskNotification(
        completion.eventId.ifBlank{"${completion.threadId}:${completion.createdAt}"},completion.threadId,
        if(title==null)status else "$status · ${title.take(60)}",plain.take(240),if(!success&&!interrupted)error else "",
    )
}

private fun notificationAnswer(events:List<ChatEvent>):String {
    var answer=""
    var previous:ChatEvent?=null
    events.forEach{event->
        if(event.type=="message.delta")answer=if(previous?.type==event.type&&previous?.itemId==event.itemId)answer+event.text else event.text
        previous=event
    }
    return answer
}
