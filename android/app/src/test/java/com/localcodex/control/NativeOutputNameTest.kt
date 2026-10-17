package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeOutputNameTest {
    @Test fun decodedNamesKeepLiteralPercentHashesAndTheirExtension(){
        for(name in listOf("进度 100%20#终稿.pdf","预算#2026.md","photo%2Fdetail.png")){
            assertEquals(name,nativeOutputName(name))
            assertEquals(name,nativeOutputName(nativeOutputName(name)))
        }
    }
    @Test fun rawPathsStillYieldPortableBasenames(){
        assertEquals("文档#1.pdf",nativeOutputName("C:\\报告\\文档#1.pdf"))
        assertEquals("文档_1.pdf",nativeOutputName("/报告/文档:1.pdf"))
        assertEquals("Codex-file",nativeOutputName("/"))
    }
}
