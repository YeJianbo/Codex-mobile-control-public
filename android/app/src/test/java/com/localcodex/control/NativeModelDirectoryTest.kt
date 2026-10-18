package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeModelDirectoryTest {
    @Test fun pendingSourceKeepsSelectionUntilItsDirectoryCompletes(){
        val codex=NativeModel("gpt-6.1-sol","Sol",listOf("high"),"high")
        val claude=NativeModel("claude::grok-4.6","Grok 4.6",emptyList(),"")
        val previous=listOf(codex,claude)
        assertEquals(previous,nativeMergeModelDirectory(listOf(codex),previous,setOf("claude")))
        assertEquals(listOf(codex),nativeMergeModelDirectory(listOf(codex),previous,emptySet()))
        assertEquals(previous,nativeMergeModelDirectory(previous,previous,setOf("claude")))
    }
}
