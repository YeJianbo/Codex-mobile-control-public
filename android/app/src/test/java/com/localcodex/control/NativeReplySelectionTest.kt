package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test
import kotlinx.coroutines.runBlocking
import androidx.compose.ui.text.TextRange

class NativeReplySelectionTest {
    @Test fun preparationKeepsMarkdownAnchorsAndRepeatedSegmentOffsets()=runBlocking{
        val source="**重复正文**\n\n**重复正文**"
        val prepared=prepareNativeTextSelection(source,"**重复正文**","**重复正文**\n\n".length)
        assertEquals("重复正文\n\n重复正文",prepared.plain)
        assertEquals(TextRange(6,10),prepared.selection)
        val code=prepareNativeTextSelection("**正文**\n\n导入 `proxy-groups` 和 `rules`。","proxy-groups",null)
        assertEquals("正文\n\n导入 proxy-groups 和 rules。",code.plain)
        assertEquals("proxy-groups",code.plain.substring(code.selection.min,code.selection.max))
    }
    @Test fun longMarkdownConversionKeepsTheEndOfTheReply(){
        val source="## 标题\n\n段落 **加粗** 和 `code`。\n\n".repeat(4000)+"**最后选择段**"
        val started=System.nanoTime()
        val plain=nativeSelectablePlainText(source)
        val elapsed=(System.nanoTime()-started)/1_000_000.0
        println("isolatedSelectionParse chars=${source.length} millis=$elapsed")
        assertTrue(plain.endsWith("最后选择段"));assertFalse(plain.contains("**"));assertTrue(plain.contains("code"))
    }
    @Test fun selectionStaysInOneReplyAndLocatesRepeatedTextAfterAnOperation(){
        fun event(type:String,id:String,text:String="")=ChatEvent(type=type,threadId="t",eventId=id,itemId=id,text=text)
        val timeline=nativeTimeline(listOf(
            event("user.message","u1","用户气泡一"),event("turn.started","s1"),
            event("message.delta","a1","重复正文"),event("tool.started","tool","工具私有输出"),
            event("message.delta","a2","重复正文"),event("turn.completed","e1"),
            event("user.message","u2","用户气泡二"),event("turn.started","s2"),
            event("message.delta","b1","第二轮正文"),event("turn.completed","e2")
        ),"t")
        val process=timeline.single{it.event.type=="process.completed"}
        val first=process.children.single{it.event.itemId=="a1"}
        val conclusion=timeline.single{it.event.itemId=="a2"}
        val next=timeline.single{it.event.itemId=="b1"}
        val chosen=checkNotNull(nativeReplySelection(timeline,conclusion.key))
        assertEquals("重复正文\n\n重复正文",chosen.document)
        assertEquals("重复正文".length+2,chosen.blockStart)
        assertEquals("重复正文",chosen.blockText)
        val fromProcess=checkNotNull(nativeReplySelection(timeline,first.key))
        assertEquals(chosen.document,fromProcess.document)
        assertEquals(0,fromProcess.blockStart)
        assertEquals("第二轮正文",nativeReplySelection(timeline,next.key)?.document)
        assertNull(nativeReplySelection(timeline,timeline.first().key))
        assertNull(nativeReplySelection(timeline,process.key))
        assertNull(nativeReplySelection(timeline,process.children.single{it.activities.isNotEmpty()}.key))
        assertFalse(chosen.document.contains("工具私有输出"))
    }

    @Test fun selectionKeepsRunningSegmentsInOrderWithoutIncludingReasoningOrTools(){
        fun event(type:String,id:String,text:String="")=ChatEvent(type=type,threadId="t",eventId=id,itemId=id,text=text)
        val timeline=nativeTimeline(listOf(
            event("user.message","u","用户正文"),event("turn.started","s"),
            event("message.delta","a1","**第一段**"),event("reasoning.summary","r","内部思考"),
            event("tool.started","tool","工具输出"),event("message.delta","a2","后续段落")
        ),"t",running=true)
        assertFalse(timeline.any{it.event.type=="process.completed"})
        val chosen=checkNotNull(nativeReplySelection(timeline,timeline.single{it.event.itemId=="a2"}.key))
        assertEquals("**第一段**\n\n后续段落",chosen.document)
        assertEquals("**第一段**".length+2,chosen.blockStart)
        assertNull(nativeReplySelection(timeline,"missing"))
    }
}
