package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class ConnectionRouteTest {
    private val local="https://192.168.1.2:38457"
    private val remote="https://phone.example.com"
    @Test fun gatewayApkLinksUseTheActiveDownloadRoute(){
        val addresses=listOf(local,remote,"")
        for(href in listOf("$local/downloads/android.apk","$remote/downloads/android.apk?download=1#latest","HTTPS://PHONE.EXAMPLE.COM:443/downloads/android.apk","/downloads/android.apk"))
            assertEquals("/downloads/android.apk",nativeGatewayDownloadEndpoint(href,addresses))
    }
    @Test fun otherOriginsAndResourcesRemainExternal(){
        val addresses=listOf(local,remote)
        for(href in listOf("https://other.example.com/downloads/android.apk","http://phone.example.com/downloads/android.apk","https://phone.example.com:8443/downloads/android.apk","https://user@phone.example.com/downloads/android.apk","//phone.example.com/downloads/android.apk","https://phone.example.com/docs/readme.pdf","https://phone.example.com/downloads/other.apk","https://phone.example.com/downloads/%61ndroid.apk","not a url"))
            assertNull(href,nativeGatewayDownloadEndpoint(href,addresses))
    }
    @Test fun manualPublicBypassesLanAndManualLocalNeverFallsBack(){
        assertEquals(listOf(remote),connectionRouteCandidates(local,remote,"password",ConnectionRoute.PUBLIC))
        assertEquals(listOf(local),connectionRouteCandidates(local,remote,"password",ConnectionRoute.LOCAL))
    }
    @Test fun automaticModeOffersBothRoutesWithoutDuplicateLanTimeout(){
        assertEquals(listOf(local,remote),connectionRouteCandidates(local,remote,"password"))
        assertEquals(listOf(local),connectionRouteCandidates(local,remote,""))
        assertTrue(connectionRouteCandidates(local,remote,"",ConnectionRoute.PUBLIC).isEmpty())
    }
    @Test fun passedPublicTestPreservesConnectedLanOrSamePublic(){
        assertFalse(shouldConnectTestedPublic(true,local,local,remote))
        assertFalse(shouldConnectTestedPublic(true,remote,local,remote))
    }
    @Test fun passedPublicTestConnectsWhenDisconnectedEvenWithStaleActiveAddress(){
        assertTrue(shouldConnectTestedPublic(false,local,local,remote))
        assertTrue(shouldConnectTestedPublic(false,remote,local,remote))
        assertTrue(shouldConnectTestedPublic(false,"",local,remote))
        assertTrue(shouldConnectTestedPublic(true,"https://old.example.com",local,remote))
    }
}
