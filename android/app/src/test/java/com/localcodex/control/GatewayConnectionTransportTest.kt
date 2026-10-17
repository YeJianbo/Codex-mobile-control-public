package com.localcodex.control

import java.net.InetAddress
import java.net.ServerSocket
import java.io.IOException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test

class GatewayConnectionTransportTest {
    @Test fun connectionProbeAndSubmissionReceiptBypassSaturatedDataQueueAndKeepAuthentication(){
        val workers=Executors.newCachedThreadPool()
        val server=ServerSocket(0,50,InetAddress.getByName("127.0.0.1"))
        val started=CountDownLatch(5)
        val release=CountDownLatch(1)
        val data=OkHttpClient.Builder().addInterceptor{chain->chain.proceed(chain.request().newBuilder().header("Authorization","Bearer local-test-only").build())}.build()
        val connection=data.connectionTransport()
        val responses=mutableListOf<CompletableFuture<String>>()
        fun enqueue(client:OkHttpClient,path:String):CompletableFuture<String>{
            val result=CompletableFuture<String>()
            client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}$path").build()).enqueue(object:Callback{
                override fun onFailure(call:Call,e:IOException){result.completeExceptionally(e)}
                override fun onResponse(call:Call,response:Response){response.use{result.complete(it.body!!.string())}}
            })
            return result
        }
        workers.submit{
            while(!server.isClosed){
                val socket=try{server.accept()}catch(error:IOException){if(server.isClosed)break else throw error}
                workers.submit{socket.use{peer->
                    peer.soTimeout=4000
                    val reader=peer.getInputStream().bufferedReader()
                    val path=reader.readLine().split(' ')[1]
                    var authorization=""
                    while(true){
                        val line=reader.readLine()?:break
                        if(line.isEmpty())break
                        if(line.substringBefore(':').equals("Authorization",true))authorization=line.substringAfter(':').trim()
                    }
                    if(path=="/slow"){started.countDown();release.await(10,TimeUnit.SECONDS)}
                    val bytes=(if(path=="/slow")"done" else authorization).toByteArray()
                    peer.getOutputStream().apply{
                        write("HTTP/1.1 200 OK\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        write(bytes);flush()
                    }
                }}
            }
        }
        try{
            repeat(5){responses.add(enqueue(data,"/slow"))}
            assertTrue("Slow data calls must be active",started.await(3,TimeUnit.SECONDS))
            val sharedProbe=enqueue(data,"/probe")
            assertEquals(5,data.dispatcher.runningCallsCount())
            assertTrue(data.dispatcher.queuedCalls().any{it.request().url.encodedPath=="/probe"})
            assertFalse(sharedProbe.isDone)
            assertNotSame(data.dispatcher,connection.dispatcher)
            assertSame(data.connectionPool,connection.connectionPool)
            assertSame(data.sslSocketFactory,connection.sslSocketFactory)
            assertSame(data.hostnameVerifier,connection.hostnameVerifier)
            assertEquals(data.pingIntervalMillis,connection.pingIntervalMillis)
            assertEquals("Bearer local-test-only",enqueue(connection,"/probe").get(3,TimeUnit.SECONDS))
            val receiptPath="/api/threads/fixture/submission?requestId=fixture-request"
            assertEquals("Bearer local-test-only",enqueue(data.requestTransport(connection,"GET",receiptPath),receiptPath).get(3,TimeUnit.SECONDS))
            val historyPath="/api/threads/fixture/events?turns=10"
            val queuedHistory=enqueue(data.requestTransport(connection,"GET",historyPath),historyPath)
            assertTrue(data.dispatcher.queuedCalls().any{it.request().url.encodedPath.endsWith("/events")})
            assertFalse(queuedHistory.isDone)
            assertEquals(1L,release.count)
            assertTrue(responses.none{it.isDone})
            release.countDown()
            assertEquals("Bearer local-test-only",sharedProbe.get(3,TimeUnit.SECONDS))
            assertEquals("Bearer local-test-only",queuedHistory.get(3,TimeUnit.SECONDS))
            responses.forEach{assertEquals("done",it.get(3,TimeUnit.SECONDS))}
        }finally{
            release.countDown();data.dispatcher.cancelAll();connection.dispatcher.cancelAll()
            server.close();workers.shutdownNow()
            data.connectionPool.evictAll()
            data.dispatcher.executorService.shutdownNow();connection.dispatcher.executorService.shutdownNow()
        }
    }
}
