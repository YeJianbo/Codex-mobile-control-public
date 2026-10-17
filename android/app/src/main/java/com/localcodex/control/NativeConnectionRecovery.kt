package com.localcodex.control

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** One restart cancels discovery, HTTP probes and the socket before starting its replacement. */
internal suspend fun runNativeConnectionAttempt(restart:ReceiveChannel<Unit>,block:suspend CoroutineScope.()->Unit):Boolean=coroutineScope {
    var restarted=false
    val attempt=launch(start=CoroutineStart.LAZY,block=block)
    val watcher=launch(start=CoroutineStart.UNDISPATCHED){
        restart.receive()
        restarted=true
        attempt.cancel()
    }
    try{attempt.start();attempt.join();restarted}finally{watcher.cancel();attempt.cancel()}
}

internal suspend fun probeNativeConnection(timeoutMillis:Long,send:()->Boolean,reply:Deferred<Boolean>,freshTraffic:()->Boolean):Boolean {
    if(!send())return false
    return withTimeoutOrNull(timeoutMillis){reply.await()}==true||freshTraffic()
}

/** Seed from the actual network, so offline startup is distinct from a duplicate callback. */
internal class NativeNetworkHandover<T>(initial:T?) {
    private var current:T?=initial
    fun available(network:T):Boolean {
        val changed=current!=network
        current=network
        return changed
    }
    fun lost(network:T){if(current==network)current=null}
}
