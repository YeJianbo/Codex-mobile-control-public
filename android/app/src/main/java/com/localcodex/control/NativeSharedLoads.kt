package com.localcodex.control

import kotlinx.coroutines.*

/** Share one request while it has viewers; stop it when the last viewer leaves. */
internal class NativeSharedLoads<K,V>(private val scope:CoroutineScope) {
    private class Pending<V>(val job:Deferred<V>,var viewers:Int=0)
    private val lock=Any()
    private val pending=mutableMapOf<K,Pending<V>>()
    suspend fun get(key:K,fetch:suspend ()->V):V {
        val request=synchronized(lock){
            pending.getOrPut(key){Pending(scope.async(Dispatchers.IO,start=CoroutineStart.LAZY){fetch()})}.also{it.viewers++}
        }
        request.job.start()
        try{return request.job.await()}finally{
            synchronized(lock){
                request.viewers--
                if(request.viewers==0){
                    if(pending[key]===request)pending.remove(key)
                    request.job.cancel()
                }
            }
        }
    }
    fun clear(){synchronized(lock){pending.values.forEach{it.job.cancel()};pending.clear()}}
}
