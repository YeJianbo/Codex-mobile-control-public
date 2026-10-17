package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeActivityPreparationTest {
    private class CountedEvents(private val rows:List<ChatEvent>):AbstractList<ChatEvent>(){
        var reads=0
        override val size get()=rows.size
        override fun get(index:Int):ChatEvent{reads++;return rows[index]}
    }
    private fun item(type:String,title:String,events:List<ChatEvent>)=
        NativeActivityItem("item",title,type,"",emptyList(),listOf("event"),false,events)

    @Test fun outputDependentPatchDetectionWaitsForDetailPreparation(){
        val patch="*** Begin Patch\n*** Update File: source.kt\n@@\n-before\n+after\n*** End Patch"
        val events=CountedEvents(listOf(ChatEvent(type="tool.started",eventId="event",command=patch)))
        val entry=item("tool.started","编辑文件",events)
        events.reads=0
        assertFalse(entry.knownChange)
        assertEquals(0,events.reads)
        val prepared=prepareNativeActivityDetail(entry)
        assertSame(entry,prepared.entry);assertTrue(prepared.isChange);assertEquals(patch,prepared.text)
        assertTrue(events.reads>0)
        val preparedReads=events.reads
        assertEquals(prepared,prepareNativeActivityDetail(entry))
        assertEquals(preparedReads,events.reads)
    }

    @Test fun fileChangeMetadataIdentifiesTheViewerWithoutScanningSourceEvents(){
        for(type in listOf("file.changed","diff.updated")){
            val patch="@@ -1 +1 @@\n-before\n+after"
            val events=CountedEvents(listOf(ChatEvent(type=type,eventId="event",diff=patch)))
            val entry=item(type,"编辑文件",events);events.reads=0
            assertTrue(entry.knownChange);assertEquals(0,events.reads)
            val prepared=prepareNativeActivityDetail(entry)
            assertTrue(prepared.isChange);assertEquals(patch,prepared.text)
        }
    }

    @Test fun ordinaryOutputAndReasoningHeadingKeepTheirPreparedContent(){
        val output=item("tool.completed","编辑文件",listOf(ChatEvent(type="tool.completed",text="更新完成")))
        val prepared=prepareNativeActivityDetail(output)
        assertFalse(prepared.isChange);assertEquals("更新完成",prepared.text)
        val thought=item("reasoning.summary","检查配置",listOf(ChatEvent(type="reasoning.summary",text="**检查配置**")))
        assertEquals("",prepareNativeActivityDetail(thought).text)
        val detailed=item("reasoning.summary","检查配置",listOf(ChatEvent(type="reasoning.summary",text="检查配置\n保留正文")))
        assertEquals("保留正文",prepareNativeActivityDetail(detailed).text)
    }
}
