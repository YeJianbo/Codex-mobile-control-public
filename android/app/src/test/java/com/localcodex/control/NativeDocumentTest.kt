package com.localcodex.control
import org.junit.Test
import org.junit.Assert.*
class NativeDocumentTest {
    @Test fun separatesCodeMathAndTablesWithoutRenderingCodeAsMath(){
        val text="正文 \$x\$\n\n```kotlin\nval price = \"\$x\"\n```\n\n\$\$\nx^2+y^2=z^2\n\$\$\n\n| 名称 | 数值 |\n| --- | --- |\n| A | 1 |\n\n尾段"
        val parts=nativeDocumentParts(text)
        assertEquals(listOf("text","code","math","table","text"),parts.map{it.kind})
        assertEquals("kotlin",parts[1].language)
        assertEquals("val price = \"\$x\"",parts[1].text)
    }
    @Test fun incompleteStreamingFenceRemainsCode(){
        assertEquals("fun main() {",nativeDocumentParts("```kotlin\nfun main() {").single().text)
        assertEquals("code",nativeDocumentParts("~~~~\n```\n~~~~").single().kind)
    }
}
