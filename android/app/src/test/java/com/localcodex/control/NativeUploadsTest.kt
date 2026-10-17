package com.localcodex.control

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import okio.Buffer
import okio.blackholeSink
import okio.buffer
import org.junit.Assert.*
import org.junit.Test

class NativeUploadsTest {
    @Test fun unknownLengthStreamsAndClosesWithoutPretendingToBeEmpty(){
        var closed=false
        val body=nativeFileUploadBody({object:ByteArrayInputStream("payload".toByteArray()){
            override fun close(){closed=true;super.close()}
        }},-1)
        val sink=Buffer()
        assertEquals(-1L,body.contentLength())
        body.writeTo(sink)
        assertEquals("payload",sink.readUtf8())
        assertTrue(closed)
        assertThrows(IOException::class.java){nativeFileUploadBody({ByteArrayInputStream(byteArrayOf())},-1).writeTo(Buffer())}
        assertThrows(IllegalArgumentException::class.java){nativeFileUploadBody({error("must not open")},100L*1024*1024+1)}
    }
    @Test fun uploadHeaderDistinguishesSpacesFromLiteralPlusAndPercent(){
        assertEquals("draft%20%2B%20100%25.pdf",nativeUploadNameHeader("draft + 100%.pdf"))
    }
    @Test fun anUnknownSizeStillStopsAtTheUploadLimit(){
        var remaining=100L*1024*1024+1
        val body=nativeFileUploadBody({object:InputStream(){
            override fun read():Int=if(remaining-- >0)0 else -1
            override fun read(bytes:ByteArray,offset:Int,length:Int):Int{
                if(remaining==0L)return -1
                val count=minOf(remaining,length.toLong()).toInt()
                remaining-=count
                return count
            }
        }},-1)
        val error=assertThrows(IOException::class.java){blackholeSink().buffer().use{body.writeTo(it)}}
        assertEquals("文件不能超过 100 MB",error.message)
    }
}
