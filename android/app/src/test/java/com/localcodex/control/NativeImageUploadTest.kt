package com.localcodex.control

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class NativeImageUploadTest {
    @Test fun detectsHeicContentEvenWhenPickerCallsItJpeg() {
        val heic=byteArrayOf(0,0,0,24)+"ftypheic".toByteArray()+ByteArray(12)
        assertEquals("image/heic",nativeImageContentMime(heic))
        assertEquals("image/jpeg",nativeImageContentMime(byteArrayOf(-1,-40,-1,0)))
        assertEquals("image/webp",nativeImageContentMime("RIFF1234WEBP".toByteArray()))
        assertNull(nativeImageContentMime("<html>not an image</html>".toByteArray()))
    }

    @Test fun supportedImagesKeepOriginalBytesAndUseContentMime()=runBlocking {
        val png=byteArrayOf(-119,80,78,71,13,10,26,10)+ByteArray(10)
        val prepared=prepareNativeImageUpload(png)
        assertSame(png,prepared.bytes)
        assertEquals("image/png",prepared.mime)
    }

    @Test fun decodingDimensionsAreBoundedBeforeAllocatingPixels() {
        assertEquals(1200 to 2000,nativeImageUploadSize(1200,2000))
        for((width,height) in listOf(12000 to 9000,24000 to 1200,1200 to 24000)){
            val target=nativeImageUploadSize(width,height)
            assertTrue(target.first>0&&target.second>0)
            assertTrue(maxOf(target.first,target.second)<=4096)
            assertTrue(target.first.toLong()*target.second<=8_000_000)
            val aspect=width.toDouble()/height
            assertEquals(aspect,target.first.toDouble()/target.second,aspect*.005)
        }
    }
}
