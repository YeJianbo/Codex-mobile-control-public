package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeTableTextTest{
    @Test fun escapedPipesInlineMarkupAndSeparatorLikeDataKeepTheirColumns(){
        val source="""
            | 名称 | 内容 | 备注 |
            | --- | :---: | ---: |
            | **模型** | `a\|b` | [文档](https://example.com) |
            | A\|B | --- | 一<br>二 |
            | 缺列 |
        """.trimIndent()
        val rows=nativeTableRows(source)
        assertEquals(listOf(listOf("名称","内容","备注"),listOf("模型","a|b","文档"),
            listOf("A|B","---","一\n二"),listOf("缺列","","")),rows)
        assertEquals("名称\t内容\t备注\n模型\ta|b\t文档\nA|B\t---\t一 二\n缺列\t\t",nativeTableTsv(rows))
    }
}
