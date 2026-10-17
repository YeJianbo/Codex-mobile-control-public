package com.localcodex.control
import org.junit.Assert.*
import org.junit.Test

class BackendAvailabilityTest {
    private val claude=NativeModel("claude::default","Claude Code",emptyList(),"")
    @Test fun publicRestrictionWinsOverCachedModel(){
        val backends=listOf(NativeBackend("claude",false,"当前公网入口不支持该助手",true))
        assertFalse(nativeBackendAvailable("claude",listOf(claude),backends))
        assertTrue(nativeBackendReason("claude",listOf(claude),backends).contains("公网"))
    }
    @Test fun legacyCatalogWorksButDisabledEntryCannotBeSelected(){
        assertTrue(nativeBackendAvailable("claude",listOf(claude),emptyList()))
        assertFalse(nativeBackendAvailable("claude",listOf(claude.copy(available=false)),emptyList()))
    }
}
