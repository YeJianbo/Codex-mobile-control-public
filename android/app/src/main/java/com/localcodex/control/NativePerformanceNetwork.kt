package com.localcodex.control

import android.os.SystemClock
import okhttp3.*
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy

internal fun nativePerformanceListener(request:Request,publicConnection:Boolean):EventListener {
    if(!NativePerformanceRecorder.session.active)return EventListener.NONE
    val path=request.url.encodedPath
    val operation=when {
        path.endsWith("/health")->NativeNetworkOperation.HEALTH
        path.endsWith("/ws")->NativeNetworkOperation.SOCKET
        path.endsWith("/api/models")->NativeNetworkOperation.MODELS
        path.endsWith("/api/sidebar")->NativeNetworkOperation.SIDEBAR
        path.contains("/api/threads/")&&path.endsWith("/events")->NativeNetworkOperation.HISTORY
        else->return EventListener.NONE
    }
    val store=NativePerformanceRecorder.session
    val ticket=store.beginNetwork(operation,if(publicConnection)NativePerformanceRoute.PUBLIC else NativePerformanceRoute.LOCAL)?:return EventListener.NONE
    return object:EventListener(){
        private var dnsStart=0L;private var connectStart=0L;private var tlsStart=0L
        private var dnsMs=0L;private var connectMs=0L;private var tlsMs=0L
        private var firstByte:Long?=null;private var status:Int?=null
        private var phase="request"
        private var finished=false
        override fun dnsStart(call:Call,domainName:String){phase="dns";dnsStart=SystemClock.elapsedRealtime()}
        override fun dnsEnd(call:Call,domainName:String,inetAddressList:List<InetAddress>){dnsMs+=SystemClock.elapsedRealtime()-dnsStart}
        override fun connectStart(call:Call,inetSocketAddress:InetSocketAddress,proxy:Proxy){phase="connect";connectStart=SystemClock.elapsedRealtime()}
        override fun connectEnd(call:Call,inetSocketAddress:InetSocketAddress,proxy:Proxy,protocol:Protocol?){if(connectStart>0)connectMs+=SystemClock.elapsedRealtime()-connectStart;connectStart=0;phase="response"}
        override fun secureConnectStart(call:Call){phase="tls";tlsStart=SystemClock.elapsedRealtime();connectMs+=tlsStart-connectStart;connectStart=0}
        override fun secureConnectEnd(call:Call,handshake:Handshake?){tlsMs+=SystemClock.elapsedRealtime()-tlsStart;phase="response"}
        override fun responseHeadersEnd(call:Call,response:Response){
            phase="body";firstByte=SystemClock.elapsedRealtime()-ticket.startedAt;status=response.code
            if(operation==NativeNetworkOperation.SOCKET&&response.code==101)finish(null)
        }
        override fun callEnd(call:Call){finish(null)}
        override fun callFailed(call:Call,ioe:IOException){
            val now=SystemClock.elapsedRealtime()
            when(phase){"dns"->dnsMs+=now-dnsStart;"connect"->if(connectStart>0)connectMs+=now-connectStart;"tls"->tlsMs+=now-tlsStart}
            finish(when{
            call.isCanceled()->"cancelled"
            ioe is java.io.InterruptedIOException->phase+"_timeout"
            ioe is javax.net.ssl.SSLException->"tls"
            ioe is java.net.ConnectException->"connect"
            else->"network"
        })}
        @Synchronized private fun finish(error:String?){if(!finished){finished=true;store.endNetwork(ticket,dnsMs,connectMs,tlsMs,firstByte,status,error)}}
    }
}
