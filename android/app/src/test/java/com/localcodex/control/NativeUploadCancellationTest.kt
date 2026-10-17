package com.localcodex.control

import kotlinx.coroutines.*
import okhttp3.*
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.Timeout
import okio.buffer
import org.junit.Assert.*
import org.junit.Test

class NativeUploadCancellationTest {
    private class PendingCall:Call {
        private val request=Request.Builder().url("http://localhost/upload").build()
        lateinit var callback:Callback
        var cancelled=false
        override fun request()=request
        override fun execute():Response=error("asynchronous upload expected")
        override fun enqueue(responseCallback:Callback){callback=responseCallback}
        override fun cancel(){cancelled=true}
        override fun isExecuted()=this::callback.isInitialized
        override fun isCanceled()=cancelled
        override fun timeout()=Timeout()
        override fun clone():Call=PendingCall()
        fun respond(body:ResponseBody){callback.onResponse(this,Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body).build())}
    }
    private class TrackedBody:ResponseBody(){
        var closed=false
        private val source=object:ForwardingSource(Buffer().writeUtf8("done")){
            override fun close(){closed=true;super.close()}
        }.buffer()
        override fun contentType():MediaType?=null
        override fun contentLength()=4L
        override fun source():BufferedSource=source
    }
    @Test fun cancellationCancelsHttpAndDiscardsALateResponse()=runBlocking {
        val call=PendingCall();var consumed=false
        val task=async(start=CoroutineStart.UNDISPATCHED){awaitNativeUpload(call){consumed=true;it.body!!.string()}}
        task.cancelAndJoin()
        assertTrue(call.cancelled)
        val body=TrackedBody();call.respond(body)
        assertTrue(body.closed)
        assertFalse(consumed)
    }
    @Test fun successfulUploadReturnsItsResultAndClosesTheResponse()=runBlocking {
        val call=PendingCall()
        val task=async(start=CoroutineStart.UNDISPATCHED){awaitNativeUpload(call){it.body!!.string()}}
        val body=TrackedBody();call.respond(body)
        assertEquals("done",task.await())
        assertTrue(body.closed)
        assertFalse(call.cancelled)
    }
}
