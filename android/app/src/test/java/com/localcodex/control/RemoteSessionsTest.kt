package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class RemoteSessionsTest {
    @Test fun cloudSnapshotIdentityCannotBeConfusedWithAnOrdinaryCodexId(){
        val cloud="cloud-snapshot:01a0f135-2353-7567-bd3f-f0a6780f2008"
        assertTrue(nativeReadOnlyThreadId(cloud))
        assertFalse(nativeReadOnlyThreadId(cloud.substringAfter(':')))
        assertEquals("codex",nativeThreadAgent(cloud))
        assertEquals("未知",nativeSnapshotStatus("unexpected"))
    }
    @Test fun taskDefaultsFollowTheSelectedModelWithoutChangingGlobalSettings(){
        assertEquals("high",nativeTaskDefaultEffort("gpt-6.1-sol","medium"))
        assertEquals("medium",nativeTaskDefaultEffort("gpt-6-astra","high"))
        assertEquals("low",nativeTaskDefaultEffort("custom-model","low"))
    }
}
