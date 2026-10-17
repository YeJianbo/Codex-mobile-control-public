package com.localcodex.control

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.junit.Assert.*
import org.junit.Test

class NativeConnectionRecoveryTest {
    @Test fun restartCancelsPendingRouteProbeBeforeItsTimeout()=runBlocking {
        val wake=Channel<Unit>(Channel.CONFLATED)
        val probing=CompletableDeferred<Unit>()
        var cancelled=false
        var socketOpened=false
        val attempt=async {
            runNativeConnectionAttempt(wake){
                suspendCancellableCoroutine<Unit>{pending->
                    probing.complete(Unit)
                    pending.invokeOnCancellation{cancelled=true}
                }
                socketOpened=true
            }
        }
        try {
            withTimeout(2000){probing.await();wake.send(Unit);assertTrue(attempt.await())}
            assertTrue(cancelled);assertFalse(socketOpened)
        } finally { attempt.cancelAndJoin();wake.cancel() }
    }

    @Test fun restartWaitsForOldSocketCleanupAndCancelsItsMetadataReads()=runBlocking {
        val wake=Channel<Unit>(Channel.CONFLATED)
        val connected=CompletableDeferred<Unit>()
        val closing=CompletableDeferred<Unit>()
        val release=CompletableDeferred<Unit>()
        val metadataStarted=CompletableDeferred<Unit>()
        var metadataClosed=false
        var closes=0
        val attempt=async {
            runNativeConnectionAttempt(wake){
                launch {try{metadataStarted.complete(Unit);awaitCancellation()}finally{metadataClosed=true}}
                try{connected.complete(Unit);awaitCancellation()}finally{
                    withContext(NonCancellable){closing.complete(Unit);release.await();closes++}
                }
            }
        }
        try {
            withTimeout(2000){connected.await();metadataStarted.await();wake.send(Unit);closing.await()}
            assertFalse(attempt.isCompleted)
            release.complete(Unit)
            assertTrue(withTimeout(2000){attempt.await()})
            assertEquals(1,closes);assertTrue(metadataClosed)
            assertFalse(runNativeConnectionAttempt(wake){})
        } finally { release.complete(Unit);attempt.cancelAndJoin();wake.cancel() }
    }

    @Test fun disconnectCancelsAttemptWithoutStartingRecovery()=runBlocking {
        val wake=Channel<Unit>(Channel.CONFLATED)
        val connected=CompletableDeferred<Unit>()
        var closes=0
        var returned=false
        val owner=launch {
            runNativeConnectionAttempt(wake){try{connected.complete(Unit);awaitCancellation()}finally{closes++}}
            returned=true
        }
        try {
            withTimeout(2000){connected.await();owner.cancelAndJoin()}
            assertFalse(returned);assertEquals(1,closes)
        } finally { owner.cancelAndJoin();wake.cancel() }
    }

    @Test fun healthyIdleSocketKeepsItsOwnerAndFreshDataCanSatisfyProbe()=runBlocking {
        val response=CompletableDeferred<Boolean>().apply{complete(true)}
        assertTrue(probeNativeConnection(20,{true},response){false})
        assertTrue(probeNativeConnection(20,{true},CompletableDeferred()){true})
        assertFalse(probeNativeConnection(20,{true},CompletableDeferred()){false})
        assertFalse(probeNativeConnection(20,{false},CompletableDeferred()){true})
    }

    @Test fun cancelledForegroundProbeDoesNotRunFailureRecovery()=runBlocking {
        val sent=CompletableDeferred<Unit>()
        var recovered=false
        val check=launch {
            if(!probeNativeConnection(60000,{sent.complete(Unit);true},CompletableDeferred()){false})recovered=true
        }
        withTimeout(2000){sent.await();check.cancelAndJoin()}
        assertFalse(recovered)
    }
}
