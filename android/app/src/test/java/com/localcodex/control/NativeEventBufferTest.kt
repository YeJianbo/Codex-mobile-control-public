package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeEventBufferTest {
    private fun event(index:Int,type:String="message.delta")=ChatEvent(type=type,threadId="t",eventId="e:$index",itemId="reply",text="段$index🙂|")

    @Test fun longActiveReplyKeepsEveryFragmentAndPreviouslyPublishedSnapshots(){
        val buffer=NativeEventBuffer()
        var events:List<ChatEvent> = listOf(event(0,"user.message"))
        val original=events
        var earlier:List<ChatEvent> = emptyList()
        for(index in 1..6100){
            events=buffer.append(events,event(index))
            buffer.onEventsChanged(events)
            if(index==2500)earlier=events
        }
        assertEquals(listOf(event(0,"user.message")),original)
        assertEquals(2501,earlier.size)
        assertEquals(event(2500),earlier.last())
        assertEquals(6101,events.size)
        assertEquals((1..6100).joinToString(""){event(it).text},events.drop(1).joinToString(""){it.text})
    }

    @Test fun trimmingMatchesExistingWholeExchangeBoundariesAcrossRepeatedAppends(){
        val buffer=NativeEventBuffer()
        var actual:List<ChatEvent> = emptyList();var expected=actual
        for(index in 0..350){
            val next=event(index,when{index%11==5->"user.message";index%11==6->"turn.started";index%11==4->"turn.completed";else->"message.delta"})
            expected=retainNativeConversationEvents(expected+next,7)
            actual=buffer.append(actual,next,7)
            buffer.onEventsChanged(actual)
            assertEquals("event $index",expected,actual)
        }
    }

    @Test fun historyReplacementAndConversationChangesDiscardOldBoundaryPositions(){
        val buffer=NativeEventBuffer()
        var events:List<ChatEvent> = emptyList()
        repeat(40){events=buffer.append(events,event(it,if(it%3==0)"user.message" else "message.delta"),4)}
        val old=events.toList()
        val replacement=listOf(event(100,"user.message"),event(101)).map{it.copy(threadId="other")}
        buffer.onEventsChanged(replacement)
        val incoming=event(102).copy(threadId="other")
        val revised=buffer.append(replacement,incoming,4)
        assertEquals(replacement+incoming,revised)
        assertEquals(old,events)
        buffer.onEventsChanged(emptyList())
        assertEquals(listOf(event(200)),buffer.append(emptyList(),event(200),4))
    }

    @Test fun publishedSnapshotsKeepTheIncrementalIdentityIndexValid(){
        val buffer=NativeEventBuffer();val index=NativeEventIndex()
        var events:List<ChatEvent> = listOf(event(0,"user.message"))
        for(number in 1..16){
            assertFalse(index.containsId(events,"e:$number"))
            val incoming=event(number,if(number%4==0)"user.message" else "message.delta")
            val next=buffer.append(events,incoming,5)
            index.appended(events,incoming,next)
            index.onEventsChanged(next);buffer.onEventsChanged(next)
            assertTrue(index.containsId(next,incoming.eventId))
            if(next.first().eventId!="e:0")assertFalse(index.containsId(next,"e:0"))
            events=next
        }
        val retained=retainNativeConversationEvents(events,1)
        if(retained===events)assertEquals("user.message",events.first().type)
    }
}
