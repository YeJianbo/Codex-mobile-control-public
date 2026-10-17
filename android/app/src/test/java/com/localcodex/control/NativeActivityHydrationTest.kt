package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeActivityHydrationTest {
    private fun event(thread:String,id:String,group:String="",text:String="")=
        ChatEvent(type="tool.output",threadId=thread,eventId=id,activityGroupId=group,text=text,detailsDeferred=text.isEmpty())

    @Test fun sameRecordIdsInDifferentConversationsKeepIndependentDetailsAndGroups(){
        val first=event("A","output",text="A的输出")
        val second=event("B","output",text="B的输出")
        val groups=mapOf(("A" to "group") to listOf(event("A","output")),("B" to "group") to listOf(event("B","output")))
        val details=mapOf(("A" to "output") to first,("B" to "output") to second)
        assertEquals(listOf(first,second),hydrateNativeActivities(listOf(event("A","summary","group"),event("B","summary","group")),groups,details))
        assertEquals(listOf(second,first),hydrateNativeActivities(listOf(event("B","output"),event("A","output")),groups,details))
    }

    @Test fun unopenedAndUnrelatedCachedActivitiesKeepTheOriginalSnapshot(){
        val events=(0 until 5000).map{event("A","event:$it")}
        assertSame(events,hydrateNativeActivities(events,emptyMap(),emptyMap()))
        assertSame(events,hydrateNativeActivities(events,mapOf(("B" to "group") to listOf(event("B","event:0"))),mapOf(("B" to "event:0") to event("B","event:0",text="其他会话"))))
        // An empty group cannot remove its placeholder before a successful load.
        assertSame(events,hydrateNativeActivities(events,mapOf(("A" to "") to emptyList()),emptyMap()))
    }

    @Test fun loadedActivitiesReplaceOnlyTheirOwnEntriesWithoutMutatingTheOriginal(){
        val before=event("A","before")
        val summary=event("A","summary","group")
        val after=event("A","after")
        val events=listOf(before,summary,after)
        val grouped=event("A","grouped",text="组内输出")
        val loaded=event("A","after",text="单条输出")
        val groups=mapOf(("A" to "group") to listOf(grouped))
        val details=mapOf(("A" to "after") to loaded)
        assertEquals(listOf(before,grouped,loaded),hydrateNativeActivities(events,groups,details))
        assertEquals(listOf(before,summary,after),events)
        assertTrue(after.detailsDeferred)
        val alreadyLoaded=listOf(grouped,loaded)
        assertSame(alreadyLoaded,hydrateNativeActivities(alreadyLoaded,groups,details))
    }
}
