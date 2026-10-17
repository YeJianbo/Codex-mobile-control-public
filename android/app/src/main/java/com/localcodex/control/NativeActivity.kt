package com.localcodex.control

internal fun hydrateNativeActivities(
    events:List<ChatEvent>,
    groups:Map<Pair<String,String>,List<ChatEvent>>,
    details:Map<Pair<String,String>,ChatEvent>,
):List<ChatEvent>{
    if(groups.isEmpty()&&details.isEmpty())return events
    var hydrated:ArrayList<ChatEvent>?=null
    fun output(index:Int):ArrayList<ChatEvent> = hydrated?:ArrayList<ChatEvent>(events.size).also{
        it.addAll(events.subList(0,index));hydrated=it
    }
    fun detail(event:ChatEvent)=details[event.threadId to event.eventId]?.takeIf{it.threadId==event.threadId}?:event
    events.forEachIndexed{index,event->
        val group=groups[event.threadId to event.activityGroupId]?.takeIf{it.firstOrNull()?.threadId==event.threadId}
        if(group!=null){
            val target=output(index)
            group.forEach{target.add(detail(it))}
        }else{
            val restored=detail(event)
            if(restored!==event)output(index).add(restored) else hydrated?.add(event)
        }
    }
    return hydrated?:events
}

internal data class NativeActivityItem(
    val key:String,val title:String,val type:String,val status:String,val files:List<String>,
    val eventIds:List<String>,val deferred:Boolean,private val sourceEvents:List<ChatEvent>,
){
    val hasDetails:Boolean=sourceEvents.any{event->when(event.type){
        "file.changed"->event.diff.isNotBlank()||event.files.isNotEmpty()||event.detail.isNotBlank()
        "diff.updated"->event.diff.isNotBlank()
        "reasoning.summary","plan.updated","context.compaction"->event.text.isNotBlank()||event.detail.isNotBlank()
        else->event.command.isNotBlank()||event.text.isNotBlank()||event.detail.isNotBlank()
    }}
    val knownChange:Boolean=type=="file.changed"||type=="diff.updated"
    val isChange:Boolean by lazy{knownChange||
        title=="编辑文件"&&sourceEvents.any{nativeActivityBody(it).contains("*** Begin Patch")}}
    // The operation list only needs metadata. Build the body once, after opening the row.
    val detail:String by lazy{
        val body=StringBuilder()
        for(event in sourceEvents){
            val next=nativeActivityBody(event)
            when(event.type){
                "reasoning.summary"->if(next.length>body.length){body.setLength(0);body.append(next)}
                "file.changed","diff.updated","plan.updated","context.compaction"->if(next.isNotBlank()){body.setLength(0);body.append(next)}
                else->if(next.isNotBlank()&&body.indexOf(next)<0){
                    if(body.isNotBlank())body.append('\n') else body.setLength(0)
                    body.append(next)
                }
            }
        }
        body.toString()
    }
}

internal data class NativePreparedActivityDetail(val entry:NativeActivityItem,val text:String,val isChange:Boolean)
internal fun prepareNativeActivityDetail(entry:NativeActivityItem):NativePreparedActivityDetail{
    val body=entry.detail
    val text=if(entry.type=="reasoning.summary"&&nativeActivityLabel(body)==entry.title)
        body.lineSequence().drop(1).joinToString("\n").trim() else body
    return NativePreparedActivityDetail(entry,text,entry.isChange)
}

private fun nativeActivityBody(event:ChatEvent):String=when(event.type){
    "reasoning.summary"->event.text.ifBlank{event.detail}.trim()
    "file.changed"->event.diff.ifBlank{event.files.joinToString("\n").ifBlank{event.detail}}
    "diff.updated"->event.diff
    "plan.updated","context.compaction"->event.text.ifBlank{event.detail}
    else->event.command.ifBlank{event.text.ifBlank{event.detail}}
}

internal fun nativeActivityLabel(value:String):String = value.trim().lineSequence().firstOrNull().orEmpty().trim()
    .replace(Regex("^#{1,6}\\s+"),"")
    .removeSurrounding("**").removeSurrounding("__").removeSurrounding("`").trim()
internal fun nativeToolTitle(value:String):String =
    if(Regex("^[\"']?[A-Za-z]:[\\\\/]").containsMatchIn(value.trimStart()))"运行命令" else nativeActivityLabel(value)

private class ActivityDraft(val key:String,var title:String,val type:String,var status:String,var files:List<String> = emptyList()){
    val events=mutableListOf<ChatEvent>()
    fun finish()=NativeActivityItem(key,title,type,status,files,events.map{it.eventId},events.any{it.detailsDeferred},events.toList())
}

internal fun nativeActivityItems(events:List<ChatEvent>):List<NativeActivityItem>{
    val result=mutableListOf<ActivityDraft>()
    val tools=mutableMapOf<String,ActivityDraft>()
    val summaries=mutableMapOf<String,ActivityDraft>()
    val snapshots=mutableMapOf<String,ActivityDraft>()
    events.forEachIndexed{index,event->
        if(event.activityGroupId.isNotBlank())return@forEachIndexed
        if(event.type=="reasoning.summary"){
            val title=nativeActivityLabel(event.title.ifBlank{event.text.ifBlank{event.detail}}).ifBlank{"思考摘要"}
            val draft=summaries.getOrPut(title.lowercase()){ActivityDraft("reasoning:$index",title,event.type,event.status).also{result.add(it)}}
            draft.status=event.status;draft.events.add(event)
            return@forEachIndexed
        }
        if(event.type in setOf("file.changed","diff.updated","plan.updated","context.compaction")){
            val title=when(event.type){"file.changed"->"编辑文件";"diff.updated"->"查看改动";"plan.updated"->"更新计划";else->"压缩上下文"}
            val key="${event.type}:${if(event.type in setOf("plan.updated","diff.updated"))"current" else event.itemId.ifBlank{event.eventId.ifBlank{index.toString()}}}"
            val draft=snapshots.getOrPut(key){ActivityDraft(key,title,event.type,event.status,event.files).also{result.add(it)}}
            draft.status=event.status;if(event.files.isNotEmpty())draft.files=event.files;draft.events.add(event)
            return@forEachIndexed
        }
        val key=event.itemId.ifBlank{event.commandId.ifBlank{event.eventId.ifBlank{"tool:$index"}}}
        val title=event.title.takeUnless{it.isBlank()||it in setOf("exec","输出","执行完成")}?:"运行命令"
        val visibleTitle=when{
            title.contains("view_image",true)||title.contains("imageView",true)->"查看图片"
            title.contains("apply_patch",true)||title.contains("edit_file",true)||title.contains("write_file",true)||title=="fileChange"->"编辑文件"
            else->nativeToolTitle(title)
        }
        val draft=tools.getOrPut(key){ActivityDraft(key,visibleTitle,event.type,event.status).also{result.add(it)}}
        if(draft.title=="运行命令")draft.title=visibleTitle
        if(event.type=="tool.completed")draft.status=event.status
        draft.events.add(event)
    }
    return result.map{it.finish()}
}
