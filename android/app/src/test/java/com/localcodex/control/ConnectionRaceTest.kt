package com.localcodex.control

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class ConnectionRaceTest {
    @Test fun responsiveLanDoesNotStartPublicProbe()=runBlocking{
        val called=mutableListOf<String>()
        val chosen=firstResponsiveRoute(listOf("local","public")){called.add(it);"ok"}
        assertEquals("local",chosen.first)
        assertEquals(listOf("local"),called)
    }
    @Test fun publicSuccessCancelsUnreachableLanInsteadOfWaitingForTimeout()=runBlocking{
        var localCancelled=false
        val chosen=firstResponsiveRoute(listOf("local","public"),10){route->
            if(route=="local")try{awaitCancellation()}finally{localCancelled=true}
            "ok"
        }
        assertEquals("public",chosen.first)
        assertTrue(localCancelled)
    }
    @Test fun failedPreferredRouteDoesNotHideWorkingFallback()=runBlocking{
        val chosen=firstResponsiveRoute(listOf("local","public"),0){route->
            if(route=="local")error("unreachable")
            "ok"
        }
        assertEquals("public",chosen.first)
    }
    @Test fun healthyHttpWithBrokenSocketStillAttemptsTheOtherRoute()=runBlocking{
        val routes=listOf("local","public")
        val healthy=firstResponsiveRoute(routes){"HTTP 200"}
        val handshakes=mutableListOf<String>()
        val connected=nativeConnectionAttemptRoutes(routes,healthy.first).firstOrNull{route->
            handshakes.add(route)
            route=="public"
        }
        assertEquals("public",connected)
        assertEquals(listOf("local","public"),handshakes)
        assertEquals(listOf("public","local"),nativeConnectionAttemptRoutes(routes,"public"))
        assertEquals(listOf("local"),nativeConnectionAttemptRoutes(listOf("local"),"local"))
    }
}
