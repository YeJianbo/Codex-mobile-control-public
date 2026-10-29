package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionAddressTest {
    @Test fun secretPublicAddressKeepsItsPrefixAndDownloadsStayInApp() {
        val base="https://phone.example.com/"+"a".repeat(64)
        assertEquals(null,publicConnectionAddressError(base))
        assertEquals(listOf(base),gatewayBaseUrlCandidates(base,"38457"))
        assertEquals("/downloads/android.apk",nativeGatewayDownloadEndpoint(base+"/downloads/android.apk",listOf(base)))
        assertEquals("/downloads/android.apk",nativeGatewayDownloadEndpoint("https://phone.example.com/downloads/android.apk",listOf(base)))
        assertEquals(null,nativeGatewayDownloadEndpoint("https://other.example.com/downloads/android.apk",listOf(base)))
        assertEquals(null,nativeGatewayDownloadEndpoint("https://phone.example.com/wrong/downloads/android.apk",listOf(base)))
        org.junit.Assert.assertNotNull(publicConnectionAddressError(base+"/../"))
        org.junit.Assert.assertNotNull(publicConnectionAddressError(base+"?x=1"))
        org.junit.Assert.assertNotNull(publicConnectionAddressError("https://phone.example.com/short"))
    }

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
