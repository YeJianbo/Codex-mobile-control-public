package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

class NativeOutputIntegrityTest {
    private fun delta(index:Int,text:String="段$index|",item:String="reply")=ChatEvent("message.delta","t",text=text,itemId=item,eventId="delta-$index",createdAt="2026-10-04T06:26:%02dZ".format(index.coerceAtMost(59)))
    private fun text(events:List<ChatEvent>)=nativeTimeline(events,"t",running=true).filter{it.event.type=="message.delta"}.joinToString(""){it.event.text}
    @Test fun aSuffixOnlyHistoryPollCannotDeleteTheKnownPrefix(){
        val events=(0 until 1300).map{delta(it)}
        assertEquals(text(events),text(reconcileNativeHistory(events,events.takeLast(200),false)))
    }
    @Test fun aDelayedPollKeepsBothEarlierLiveTextAndNotificationsReceivedDuringTheRead(){
        val events=(0 until 10).map{delta(it,"同字|")}
        assertEquals(text(events),text(reconcileNativeHistory(events,events.subList(3,7),false)))
        assertEquals(events.map{it.eventId},reconcileNativeHistory(events,events.subList(3,7),false).map{it.eventId})
    }
    @Test fun aFullSavedItemReplacesFragmentsOnceAndKeepsTheSameRow(){
        val events=(0 until 8).map{delta(it)}
        val saved=delta(9,text(events)).copy(eventId="history:full")
        val result=reconcileNativeHistory(events,listOf(saved),false)
        assertEquals(listOf(saved),result)
        assertEquals(nativeTimeline(events,"t",running=true).single().key,nativeTimeline(result,"t",running=true).single().key)
    }
    @Test fun anOlderItemSnapshotDoesNotRollBackItsAlreadyReceivedSuffix(){
        val saved=delta(0,"前半段").copy(eventId="history:partial")
        val live=listOf(saved,delta(1,"后半段"),delta(2,"🙂"))
        assertEquals("前半段后半段🙂",text(reconcileNativeHistory(live,listOf(saved),false)))
        val full=saved.copy(eventId="history:full",text="前半段后半段🙂",createdAt="2026-10-04T06:27:00Z")
        assertEquals(listOf(full),reconcileNativeHistory(live,listOf(full),false))
    }
    @Test fun aSnapshotWithSomeLiveSuffixesDoesNotAppendTheSuffixTwice(){
        val saved=delta(0,"前文").copy(eventId="history:partial")
        val b=delta(1,"中段");val c=delta(2,"尾段")
        val old=listOf(saved,b,c)
        val reconciled=reconcileNativeHistory(old,listOf(saved,b),false)
        assertEquals("前文中段尾段",text(reconciled))
        assertTrue(reconciled.any{it.eventId==b.eventId})
        assertEquals("前文中段尾段",text(reconcileNativeHistory(reconciled,listOf(saved,b,c),false)))
        assertEquals("前文中段",text(reconcileNativeHistory(listOf(saved,b),listOf(saved,b),false)))
    }
    @Test fun aSavedOlderTurnDoesNotRetainItsDuplicateLiveUserAndReply(){
        val old=listOf(ChatEvent("user.message","t",text="问",eventId="u",createdAt="2026-10-04T06:24:00Z"),delta(0))
        val incoming=listOf(old[0].copy(eventId="history:u"),old[1].copy(eventId="history:a",createdAt="2026-10-04T06:27:00Z"))
        assertEquals(incoming,reconcileNativeHistory(old,incoming,false))
    }
    @Test fun aCompletedItemIsAuthoritativeAndCanCorrectAnAlreadyDuplicatedSuffix(){
        val saved=delta(0,"正文").copy(eventId="history:complete",textComplete=true)
        val duplicated=listOf(saved.copy(textComplete=false),delta(1,"重复尾段"))
        assertEquals(listOf(saved),reconcileNativeHistory(duplicated,listOf(saved),false))
    }
    @Test fun completedCorrectionsAndIncompleteSuffixRecoveryStayIndependent(){
        val oldComplete=delta(0,"需要修正的旧正文",item="complete")
        val partial=delta(1,"前文",item="partial").copy(eventId="history:partial")
        val suffix=delta(2,"尾段",item="partial")
        val completed=oldComplete.copy(eventId="history:complete",text="修正",textComplete=true)
        val recovered=reconcileNativeHistory(listOf(oldComplete,partial,suffix),listOf(completed,partial),false)
        assertEquals(listOf(completed,partial.copy(text="前文尾段")),recovered)
    }
    @Test fun aReadOnlyVersionedCloudSnapshotReplacesItsPreviousSummary(){
        val old=listOf(ChatEvent("user.message","cloud-snapshot:t",text="旧请求",eventId="snapshot:t:old:0"),
            ChatEvent("message.delta","cloud-snapshot:t",text="旧摘要",eventId="snapshot:t:old:1",itemId="snapshot:1"))
        val updated=listOf(old[0].copy(text="新请求",eventId="snapshot:t:new:0"),old[1].copy(text="新摘要",eventId="snapshot:t:new:1"))
        assertEquals(updated,reconcileNativeHistory(old,updated,false,retainLive=false))
    }
    @Test fun nativeHarnessHistoryCannotBeAppendedAfterANewerWindow(){
        for(prefix in listOf("zcode-history:","deepseek-history:")){
            val old=ChatEvent("user.message","t",text="旧消息",eventId=prefix+"old",createdAt="2026-10-31T09:22:00Z")
            val latest=ChatEvent("user.message","t",text="新消息",eventId=prefix+"new",createdAt="2026-10-31T09:56:00Z")
            assertEquals(listOf(latest),reconcileNativeHistory(listOf(old),listOf(latest),true))
            val live=ChatEvent("message.delta","t",text="实时回复",eventId="live:reply",itemId="reply",createdAt="2026-10-31T09:57:00Z")
            assertEquals(listOf(old,latest,live),reconcileNativeHistory(listOf(old,live),listOf(latest),true))
        }
    }
    private fun sha(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
    @Test fun longActiveReplyIsNeverCutAtTheEventLimit(){
        val id="antigravity-fixture"
        val pieces=(0 until 6100).map{"段🙂$it|"}
        val events=listOf(ChatEvent(type="user.message",threadId=id,text="fixture"))+pieces.mapIndexed{i,text->ChatEvent(type="message.delta",threadId=id,itemId="reply",eventId="delta-$i",text=text)}
        val retained=retainNativeConversationEvents(events)
        assertEquals("user.message",retained.first().type)
        assertEquals(sha(pieces.joinToString("")),sha(nativeTimeline(retained,id).filter{it.event.type=="message.delta"}.joinToString(""){it.event.text}))
    }
    @Test fun oldExchangesAreDroppedOnlyAtAUserBoundary(){
        val events=listOf(ChatEvent(type="user.message",text="old"),ChatEvent(type="message.delta",text="old reply"),ChatEvent(type="user.message",text="current"),ChatEvent(type="message.delta",text="a"),ChatEvent(type="message.delta",text="b"))
        assertEquals(events.drop(2),retainNativeConversationEvents(events,2))
    }
}
