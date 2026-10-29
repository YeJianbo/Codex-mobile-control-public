package com.localcodex.control

private val notificationEventTypes=setOf("connected","thread.started","turn.started","user.message","error",
    "approval.requested","approval.resolved","goal.completed","turn.completed")

internal fun nativeSocketEventRelevant(type:String,commandId:String,notificationsOnly:Boolean):Boolean {
    if(notificationsOnly)return type in notificationEventTypes
    // Native workspace terminals address their output by commandId. Codex tool
    // output has its own activity stream and must not enter the UI queue twice.
    return type!="terminal.output"||commandId.isNotBlank()
}
