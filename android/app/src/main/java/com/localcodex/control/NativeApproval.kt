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
