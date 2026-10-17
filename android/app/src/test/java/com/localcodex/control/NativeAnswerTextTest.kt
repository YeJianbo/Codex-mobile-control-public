package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class NativeAnswerTextTest {
    @Test fun removesWrappedAndUnwrappedMetadata(){
        val body="修复已完成。\n\n检查通过。"
        val footer="<citation_entries> MEMORY.md:1-2|note=[test] </citation_entries> <rollout_ids>test-id</rollout_ids>"
        assertEquals(body,nativeAnswerText("$body\n\n$footer"))
        assertTrue(nativeAnswerContent("$body\n\n$footer").hasMemoryReferences)
        assertEquals(listOf(NativeMemoryReference("MEMORY.md","1–2","test")),nativeAnswerContent("$body\n\n$footer").memoryReferences)
        assertEquals(body,nativeAnswerText("$body\n\n<oai-mem-citation>\n$footer\n</oai-mem-citation>"))
        assertTrue(nativeAnswerContent("$body\n\n<oai-mem-citation>\n$footer\n</oai-mem-citation>").hasMemoryReferences)
        val entries="<citation_entries>MEMORY.md:1-2|note=[项目范围]\nrollout_summaries/session.md:8-8|note=[图像预览]</citation_entries>"
        assertEquals(listOf(NativeMemoryReference("MEMORY.md","1–2","项目范围"),NativeMemoryReference("rollout_summaries/session.md","8","图像预览")),nativeAnswerContent("$body\n$entries").memoryReferences)
    }
    @Test fun hidesAnUnfinishedStreamingFooter(){
        assertEquals("正文。",nativeAnswerText("正文。\n\n<citation_entries>\nMEMORY.md:1-2"))
        assertTrue(nativeAnswerContent("正文。\n\n<citation_entries>\nMEMORY.md:1-2").hasMemoryReferences)
        assertTrue(nativeAnswerContent("正文。\n\n<citation_entries>\nMEMORY.md:1-2").memoryReferences.isEmpty())
        assertEquals("前文。\n\n后文。",nativeAnswerText("前文。\n<citation_entries>hidden</citation_entries>\n后文。"))
    }
    @Test fun preservesLiteralCodeAndOrdinaryText(){
        val code="```xml\n<citation_entries>example</citation_entries>\n```"
        assertEquals(code,nativeAnswerText(code))
        assertFalse(nativeAnswerContent(code).hasMemoryReferences)
        assertFalse(nativeAnswerContent("普通回复。").hasMemoryReferences)
        assertEquals("正文\n\n",nativeAnswerText("正文\n\n"))
        assertEquals("正文里讨论 `<citation_entries>` 标签。",nativeAnswerText("正文里讨论 `<citation_entries>` 标签。"))
        assertFalse(nativeAnswerContent("正文里讨论 `<citation_entries>` 标签。").hasMemoryReferences)
    }
}
