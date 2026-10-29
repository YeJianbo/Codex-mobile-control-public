package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test
import java.net.URLDecoder

class NativeFileCitationTest{
    private val directive=":codex-file-citation{path=\"D:/codex/project/skill/output/墨尔本 航班_%20#最终.xlsx\" artifact_kind=\"workbook\" purpose=\"output\"}"

    @Test fun workbookBecomesAFileLinkInTheAnswerAndCopyText(){
        val rendered=nativeAnswerText("已改好。\n\n$directive")
        assertTrue(rendered.startsWith("已改好。\n\n[墨尔本 航班\\_%20#最终.xlsx](<"))
        val target=rendered.substringAfter("(<").substringBefore(">)")
        assertEquals("D:/codex/project/skill/output/墨尔本 航班_%20#最终.xlsx",URLDecoder.decode(target,"UTF-8"))
        assertFalse(rendered.contains("artifact_kind"));assertFalse(rendered.contains("codex-file-citation"))
    }
    @Test fun literalExamplesAndIncompleteOrNonlocalReferencesStayLiteral(){
        for(source in listOf("`$directive`","```text\n$directive\n```","~~~\n$directive\n~~~","    $directive","\\$directive",
            ":codex-file-citation{path=\"javascript:alert(1)\"}",":codex-file-citation{path=\"//server/share/file.xlsx\"}",directive.dropLast(1))){
            assertEquals(source,nativeFileCitationMarkdown(source))
        }
    }
    @Test fun ordinaryLinksAndMultipleAttachmentsKeepTheirOrder(){
        val source="[查看 PDF](<D:/report.pdf>)\n\n$directive\n$directive"
        val rendered=nativeFileCitationMarkdown(source)
        assertTrue(rendered.startsWith("[查看 PDF](<D:/report.pdf>)\n\n"))
        assertEquals(2,Regex("\\[墨尔本").findAll(rendered).count())
        assertEquals(rendered,nativeFileCitationMarkdown(rendered))
    }
}
