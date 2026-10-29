package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeApprovalTimelineTest {
    private fun request(id:String,type:String="command")=ChatEvent(type="approval.requested",threadId="t",approvalId=id,approvalType=type,title="需要审批",detail="original detail")
    @Test fun historicalApprovalNoticesBecomeFoldedOperationsWhilePendingRequestsAndQuestionsStayActionable(){
        val observed=request("");val old=request("old");val pending=request("pending");val question=request("q","question")
        val events=nativeApprovalTimelineEvents(listOf(observed,old,pending,question),setOf("pending"),emptySet(),emptyMap(),true)
        assertEquals(listOf("tool.completed","tool.completed","approval.requested","approval.requested"),events.map{it.type})
        assertEquals("original detail",events[0].detail)
        assertEquals("",events[0].status)
        assertSame(pending,events[2]);assertSame(question,events[3])
    }
    @Test fun automaticApprovalDoesNotPolluteTheTimelineAndManualDenialKeepsItsRealResult(){
        val approved=request("a");val denied=request("d")
        val results=mapOf(nativeApprovalKey("t","a") to "accepted",nativeApprovalKey("t","d") to "declined")
        val events=nativeApprovalTimelineEvents(listOf(approved,denied),setOf("a","d"),emptySet(),results,true)
        assertEquals(1,events.size);assertEquals("tool.completed",events[0].type);assertEquals("error",events[0].status)
        assertTrue(events[0].detail.startsWith("已拒绝"))
        val manual=nativeApprovalTimelineEvents(listOf(approved),emptySet(),setOf("a"),results,false)
        assertEquals("tool.completed",manual.single().type);assertTrue(manual.single().detail.startsWith("已批准"))
    }
}
