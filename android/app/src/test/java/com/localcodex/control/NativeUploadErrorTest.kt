package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeUploadErrorTest {
    @Test fun htmlFailurePreservesStatusAndCompleteServerResponse(){
        val raw="<html>\nupstream unavailable\n</html>"
        val error=NativeUploadResponseException(502,nativeUploadHttpSummary(502),raw)
        assertTrue(error.message!!.contains("HTTP 502"))
        assertTrue(error.message!!.endsWith(raw))
        assertTrue(error.message!!.startsWith("上传服务暂时不可用"))
    }
    @Test fun emptyResponsesHaveAUsefulReasonAndServerMessagesTakePrecedence(){
        val error=NativeUploadResponseException(413,nativeUploadHttpSummary(413),"")
        assertEquals("文件超过上传入口允许的大小（HTTP 413）",error.message)
        assertEquals("目标目录没有写入权限",nativeUploadHttpSummary(403,"\n目标目录没有写入权限\n完整诊断"))
        val invalid=NativeUploadResponseException(200,"电脑返回了无法识别的上传结果","")
        assertTrue(invalid.message!!.contains("HTTP 200"))
    }
}
