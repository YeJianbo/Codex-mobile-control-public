package com.localcodex.control

import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull

/** A history snapshot starts only after this socket observes the selected stream. */
internal class NativeEventFocus {
    private class Pending(val socket:Any,val threadId:String){
        val id=UUID.randomUUID().toString()
        val ready=CompletableDeferred<Boolean>()
    }
    private var pending:Pending?=null
    fun request(socket:Any,threadId:String,send:(String)->Boolean){
        synchronized(this){
            if(pending?.let{it.socket===socket&&it.threadId==threadId}==true)return
            val value=Pending(socket,threadId)
            pending?.ready?.complete(false);pending=value
            if(!send(value.id))value.ready.complete(false)
        }
    }
    fun acknowledge(socket:Any,id:String,threadId:String):Boolean{
        val current=synchronized(this){pending?.takeIf{it.socket===socket&&it.id==id&&it.threadId==threadId}}?:return false
        return current.ready.complete(true)
    }
    suspend fun await(socket:Any,threadId:String,timeout:Long,onFailure:()->Unit={}):Boolean{
        val current=synchronized(this){pending?.takeIf{it.socket===socket&&it.threadId==threadId}}?:throw CancellationException("会话订阅已切换")
        val ready=withTimeoutOrNull(timeout){current.ready.await()}==true
        return synchronized(this){
            if(pending!==current)throw CancellationException("会话订阅已切换")
            if(!ready)onFailure()
            ready
        }
    }
    fun close(socket:Any){synchronized(this){
        if(pending?.socket===socket){pending?.ready?.complete(false);pending=null}
    }}
}
