package com.localcodex.control

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import org.junit.Assert.*
import org.junit.Test

class NativeNotificationWorkTest {
    @Test fun slowNotificationReadsDoNotHoldSocketConsumptionAndAreBounded()=runBlocking {
        val owner=CoroutineScope(coroutineContext+SupervisorJob(coroutineContext[Job]))
        val work=NativeNotificationWork(owner)
        val connected=CompletableDeferred<(Int)->Boolean>()
        val consumed=CompletableDeferred<Unit>()
        val loaded=CompletableDeferred<Unit>()
        val release=CompletableDeferred<Unit>()
        var active=0;var maximum=0;var started=0
        val collector=launch {
            socketEvents<Int>{emit,_->connected.complete(emit);{}}.collect{event->
                work.launch("task:$event"){
                    active++;started++;maximum=maxOf(maximum,active)
                    if(active==2)loaded.complete(Unit)
                    try{release.await()}finally{active--}
                }
                if(event==4)consumed.complete(Unit)
            }
        }
        try{
            val emit=withTimeout(2000){connected.await()}
            repeat(5){assertTrue(emit(it))}
            withTimeout(2000){consumed.await();loaded.await()}
            assertEquals(2,started);assertEquals(2,maximum)
        }finally{collector.cancelAndJoin();work.clear();release.complete(Unit);owner.cancel()}
    }

    @Test fun newerWorkCancelsOldReadWithoutOldCleanupRemovingTheReplacement()=runBlocking {
        val work=NativeNotificationWork(this)
        val started=CompletableDeferred<Unit>()
        val cancelled=CompletableDeferred<Unit>()
        val replacement=CompletableDeferred<Unit>()
        val replacementCancelled=CompletableDeferred<Unit>()
        try{
            work.launch("task:t"){
                suspendCancellableCoroutine<Unit>{waiting->started.complete(Unit);waiting.invokeOnCancellation{cancelled.complete(Unit)}}
                fail("Cancelled read must not publish a notification")
            }
            withTimeout(2000){started.await()}
            work.launch("task:t"){
                replacement.complete(Unit)
                try{awaitCancellation()}finally{replacementCancelled.complete(Unit)}
            }
            withTimeout(2000){cancelled.await();replacement.await()}
            yield()
            assertTrue(work.running("task:t"))
            work.cancel("task:t")
            withTimeout(2000){replacementCancelled.await()}
            assertFalse(work.running("task:t"))
        }finally{work.clear()}
    }

    @Test fun closingOneConnectionCancelsItsActiveAndQueuedWorkOnly()=runBlocking {
        val old=NativeNotificationWork(this,1)
        val next=NativeNotificationWork(this,1)
        val started=CompletableDeferred<Unit>()
        val cancelled=CompletableDeferred<Unit>()
        val nextStarted=CompletableDeferred<Unit>()
        var queuedStarted=false
        try{
            old.launch("task:t"){
                started.complete(Unit)
                try{awaitCancellation()}finally{cancelled.complete(Unit)}
            }
            withTimeout(2000){started.await()}
            old.launch("task:queued"){queuedStarted=true}
            next.launch("task:t"){nextStarted.complete(Unit);awaitCancellation()}
            withTimeout(2000){nextStarted.await()}
            old.clear()
            withTimeout(2000){cancelled.await()}
            yield()
            assertFalse(queuedStarted)
            assertTrue(next.running("task:t"))
            assertTrue(currentCoroutineContext().isActive)
        }finally{old.clear();next.clear()}
    }
}
