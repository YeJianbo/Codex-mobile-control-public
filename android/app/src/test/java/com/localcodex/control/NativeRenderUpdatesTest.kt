package com.localcodex.control

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import org.junit.Assert.*
import org.junit.Test

class NativeRenderUpdatesTest {
    @Test fun finishesCurrentVersionThenPreparesOnlyNewestPendingVersion()=runBlocking {
        val source=Channel<String>()
        val started=CompletableDeferred<Unit>()
        val release=CompletableDeferred<Unit>()
        val prepared=mutableListOf<String>()
        val published=mutableListOf<String>()
        val collector=launch {
            collectNativeRenderUpdates(source.receiveAsFlow(),{input->
                prepared+=input
                if(input=="A"){started.complete(Unit);release.await()}
                input.lowercase()
            }){input,result->published+="$input:$result"}
        }
        try {
            withTimeout(2000){
                source.send("A");started.await()
                source.send("B");source.send("C");source.close()
                release.complete(Unit);collector.join()
            }
            assertEquals(listOf("A","C"),prepared)
            assertEquals(listOf("A:a","C:c"),published)
        } finally { release.complete(Unit);source.cancel();collector.cancelAndJoin() }
    }

    @Test fun cancelledOwnerCannotPublishResultEvenWhenPreparationFinishes()=runBlocking {
        val source=Channel<String>()
        val started=CompletableDeferred<Unit>()
        val release=CompletableDeferred<Unit>()
        val published=mutableListOf<String>()
        val collector=launch {
            collectNativeRenderUpdates(source.receiveAsFlow(),{input->
                withContext(NonCancellable){started.complete(Unit);release.await()}
                input
            }){input,_->published+=input}
        }
        try {
            withTimeout(2000){
                source.send("old");started.await()
                collector.cancel();release.complete(Unit);collector.join()
            }
            assertTrue(published.isEmpty())
        } finally { release.complete(Unit);source.cancel();collector.cancelAndJoin() }
    }
}
