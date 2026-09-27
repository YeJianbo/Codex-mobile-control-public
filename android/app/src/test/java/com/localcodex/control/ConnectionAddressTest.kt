package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionAddressTest {
    @Test
    fun emptyBaseUrlDoesNotInjectExampleAddress() {
        assertEquals(ConnectionDraft("", ""), parseConnectionDraft(""))
    }

    @Test
    fun parseSavedHttpUrlIntoHostAndPort() {
        assertEquals(ConnectionDraft("192.168.31.76", "38457"), parseConnectionDraft("http://192.168.31.76:38457"))
    }

    @Test
    fun bareHostAndPortUsesHttps() {
        assertEquals(
            listOf("https://192.168.31.76:38457"),
            gatewayBaseUrlCandidates("192.168.31.76", "38457"),
        )
    }

    @Test
    fun blankPortUsesGatewayDefaultPort() {
        assertEquals(
            listOf("https://192.168.31.76:38457"),
            gatewayBaseUrlCandidates("192.168.31.76", ""),
        )
    }

    @Test
    fun explicitSchemeIsRespectedAndPortIsAddedOnlyWhenMissing() {
        assertEquals(
            listOf("https://pc.local"),
            gatewayBaseUrlCandidates("https://pc.local", "38457"),
        )
        assertEquals(
            listOf("https://pc.local:4443"),
            gatewayBaseUrlCandidates("https://pc.local:4443", "38457"),
        )
    }
}
