package com.localcodex.control

import java.io.IOException
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import org.junit.Assert.*
import org.junit.Test

class SocketEventsTest {
    @Test fun consumerFailureIsIdentifiedBeforeTheSocketIsCancelled()=runBlocking {
        val connected=CompletableDeferred<(Int)->Boolean>();val failed=CompletableDeferred<Throwable>()
        val cleanup=CompletableDeferred<Boolean>();val expected=IllegalStateException("fixture")
        val collector=launch{
            try{socketEvents<Int>(onConsumerFailure={failed.complete(it)}){emit,_->
                connected.complete(emit);{cleanup.complete(failed.isCompleted);Unit}
            }.collect{throw expected}}catch(error:IllegalStateException){assertEquals(expected.message,error.message)}
        }
        try{
            val emit=withTimeout(2000){connected.await()};assertTrue(emit(1))
            val actual=withTimeout(2000){failed.await()}
            assertEquals(expected.javaClass,actual.javaClass);assertEquals(expected.message,actual.message)
            assertTrue(withTimeout(2000){cleanup.await()})
        }finally{collector.cancelAndJoin()}
    }
    @Test fun replayAndLiveBurstDoNotBlockTheSocketReaderWhileUiIsPaused() = runBlocking {
        val connected = CompletableDeferred<(Int) -> Boolean>()
        val firstReceived = CompletableDeferred<Unit>()
        val releaseUi = CompletableDeferred<Unit>()
        val callbackReachedPong = CompletableDeferred<Unit>()
        val delivered = CompletableDeferred<Unit>()
        val values = mutableListOf<Int>()
        val flow = socketEvents<Int> { emit, _ -> connected.complete(emit); {} }
        val collector = launch(Dispatchers.Default) {
            flow.collect { event ->
                values.add(event)
                if (event == 0) { firstReceived.complete(Unit); releaseUi.await() }
                if (event == 128) delivered.complete(Unit)
            }
        }
        val emit = withTimeout(2000) { connected.await() }
        assertTrue(emit(0)); withTimeout(2000) { firstReceived.await() }
        val reader = launch(Dispatchers.IO) {
            for (event in 1..128) check(emit(event))
            callbackReachedPong.complete(Unit)
        }
        try {
            withTimeout(2000) { callbackReachedPong.await() }
            assertFalse(delivered.isCompleted)
            releaseUi.complete(Unit)
            withTimeout(2000) { delivered.await() }
            assertEquals((0..128).toList(), values)
        } finally {
            releaseUi.complete(Unit); reader.join(); collector.cancelAndJoin()
        }
    }

    @Test fun overflowRequestsResyncAndCleansUpInsteadOfDroppingWhileConnected() = runBlocking {
        val connected = CompletableDeferred<(Int) -> Boolean>()
        val firstReceived = CompletableDeferred<Unit>()
        val releaseUi = CompletableDeferred<Unit>()
        val disconnected = CompletableDeferred<Unit>()
        val failure = CompletableDeferred<Throwable>()
        var overflows=0
        val flow = socketEvents<Int>(onBufferOverflow={overflows++}) { emit, _ -> connected.complete(emit); { disconnected.complete(Unit); Unit } }
        val collector = launch(Dispatchers.Default) {
            try { flow.collect { if (it == 0) { firstReceived.complete(Unit); releaseUi.await() } } }
            catch (error: IOException) { failure.complete(error) }
        }
        try {
            val emit = withTimeout(2000) { connected.await() }
            assertTrue(emit(0)); withTimeout(2000) { firstReceived.await() }
            for (event in 1..256) assertTrue(emit(event))
            assertFalse(emit(257)); assertFalse(emit(258))
            releaseUi.complete(Unit)
            assertTrue(withTimeout(2000) { failure.await() } is IOException)
            withTimeout(2000) { disconnected.await() }
            assertEquals(1,overflows)
        } finally { releaseUi.complete(Unit); collector.cancelAndJoin() }
    }

    @Test fun cancellingTheCollectionClosesItsOwnSocketOnce() = runBlocking {
        val connected = CompletableDeferred<Unit>()
        var closes = 0
        val collector = launch { socketEvents<Int> { _, _ -> connected.complete(Unit); { closes++; Unit } }.collect {} }
        withTimeout(2000) { connected.await() }
        collector.cancelAndJoin()
        assertEquals(1, closes)
    }

    @Test fun transportFailureStartsRecoveryWithoutDrainingTheStaleBacklog() = runBlocking {
        val connected=CompletableDeferred<Pair<(Int)->Boolean,(Throwable?)->Unit>>()
        val firstReceived=CompletableDeferred<Unit>();val releaseUi=CompletableDeferred<Unit>()
        val disconnected=CompletableDeferred<Unit>();val failure=CompletableDeferred<Throwable>()
        val values=mutableListOf<Int>();val expected=IOException("connection reset")
        val collector=launch(Dispatchers.Default){
            try{socketEvents<Int>{emit,finish->connected.complete(emit to finish);{disconnected.complete(Unit);Unit}}.collect{
                values.add(it)
                if(it==0){firstReceived.complete(Unit);releaseUi.await()}
            }}catch(error:IOException){failure.complete(error)}
        }
        try{
            val (emit,finish)=withTimeout(2000){connected.await()}
            assertTrue(emit(0));withTimeout(2000){firstReceived.await()}
            for(event in 1..128)assertTrue(emit(event))
            finish(expected)
            withTimeout(2000){disconnected.await()}
            releaseUi.complete(Unit)
            val actual=withTimeout(2000){failure.await()}
            assertEquals(expected.javaClass,actual.javaClass)
            assertEquals(expected.message,actual.message)
            assertEquals(listOf(0),values)
        }finally{releaseUi.complete(Unit);collector.cancelAndJoin()}
    }

    @Test fun normalTransportCloseStartsRecoveryWithoutDeliveringTheStaleBacklog() = runBlocking {
        val connected=CompletableDeferred<Pair<(Int)->Boolean,(Throwable?)->Unit>>()
        val firstReceived=CompletableDeferred<Unit>();val releaseUi=CompletableDeferred<Unit>()
        val disconnected=CompletableDeferred<Unit>();val completed=CompletableDeferred<Unit>()
        val values=mutableListOf<Int>();var closes=0
        val collector=launch(Dispatchers.Default){
            socketEvents<Int>(discardPendingOnClose=true){emit,finish->connected.complete(emit to finish);{closes++;disconnected.complete(Unit);Unit}}.collect{
                values.add(it)
                if(it==0){firstReceived.complete(Unit);releaseUi.await()}
            }
            completed.complete(Unit)
        }
        try{
            val (emit,finish)=withTimeout(2000){connected.await()}
            assertTrue(emit(0));withTimeout(2000){firstReceived.await()}
            for(event in 1..256)assertTrue(emit(event))
            finish(null)
            withTimeout(2000){disconnected.await()}
            assertFalse(emit(257));assertFalse(completed.isCompleted)
            releaseUi.complete(Unit)
            withTimeout(2000){completed.await()};collector.join()
            assertEquals(listOf(0),values);assertEquals(1,closes)
        }finally{releaseUi.complete(Unit);collector.cancelAndJoin()}
    }

    @Test fun normalCloseKeepsQueuedEventsForConsumersWithoutHistoryRecovery() = runBlocking {
        val connected=CompletableDeferred<Pair<(Int)->Boolean,(Throwable?)->Unit>>()
        val firstReceived=CompletableDeferred<Unit>();val releaseUi=CompletableDeferred<Unit>()
        val disconnected=CompletableDeferred<Unit>();val values=mutableListOf<Int>()
        val collector=launch(Dispatchers.Default){
            socketEvents<Int>{emit,finish->connected.complete(emit to finish);{disconnected.complete(Unit);Unit}}.collect{
                values.add(it)
                if(it==0){firstReceived.complete(Unit);releaseUi.await()}
            }
        }
        try{
            val (emit,finish)=withTimeout(2000){connected.await()}
            assertTrue(emit(0));withTimeout(2000){firstReceived.await()}
            for(event in 1..128)assertTrue(emit(event))
            finish(null);withTimeout(2000){disconnected.await()}
            releaseUi.complete(Unit);withTimeout(2000){collector.join()}
            assertEquals((0..128).toList(),values)
        }finally{releaseUi.complete(Unit);collector.cancelAndJoin()}
    }
}
