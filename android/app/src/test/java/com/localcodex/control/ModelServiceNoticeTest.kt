package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class ModelServiceNoticeTest {
    @Test fun recognizesQuotaFailuresFromCodexAndProviders(){
        listOf("You've hit your usage limit. Try again later.","usage_limit_reached","insufficient_quota","Quota exceeded for model","账号额度已耗尽").forEach{assertEquals(it,ModelServiceIssue.QUOTA,modelServiceIssue(it))}
    }
    @Test fun capacityDoesNotMeanTheUsersQuotaWasExhausted(){
        listOf("UNAVAILABLE (code 503): No capacity available","Model capacity exhausted","overloaded_error","模型服务容量不足").forEach{assertEquals(it,ModelServiceIssue.CAPACITY,modelServiceIssue(it))}
        listOf("HTTP 503 Service Unavailable","Too many requests (429)","RESOURCE_EXHAUSTED","Connection timed out","Account quota remaining: 50%").forEach{assertNull(it,modelServiceIssue(it))}
    }
    @Test fun duplicateAndReplayErrorsStaySilentUntilAnotherTurnStarts(){
        val tracker=ModelServiceNoticeTracker()
        val failure=ChatEvent(type="error",threadId="t",text="No capacity available",eventId="error")
        assertNull(tracker.accept(failure.copy(replayed=true)))
        assertEquals("capacity",tracker.accept(failure)?.kind)
        assertNull(tracker.accept(failure))
        assertNull(tracker.accept(failure.copy(eventId="duplicate")))
        tracker.accept(ChatEvent(type="turn.completed",threadId="t",status="error"))
        assertNull(tracker.accept(failure.copy(eventId="after-completed")))
        tracker.accept(ChatEvent(type="turn.started",threadId="t"))
        assertNotNull(tracker.accept(failure.copy(eventId="next-error")))
    }
    @Test fun differentThreadsAndFailureKindsRemainIndependent(){
        val tracker=ModelServiceNoticeTracker()
        val event=ChatEvent(type="error",threadId="a",text="No capacity available")
        assertNotNull(tracker.accept(event));assertNotNull(tracker.accept(event.copy(threadId="b")))
        assertEquals("quota",tracker.accept(event.copy(text="usage_limit_reached"))?.kind)
    }
    @Test fun freshQuotaWarnsOnceAndCanWarnAgainAfterRecovery(){
        val tracker=ModelServiceNoticeTracker()
        val empty=listOf(NativeQuotaWindow("Codex",300,0.0,2000))
        assertNull(tracker.quota("codex",empty,true,1000))
        assertNotNull(tracker.quota("codex",empty,false,1000))
        assertNull(tracker.quota("codex",empty,false,1000))
        assertNull(tracker.quota("codex",emptyList(),false,1000))
        assertNull(tracker.quota("codex",empty,false,1000))
        assertNull(tracker.quota("codex",empty.map{it.copy(remainingPercent=90.0)},false,1000))
        assertNotNull(tracker.quota("codex",empty,false,1000))
    }
    @Test fun missingQuotaAndExpiredWindowsAreNotReportedAsExhausted(){
        val tracker=ModelServiceNoticeTracker()
        assertNull(tracker.quota("codex",listOf(NativeQuotaWindow("Codex",300,null,null)),false,1000))
        assertNull(tracker.quota("codex",listOf(NativeQuotaWindow("Codex",300,0.0,900)),false,1000))
        assertNull(tracker.quota("codex",listOf(NativeQuotaWindow("Codex",300,Double.NaN,null)),false,1000))
    }
    @Test fun tenPercentWarnsBeforeExhaustionAndZeroUpgradesTheNotice(){
        val tracker=ModelServiceNoticeTracker()
        val window=NativeQuotaWindow("Codex",300,10.1,2000)
        assertNull(tracker.quota("codex",listOf(window),false,1000))
        val low=tracker.quota("codex",listOf(window.copy(remainingPercent=10.0)),false,1000)!!
        assertEquals("quota-low",low.kind)
        assertTrue(low.message.contains("5 小时额度 剩余 10%"))
        assertNull(tracker.quota("codex",listOf(window.copy(remainingPercent=5.0)),false,1000))
        assertTrue(quotaWindowNotice(listOf(window.copy(remainingPercent=5.0)),1000)!!.message.contains("5%"))
        assertNull(tracker.quota("codex",listOf(window.copy(remainingPercent=null)),false,1000))
        assertNull(tracker.quota("codex",listOf(window.copy(remainingPercent=5.0)),false,1000))
        assertEquals("quota",tracker.quota("codex",listOf(window.copy(remainingPercent=0.0)),false,1000)?.kind)
    }
    @Test fun exhaustedWindowTakesPriorityOverAnotherLowWindow(){
        val notice=quotaWindowNotice(listOf(NativeQuotaWindow("Codex",300,5.0,2000),NativeQuotaWindow("Codex",10080,0.0,3000)),1000)!!
        assertEquals("quota",notice.kind)
        assertEquals("额度已用完",notice.title)
    }
}
