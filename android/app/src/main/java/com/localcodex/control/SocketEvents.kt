package com.localcodex.control

import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.takeWhile

internal fun <T> socketEvents(discardPendingOnClose:Boolean=false,onBufferOverflow:()->Unit={},onConsumerFailure:(Throwable)->Unit={},connect: ((T) -> Boolean, (Throwable?) -> Unit) -> (() -> Unit)): Flow<T> = flow {
    val failure=AtomicReference<Throwable?>()
    val finished=AtomicBoolean()
    callbackFlow<T> {
    fun fail(error:Throwable){failure.compareAndSet(null,error);finished.set(true);close(error)}
    val disconnect = connect({ event ->
        val sent = trySend(event)
        // Socket callbacks also read pongs. Never block that reader on the UI.
        // Overflow ends this connection so the existing reconnect path reloads
        // history and submission receipts instead of silently dropping events.
        if (sent.isFailure && !isClosedForSend) {onBufferOverflow();fail(IOException("实时连接需要重新同步"))}
        sent.isSuccess
    }, { error -> if(error!=null)fail(error) else {finished.set(true);close()}; Unit })
    awaitClose { disconnect() }
// One reconnect replays at most 100 events; leave room for concurrent live work
// while keeping a slow consumer's backlog bounded.
    }.buffer(256).takeWhile {
        // Chat restores closed transports through history and receipts; its
        // stale queue must not hold the UI. Notification readers keep queued work.
        failure.get()?.let{throw it}
        !discardPendingOnClose||!finished.get()
    }.collect { event ->
        try{emit(event)}catch(error:Throwable){
            if(error !is kotlinx.coroutines.CancellationException)onConsumerFailure(error)
            throw error
        }
    }
}
