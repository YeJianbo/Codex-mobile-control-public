package com.localcodex.control

internal fun nativeApprovalKey(threadId:String,id:String)=threadId+"\u0000"+id
internal fun nativeAnsweredApproval(event:ChatEvent):String? = event.questionReplyId.takeIf{event.type=="user.message"&&it.isNotBlank()}?.let{if(it.startsWith("desktop-question:")||it.startsWith("question-")||it.startsWith("agent-question-"))it else "desktop-question:$it"}
internal fun nativeApprovalResult(value:String)=when(value){
    "accept","accepted"->"accepted"
    "decline","declined"->"declined"
    "expired"->"expired"
    "answered"->"answered"
    "resolved"->"resolved"
    else->""
}
internal fun nativeApprovalResultLabel(result:String,handled:Boolean,pending:Boolean)=when(result){
    "accepted"->"已批准"
    "declined"->"已拒绝"
    "expired"->"已失效"
    "answered"->"已回答"
    "resolved"->"已处理"
    else->if(pending)"待确认" else if(handled)"已处理" else "结果未记录"
}

internal fun nativeApprovalTimelineEvents(events:List<ChatEvent>,pendingIds:Set<String>,handledIds:Set<String>,
    results:Map<String,String>,autoApprove:Boolean):List<ChatEvent> = events.mapNotNull{event->
    if(event.type!="approval.requested"||event.approvalType=="question")return@mapNotNull event
    val result=results[nativeApprovalKey(event.threadId,event.approvalId)].orEmpty()
    if(autoApprove&&result in setOf("accepted","resolved"))return@mapNotNull null
    val actionable=event.approvalId.isNotBlank()&&event.approvalId in pendingIds&&event.approvalId !in handledIds&&result.isEmpty()
    if(actionable)event else event.copy(type="tool.completed",title="审批记录",
        status=when(result){"accepted","resolved"->"ok";"declined"->"error";"expired"->"cancelled";else->""},
        detail=listOfNotNull(result.takeIf{it.isNotBlank()}?.let{nativeApprovalResultLabel(it,true,false)},event.detail.takeIf{it.isNotBlank()}).joinToString("\n"))
}
