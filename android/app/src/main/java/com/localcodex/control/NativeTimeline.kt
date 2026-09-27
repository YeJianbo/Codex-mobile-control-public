package com.localcodex.control

data class NativeBlock(val key:String, val event:ChatEvent, val activities:List<ChatEvent> = emptyList(),val boundary:Boolean=false)
fun nativeTimeline(events:List<ChatEvent>, threadId:String, warnings:Boolean=false, running:Boolean=false):List<NativeBlock> {
    val result=mutableListOf<NativeBlock>()
    val ids=mutableSetOf<String>()
    var boundary=true
    events.filter { it.threadId==threadId }.forEachIndexed { index,incoming ->
        val text=if(incoming.type=="user.message"&&incoming.eventId.startsWith("history:"))nativeVisibleHistoryText(incoming.text) else incoming.text
        if(text.isBlank()&&incoming.type=="user.message"&&incoming.images.isEmpty()&&incoming.uploads.isEmpty()&&incoming.attachments.isEmpty())return@forEachIndexed
        val event=if(text==incoming.text)incoming else incoming.copy(text=text)
        if(event.eventId.isNotBlank()&&!ids.add(event.eventId))return@forEachIndexed
        if(event.type=="warning"&&!warnings)return@forEachIndexed
        if(event.type !in setOf("user.message","message.delta","reasoning.summary","context.compaction","plan.updated","tool.started","tool.output","tool.completed","approval.requested","file.changed","diff.updated","error","warning")){if(event.type in setOf("turn.started","turn.completed"))boundary=true;return@forEachIndexed}
        val previous=result.lastOrNull()
        if(!boundary&&event.type in setOf("message.delta","reasoning.summary","tool.output")&&previous?.event?.type==event.type&&previous.event.itemId==event.itemId&& (event.type!="reasoning.summary"||event.itemId.isNotBlank())) {
            result[result.lastIndex]=previous.copy(event=previous.event.copy(text=previous.event.text+event.text))
        } else result.add(NativeBlock(event.eventId.ifBlank { "${event.type}:${event.itemId}:$index" },event,boundary=boundary))
        boundary=false
    }
    val grouped=mutableListOf<NativeBlock>()
    val segment=mutableListOf<NativeBlock>()
    val activityTypes=setOf("tool.started","tool.output","tool.completed","reasoning.summary","context.compaction","file.changed","diff.updated","plan.updated")
    fun flush(active:Boolean=false){
        if(segment.isEmpty())return
        val activities=segment.filter{it.event.type in activityTypes}
        val messages=segment.filter{it.event.type !in activityTypes}
        if(activities.isEmpty())grouped.addAll(messages)
        else {
            val insertion=if(active)messages.size else messages.indexOfLast{it.event.type=="message.delta"}.let{if(it<0)messages.size else it}
            grouped.addAll(messages.take(insertion))
            grouped.add(activities.first().copy(activities=activities.map{it.event}))
            grouped.addAll(messages.drop(insertion))
        }
        segment.clear()
    }
    for(block in result){
        if(block.boundary||block.event.type in setOf("user.message","approval.requested","error"))flush()
        if(block.event.type in setOf("user.message","approval.requested","error"))grouped.add(block)
        else segment.add(block)
    }
    flush(running)
    return grouped
}
private fun nativeVisibleHistoryText(input:String):String {
    val aborted=Regex("^<turn_aborted>\\s*The user interrupted the previous turn on purpose\\.[\\s\\S]*?</turn_aborted>\\s*$",RegexOption.IGNORE_CASE)
    if(aborted.matches(input.trim()))return ""
    var removed=false
    val ambient=Regex("<in-app-browser-context source=\"ambient-ui-state\">([\\s\\S]*?)</in-app-browser-context>\\s*",RegexOption.IGNORE_CASE)
    var text=ambient.replace(input){match->
        if(match.groupValues[1].contains("This block is automatically supplied ambient UI state")){removed=true;""}else match.value
    }.trim()
    if(removed)text=text.replaceFirst(Regex("^## My request(?: for Codex)?:\\s*",RegexOption.IGNORE_CASE),"")
    return text.trim()
}
fun nativeQueueError(value:String):String {
    if(value.contains("thread not found",true))return "会话连接已失效，消息已保留，请重试"
    if(value.contains("active writer",true)||value.contains("桌面版仍持有"))return "等待桌面会话连接，消息已保留"
    if(value.contains("timeout",true)||value.contains("超时"))return "连接超时，消息已保留，请重试"
    return value
}
fun nativePath(path:String)=path.replace('\\','/').removePrefix("//?/").trimEnd('/').lowercase()
