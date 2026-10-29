package com.localcodex.control

import java.io.IOException
import java.net.SocketTimeoutException

/** Connection metadata only: no message, address, token or conversation identifier. */
internal class NativeSocketTrace(private val stream:String,private val version:String,
    private val now:()->Long,private val report:(String)->Unit) {
    private val id=java.util.UUID.randomUUID().toString()
    private val started=now()
    private var receivedAt:Long?=null
    private var frames=0
    private var finished=false
    @Synchronized fun received(){receivedAt=now();frames++}
    fun finish(cause:String,code:Int?=null,errorType:String?=null){
        val path=synchronized(this){
            if(finished)return
            finished=true
            val at=now()
            "/api/diagnostics/performance?androidSocket=$id&version=$version&stream=$stream&cause=$cause"+
                "&durationMs=${at-started}&idleMs=${receivedAt?.let{at-it}?:-1}&frames=$frames"+(code?.let{"&code=$it"}?:"")+
                (errorType?.let{"&errorType="+java.net.URLEncoder.encode(it,"UTF-8")}?:"")
        }
        report(path)
    }
}

/** Retry failed reports when transport returns, without another timer or disk writes. */
internal class NativeSocketDiagnostics(private val send:(String,(Boolean)->Unit)->Unit) {
    private val pending=ArrayDeque<String>()
    private var sending=false
    fun record(path:String){
        synchronized(this){if(pending.size==16)pending.removeFirst();pending.addLast(path)}
        flush()
    }
    fun flush(){
        val path=synchronized(this){if(sending||pending.isEmpty())return;sending=true;pending.first()}
        send(path){ok->
            synchronized(this){if(ok&&pending.firstOrNull()==path)pending.removeFirst();sending=false}
            if(ok)flush()
        }
    }
}

internal fun nativeSocketFailureCause(error:Throwable):String = when {
    error is IOException&&error.message?.contains("sent ping but didn't receive pong",true)==true->"ping_timeout"
    error is SocketTimeoutException->"socket_timeout"
    error is javax.net.ssl.SSLException->"tls_error"
    error is java.net.SocketException->"socket_error"
    error is IOException->"io_error"
    else->"transport_error"
}
