package com.localcodex.control

import java.io.ByteArrayInputStream
import java.io.IOException
import okhttp3.RequestBody
import okio.Buffer
import okio.BufferedSink
import org.junit.Assert.*
import org.junit.Test

class NativeUploadProgressTest {
    @Test fun knownSizeCountsUnchangedBytesAndEndsWaitingForAcknowledgement(){
        val bytes=ByteArray(40000){(it%251).toByte()}
        val progress=mutableListOf<NativeUploadProgress>()
        val body=nativeUploadProgressBody(nativeFileUploadBody({ByteArrayInputStream(bytes)},bytes.size.toLong())){progress+=it}
        val sink=Buffer();body.writeTo(sink)
        assertArrayEquals(bytes,sink.readByteArray())
        assertEquals(NativeUploadProgress(0,40000),progress.first())
        assertEquals(NativeUploadProgress(40000,40000,true),progress.last())
        assertTrue(progress.zipWithNext().all{(a,b)->a.sentBytes<=b.sentBytes})
    }
    @Test fun unknownSizeReportsBytesWithoutInventingAPercentage(){
        val progress=mutableListOf<NativeUploadProgress>()
        val body=nativeUploadProgressBody(nativeFileUploadBody({ByteArrayInputStream(byteArrayOf(1,2,3))},-1)){progress+=it}
        assertEquals(-1L,body.contentLength())
        body.writeTo(Buffer())
        assertTrue(progress.all{it.totalBytes==null})
        assertEquals(NativeUploadProgress(3,null,true),progress.last())
    }
    @Test fun interruptedBodyNeverReportsThatItIsWaitingForSuccess(){
        val progress=mutableListOf<NativeUploadProgress>()
        val source=object:RequestBody(){
            override fun contentType()=null
            override fun contentLength()=20000L
            override fun writeTo(sink:BufferedSink){sink.write(ByteArray(8192));throw IOException("source failed")}
        }
        assertThrows(IOException::class.java){nativeUploadProgressBody(source){progress+=it}.writeTo(Buffer())}
        assertTrue(progress.none{it.waitingForResponse})
    }
}
