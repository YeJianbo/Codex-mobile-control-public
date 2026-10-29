package com.localcodex.control

data class TaskNotification(val key:String,val threadId:String,val title:String,val body:String,val failureReason:String="",val questionId:String="")

/** 同一个结束消息可能从桌面与网关分别到达，直到下一轮开始才重新允许提醒。 */
internal class TaskNotificationTracker {
    private data class Turn(var id:String="",var ended:Boolean=false,val events:MutableList<ChatEvent> = mutableListOf())
    private val turns=linkedMapOf<String,Turn>()
    private val seen=linkedSetOf<String>()
    private val completedTurns=linkedSetOf<Pair<String,String>>()

    fun accept(event:ChatEvent):Boolean {
        if(event.subagent)return false
        if(event.threadId.isBlank()||event.threadId=="unknown"||event.threadId=="debug"||event.threadId.startsWith("terminal:"))return false
        if(event.eventId.isNotBlank()&&!seen.add(event.eventId))return false
        if(seen.size>400)seen.remove(seen.first())
        val turnKey=event.threadId to event.turnId
        if(event.turnId.isNotBlank()&&turnKey in completedTurns)return false
        val turn=turns.getOrPut(event.threadId){Turn()}
        if(turns.size>100)turns.remove(turns.keys.first())
        when(event.type){
            "turn.started"->{
                // A user echo or duplicate start can arrive after the first text.
                if(turn.ended||event.turnId.isNotBlank()&&turn.id.isNotBlank()&&event.turnId!=turn.id)turn.events.clear()
                turn.ended=false
                if(event.turnId.isNotBlank())turn.id=event.turnId
            }
            "user.message"->if(event.questionReplyId.isBlank()&&(turn.ended||event.turnId.isNotBlank()&&event.turnId!=turn.id)){
                turn.ended=false;turn.id=event.turnId;turn.events.clear()
            }
            "thread.started"->if(event.status=="running"&&turn.ended){turn.ended=false;turn.id="";turn.events.clear()}
            "message.delta","error"->if(!turn.ended){
                if(event.turnId.isNotBlank()){
                    if(turn.id.isNotBlank()&&turn.id!=event.turnId)return false
                    turn.id=event.turnId
                }
                val previous=turn.events.lastOrNull()
                if(event.type=="message.delta"&&previous?.type==event.type&&previous.itemId==event.itemId){
                    val text=if(event.textComplete)event.text.ifBlank{previous.text} else previous.text+event.text
                    turn.events[turn.events.lastIndex]=event.copy(text=text.take(6000))
                }else{
                    turn.events.add(event.copy(text=event.text.take(6000)))
                    if(turn.events.size>20)turn.events.removeAt(0)
                }
            }
            "turn.completed"->{
                if(event.turnId.isNotBlank()&&turn.id.isNotBlank()&&event.turnId!=turn.id)return false
                val notify=!event.replayed&&!turn.ended
                turn.ended=true
                if(event.turnId.isNotBlank()){
                    completedTurns.add(turnKey)
                    if(completedTurns.size>400)completedTurns.remove(completedTurns.first())
                }
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
    val sameThread=history.filter{it.threadId==completion.threadId&&!it.subagent}
    // 历史中定位本次结束，防止请求期间开始的新一轮或旧答复进入通知。
    val exactEnd=sameThread.indexOfLast{it.type=="turn.completed"&&(
        completion.eventId.isNotBlank()&&it.eventId==completion.eventId||
        completion.createdAt.isNotBlank()&&it.createdAt==completion.createdAt
    )}
    val end=if(exactEnd>=0)exactEnd else sameThread.indexOfLast{it.type=="turn.completed"&&completion.turnId.isNotBlank()&&it.turnId==completion.turnId}
    val round=if(end>=0){
        var cursor=end-1
        while(cursor>=0&&sameThread[cursor].type in setOf("turn.completed","thread.started"))cursor--
        val start=(cursor downTo 0).firstOrNull{sameThread[it].type in setOf("turn.completed","turn.started","user.message")}?:-1
        sameThread.subList(start+1,end)
    }else if(completion.turnId.isNotBlank())sameThread.filter{it.turnId==completion.turnId} else live
    val currentRound=round.filter{completion.turnId.isBlank()||it.turnId.isBlank()||it.turnId==completion.turnId}
    val currentLive=live.filter{completion.turnId.isBlank()||it.turnId.isBlank()||it.turnId==completion.turnId}
    val success=completion.status.lowercase() in setOf("ok","completed","complete","success","idle")
    val interrupted=completion.status.lowercase() in setOf("interrupted","cancelled","canceled","aborted")
    val status=when{success->"任务已完成";interrupted->"任务已中断";completion.status.lowercase() in setOf("error","failed")->"任务失败";else->"任务已结束"}
    val title=threadTitle.trim().takeUnless{it.isBlank()||it in setOf("新对话","新会话","New conversation","New thread")}
    // Native history can give terminal records a different event ID. Turn IDs
    // also retain text when a late user echo appears after the streamed answer.
    val identified=if(completion.turnId.isBlank())emptyList() else sameThread.filter{it.turnId==completion.turnId}
    val answer=notificationAnswer(identified).ifBlank{notificationAnswer(currentRound)}.ifBlank{notificationAnswer(currentLive)}
    // 网关的失败原因可能紧接在结束事件之后到达。
    val trailingError=if(end<0)null else sameThread.drop(end+1).takeWhile{
        it.type !in setOf("user.message","turn.started","message.delta")&&!(it.type=="thread.started"&&it.status=="running")
    }.lastOrNull{it.type=="error"}
    val error=(trailingError?:currentRound.lastOrNull{it.type=="error"}?:currentLive.lastOrNull{it.type=="error"})?.let{it.detail.ifBlank{it.text}}.orEmpty()
    val text=(if(!success&&!interrupted)error.ifBlank{answer} else answer).ifBlank{
        when{interrupted->"本轮已停止，可打开会话查看进度";success->"打开会话查看结果";else->"打开会话查看本轮详情"}
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
    val messages=linkedMapOf<String,StringBuilder>()
    var lastAnswer=""
    var segment=0
    var previous:ChatEvent?=null
    events.forEach{event->
        if(event.type=="message.delta"){
            if(previous?.type!="message.delta")segment++
            val key=event.itemId.ifBlank{"anonymous:$segment"}
            if(event.text.isNotBlank()||messages.containsKey(key)&&!event.textComplete){
                val text=messages.getOrPut(key){StringBuilder()}
                if(event.textComplete)text.setLength(0)
                text.append(event.text)
                if(event.text.isNotBlank())lastAnswer=key
            }
        }
        previous=event
    }
    return messages[lastAnswer]?.toString().orEmpty()
}
