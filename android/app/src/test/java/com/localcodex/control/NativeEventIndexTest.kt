package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeEventIndexTest {
    private class CountedEvents(private val events:List<ChatEvent>):AbstractList<ChatEvent>(){
        var reads=0
        override val size get()=events.size
        override fun get(index:Int):ChatEvent{reads++;return events[index]}
    }
    private fun event(id:String,item:String=id,complete:Boolean=false,type:String="message.delta")=
        ChatEvent(type=type,eventId=id,itemId=item,textComplete=complete,threadId="t")

    @Test fun unchangedHistoryPollKeepsTheActiveSnapshotAndWarmStreamingIndex(){
        val index=NativeEventIndex()
        val history=CountedEvents((0 until 5000).map{event("history:$it",complete=it==4999)})
        assertTrue(index.containsId(history,"history:4999"))
        val fetched=history.map{it.copy()}
        val before=history.reads
        val reconciled=reconcileNativeHistory(history,fetched,false)
        assertSame(history,reconciled)
        assertEquals(history.size,history.reads-before)
        val refreshed=preserveNativeEventKeys(history,reconciled)
        assertSame(history,refreshed)
        val reads=history.reads
        index.onEventsChanged(refreshed)
        assertTrue(index.containsId(refreshed,"history:4999"))
        assertTrue(index.messageComplete(refreshed,"history:4999"))
        assertEquals(reads,history.reads)
    }

    @Test fun restoredDisplayKeysReuseOnlyUnchangedValuesAndKeepActualCorrections(){
        val original=listOf(event("history:a","reply",true).copy(text="正文",displayKey="live:a"))
        val fetched=original.map{it.copy(displayKey="")}
        assertSame(original,preserveNativeEventKeys(original,fetched))
        val revised=preserveNativeEventKeys(original,listOf(fetched.single().copy(text="修正正文",textComplete=false)))
        assertNotSame(original,revised)
        assertEquals("修正正文",revised.single().text)
        assertEquals("live:a",revised.single().displayKey)
        val index=NativeEventIndex()
        assertTrue(index.messageComplete(original,"reply"))
        index.onEventsChanged(revised)
        assertFalse(index.messageComplete(revised,"reply"))
    }

    @Test fun streamingLookupsScanHistoryOnceAndAppendDoesNotRescan(){
        val index=NativeEventIndex()
        val history=(0 until 5000).map{event("event:$it",complete=it==4999)}
        val events=CountedEvents(history)
        assertTrue(index.containsId(events,"event:4999"))
        assertEquals(5000,events.reads)
        repeat(1000){
            assertFalse(index.containsId(events,"new:$it"))
            assertTrue(index.messageComplete(events,"event:4999"))
        }
        assertEquals(5000,events.reads)
        val incoming=event("new","new-item",true)
        val next=CountedEvents(history+incoming)
        index.appended(events,incoming,next)
        index.onEventsChanged(next)
        assertTrue(index.containsId(next,"new"))
        assertTrue(index.messageComplete(next,"new-item"))
        assertEquals(0,next.reads)
    }

    @Test fun replacementAndSelectionChangesRemoveOldIdentitiesAndCompletionFlags(){
        val index=NativeEventIndex()
        val original=listOf(event("old","item",true))
        assertTrue(index.messageComplete(original,"item"))
        val revised=listOf(event("new","item",false))
        index.onEventsChanged(revised)
        assertFalse(index.containsId(revised,"old"))
        assertFalse(index.messageComplete(revised,"item"))
        assertTrue(index.containsId(revised,"new"))
        val other=listOf(event("other","other-item",true))
        assertFalse(index.containsId(other,"new"))
        assertFalse(index.messageComplete(other,"item"))
        assertTrue(index.messageComplete(other,"other-item"))
        assertTrue(index.containsId(original,"old"))
    }

    @Test fun trimmingAndEmptyListsDoNotKeepRemovedIdsOrTreatOtherEventsAsComplete(){
        val index=NativeEventIndex()
        val original=listOf(event("removed","old-item",true),event("keep"))
        assertTrue(index.containsId(original,"removed"))
        val incoming=event("tool","tool-item",true,"tool.output")
        val trimmed=listOf(original.last(),incoming)
        index.appended(original,incoming,trimmed)
        index.onEventsChanged(trimmed)
        assertFalse(index.containsId(trimmed,"removed"))
        assertFalse(index.messageComplete(trimmed,"old-item"))
        assertTrue(index.containsId(trimmed,"tool"))
        assertFalse(index.messageComplete(trimmed,"tool-item"))
        assertFalse(index.containsId(trimmed,""))
        assertFalse(index.messageComplete(trimmed,""))
        index.onEventsChanged(emptyList())
        assertFalse(index.containsId(emptyList(),"keep"))
    }
}
