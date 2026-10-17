package com.localcodex.control

import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

/** Connection-owned work; callers and jobs use the owner's dispatcher. */
internal class NativeNotificationWork(private val scope:CoroutineScope,parallelism:Int=2) {
    private val permits=Semaphore(parallelism)
    private val jobs=mutableMapOf<String,Job>()

    fun running(key:String)=jobs[key]?.isActive==true
    fun launch(key:String,block:suspend ()->Unit){
        cancel(key)
        val job=scope.launch(start=CoroutineStart.LAZY){
            try{permits.withPermit{block()}}
            catch(error:CancellationException){throw error}
            catch(_:Exception){/* A failed notification never interrupts event delivery. */}
            finally{if(jobs[key]===currentCoroutineContext()[Job])jobs.remove(key)}
        }
        jobs[key]=job
        job.start()
    }
    fun cancel(key:String){jobs.remove(key)?.cancel()}
    fun clear(){val pending=jobs.values.toList();jobs.clear();pending.forEach{it.cancel()}}
}
