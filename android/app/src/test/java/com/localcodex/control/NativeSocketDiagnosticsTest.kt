package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeSocketDiagnosticsTest {
    @Test fun firstCauseSurvivesTheCancellationCallbackAndContainsOnlyMetadata(){
        var time=100L;val reports=mutableListOf<String>()
        val trace=NativeSocketTrace("chat","0.6.464",{time},reports::add)
        time=150;trace.received();time=250
        trace.finish("focus_timeout");trace.finish("io_error")
        assertEquals(1,reports.size)
        val path=reports.single()
        assertTrue(path.contains("cause=focus_timeout"));assertTrue(path.contains("durationMs=150&idleMs=100&frames=1"))
        assertFalse(path.contains("token="));assertFalse(path.contains("threadId="))
    }
    @Test fun failedReportWaitsForTheNextConnectionAndTheOutboxRemainsBounded(){
        val sent=mutableListOf<String>();val callbacks=ArrayDeque<(Boolean)->Unit>()
        val reports=NativeSocketDiagnostics{path,done->sent.add(path);callbacks.addLast(done)}
        reports.record("lost");callbacks.removeFirst()(false)
        assertEquals(listOf("lost"),sent)
        reports.flush();callbacks.removeFirst()(true)
        assertEquals(listOf("lost","lost"),sent)
        reports.record("busy")
        repeat(20){reports.record("next-$it")}
        callbacks.removeFirst()(true)
        while(callbacks.isNotEmpty())callbacks.removeFirst()(true)
        assertEquals(19,sent.size)
        assertEquals("next-4",sent[3]);assertEquals("next-19",sent.last())
    }
    @Test fun socketFailureCategoriesKeepRawExceptionTextOutOfReports(){
        assertEquals("ping_timeout",nativeSocketFailureCause(java.net.SocketTimeoutException("sent ping but didn't receive pong within 20000ms")))
        assertEquals("socket_timeout",nativeSocketFailureCause(java.net.SocketTimeoutException("private URL")))
        assertEquals("socket_error",nativeSocketFailureCause(java.net.SocketException("Connection reset")))
        assertEquals("tls_error",nativeSocketFailureCause(javax.net.ssl.SSLException("private certificate")))
    }
}
