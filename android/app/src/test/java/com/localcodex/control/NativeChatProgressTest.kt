package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeChatProgressTest {
    private fun event(type:String,turn:String="turn")=ChatEvent(type=type,threadId="thread",turnId=turn,text=if(type=="message.delta")"回复" else "")
    private fun label(events:List<ChatEvent>,loading:Boolean=false,submitting:Boolean=false)=
        nativeChatProgressLabel(events,"thread",true,loading,submitting)

    @Test fun loadingAndOldRunningMetadataDoNotClaimModelWork(){
        assertNull(label(emptyList(),loading=true))
        assertNull(label(emptyList()))
        val completed=listOf(event("user.message"),event("turn.started"),event("message.delta"),event("turn.completed"))
        assertNull(label(completed))
        assertNull(label(completed,loading=true))
        assertEquals("正在确认发送",label(completed,submitting=true))
        assertEquals("等待回复",label(completed+event("turn.started","next")))
    }

    @Test fun onlyAnUnansweredTurnGetsAWaitingRow(){
        val started=listOf(event("user.message"),event("turn.started"))
        assertEquals("等待回复",label(started))
        for(type in listOf("message.delta","reasoning.summary","tool.started","tool.completed","context.compaction","approval.requested","error")){
            assertNull(type,label(started+event(type)))
        }
        assertNull(label(started+event("message.delta")+event("user.message")))
        assertNull(label(started+event("turn.completed")+event("turn.started")))
        assertEquals("等待回复",label(started+event("message.delta").copy(threadId="other")))
    }
}
