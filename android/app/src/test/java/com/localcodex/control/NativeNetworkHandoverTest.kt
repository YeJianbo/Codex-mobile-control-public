package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeNetworkHandoverTest {
    @Test fun initialNetworkAndRepeatedCallbacksDoNotRestartConnections() {
        val handover=NativeNetworkHandover("wifi")
        assertFalse(handover.available("wifi"))
        assertFalse(handover.available("wifi"))
        assertTrue(handover.available("cellular"))
        handover.lost("wifi")
        assertFalse(handover.available("cellular"))
    }

    @Test fun returningAfterNetworkLossWakesRecoveryEvenWithSameNetworkIdentity() {
        val handover=NativeNetworkHandover("wifi")
        assertFalse(handover.available("wifi"))
        handover.lost("wifi")
        assertTrue(handover.available("wifi"))
        assertFalse(handover.available("wifi"))
    }

    @Test fun firstNetworkAfterOfflineStartupWakesPendingConnection() {
        val handover=NativeNetworkHandover<String>(null)
        assertTrue(handover.available("wifi"))
        assertFalse(handover.available("wifi"))
    }
}
