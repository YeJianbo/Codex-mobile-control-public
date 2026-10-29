package com.localcodex.control

private val progressBoundaries=setOf("user.message","turn.started","turn.completed")
private val progressResponses=setOf("message.delta","reasoning.summary","tool.started","tool.output","tool.completed",
    "plan.updated","file.changed","diff.updated","context.compaction","approval.requested","error")

/** A thread's running badge alone is not evidence that its current turn is waiting. */
internal fun nativeChatProgressLabel(
    events:List<ChatEvent>,threadId:String,running:Boolean,loadingHistory:Boolean,
    submitting:Boolean=false,submissionStage:String="",
):String? {
    if(loadingHistory)return null
    val conversation=events.filter{it.threadId==threadId}
    if(submitting)return submissionStage.ifBlank{"正在确认发送"}
    if(!running)return null
    val boundary=conversation.indexOfLast{it.type in progressBoundaries}
    if(boundary<0||conversation[boundary].type=="turn.completed")return null
    val turnId=conversation[boundary].turnId
    // Once a response exists, the response or operation owns the progress display.
    if(conversation.withIndex().any{(index,event)->
        (index>boundary||turnId.isNotBlank()&&event.turnId==turnId)&&
            (event.type in progressResponses||event.type=="turn.completed")
    })return null
    return "等待回复"
}
