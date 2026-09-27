package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionStatusTest {
    @Test
    fun reconnectDelayUsesCappedBackoff() {
        assertEquals(1_000L, reconnectDelayMillis(0))
        assertEquals(2_000L, reconnectDelayMillis(1))
        assertEquals(4_000L, reconnectDelayMillis(2))
        assertEquals(8_000L, reconnectDelayMillis(3))
        assertEquals(15_000L, reconnectDelayMillis(4))
        assertEquals(15_000L, reconnectDelayMillis(20))
    }

    @Test
    fun connectionLabelShowsReconnectState() {
        assertEquals("在线", connectionLabel(connected = true, reconnecting = true, attempt = 3))
        assertEquals("重连中 2", connectionLabel(connected = false, reconnecting = true, attempt = 2))
        assertEquals("重连中 1", connectionLabel(connected = false, reconnecting = true, attempt = 0))
        assertEquals("离线", connectionLabel(connected = false, reconnecting = false, attempt = 0))
    }

    @Test
    fun autoConnectRequiresSavedConnectionAndNoPairFlow() {
        assertEquals(true, shouldAutoConnectSavedConnection("http://pc:38457", "token", "", alreadyAttempted = false, connected = false))
        assertEquals(false, shouldAutoConnectSavedConnection("", "token", "", alreadyAttempted = false, connected = false))
        assertEquals(false, shouldAutoConnectSavedConnection("http://pc:38457", "", "", alreadyAttempted = false, connected = false))
        assertEquals(false, shouldAutoConnectSavedConnection("http://pc:38457", "token", "123456", alreadyAttempted = false, connected = false))
        assertEquals(false, shouldAutoConnectSavedConnection("http://pc:38457", "token", "", alreadyAttempted = true, connected = false))
        assertEquals(false, shouldAutoConnectSavedConnection("http://pc:38457", "token", "", alreadyAttempted = false, connected = true))
    }

    @Test
    fun autoOpenedConnectionDialogClosesOnlyAfterNormalConnection() {
        assertEquals(true, shouldAutoCloseConnectionDialog(connected = true, autoOpened = true))
        assertEquals(false, shouldAutoCloseConnectionDialog(connected = false, autoOpened = true))
        assertEquals(false, shouldAutoCloseConnectionDialog(connected = true, autoOpened = false))
    }

    @Test
    fun connectFailureReconnectRequiresSavedUsableCredentials() {
        assertEquals(true, shouldScheduleReconnectAfterConnectFailure("http://pc:38457", "token", "timeout"))
        assertEquals(true, shouldScheduleReconnectAfterConnectFailure("http://pc:38457", "token", "Connection refused"))
        assertEquals(false, shouldScheduleReconnectAfterConnectFailure("", "token", "timeout"))
        assertEquals(false, shouldScheduleReconnectAfterConnectFailure("http://pc:38457", "", "timeout"))
    }

    @Test
    fun connectFailureDoesNotReconnectForeverOnAuthErrors() {
        assertEquals(false, shouldScheduleReconnectAfterConnectFailure("http://pc:38457", "token", "HTTP 401"))
        assertEquals(false, shouldScheduleReconnectAfterConnectFailure("http://pc:38457", "token", "HTTP 403"))
    }
}
