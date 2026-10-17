package com.localcodex.control

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import java.io.IOException
import java.io.InputStream
import java.net.URLEncoder
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import okio.BufferedSink
import okio.Buffer
import okio.ForwardingSink
import okio.buffer
import kotlinx.coroutines.suspendCancellableCoroutine

internal fun nativePickedFileInfo(resolver:ContentResolver,uri:Uri,fallback:String):Pair<String,Long> =
    resolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE),null,null,null)?.use{cursor->
        if(!cursor.moveToFirst())return@use null
        val nameIndex=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        val sizeIndex=cursor.getColumnIndex(OpenableColumns.SIZE)
        val name=if(nameIndex>=0)cursor.getString(nameIndex)?.takeIf{it.isNotBlank()}?:fallback else fallback
        val size=if(sizeIndex>=0&&!cursor.isNull(sizeIndex))cursor.getLong(sizeIndex).takeIf{it>=0}?:-1L else -1L
        name to size
    }?: (fallback to -1L)

internal fun nativeUploadNameHeader(name:String)=URLEncoder.encode(name,"UTF-8").replace("+","%20")

internal fun nativeUploadHttpSummary(status:Int,message:String?=null):String =
    message?.lineSequence()?.firstOrNull{it.isNotBlank()}?:when(status){
        401->"上传凭据未通过验证，请检查配对"
        403->"上传请求被电脑或公网入口拒绝"
        413->"文件超过上传入口允许的大小"
        429->"上传请求过于频繁，请稍后重试"
        502,503->"上传服务暂时不可用，请稍后重试"
        504->"上传服务响应超时，请稍后重试"
        else->"上传失败"
    }

internal class NativeUploadResponseException(status:Int,summary:String,body:String):IOException(
    "$summary（HTTP $status）"+if(body.isBlank())"" else "\n\n$body"
)

data class NativeUploadProgress(val sentBytes:Long,val totalBytes:Long?,val waitingForResponse:Boolean=false)

internal fun nativeUploadProgressBody(body:RequestBody,onProgress:(NativeUploadProgress)->Unit):RequestBody = object:RequestBody(){
    override fun contentType()=body.contentType()
    override fun contentLength()=body.contentLength()
    override fun isOneShot()=body.isOneShot()
    override fun isDuplex()=body.isDuplex()
    override fun writeTo(sink:BufferedSink){
        val total=contentLength().takeIf{it>=0}
        var sent=0L;var updatedAt=System.nanoTime()
        onProgress(NativeUploadProgress(0,total))
        val tracked=object:ForwardingSink(sink){
            override fun write(source:Buffer,byteCount:Long){
                super.write(source,byteCount);sent+=byteCount
                val now=System.nanoTime()
                if(sent==total||now-updatedAt>=150_000_000L){
                    updatedAt=now;onProgress(NativeUploadProgress(sent,total))
                }
            }
        }.buffer()
        body.writeTo(tracked)
        tracked.flush()
        onProgress(NativeUploadProgress(sent,total,waitingForResponse=true))
    }
}

internal suspend fun <T> awaitNativeUpload(call:Call,read:(Response)->T):T = suspendCancellableCoroutine{continuation->
    continuation.invokeOnCancellation{call.cancel()}
    call.enqueue(object:Callback{
        override fun onFailure(call:Call,e:IOException){continuation.resumeWith(Result.failure(e))}
        override fun onResponse(call:Call,response:Response){
            if(!continuation.isActive){response.close();return}
            continuation.resumeWith(runCatching{response.use(read)})
        }
    })
}

internal fun nativeFileUploadBody(input:()->InputStream,size:Long):RequestBody {
    val limit=100L*1024*1024
    require(size>=-1){"无法读取文件大小"}
    require(size!=0L){"文件不能为空"}
    require(size<=limit){"文件不能超过 100 MB"}
    return object:RequestBody(){
        override fun contentType()="application/octet-stream".toMediaType()
        override fun contentLength()=size
        override fun writeTo(sink:BufferedSink){
            input().use{source->
                val chunk=ByteArray(32768);var total=0L
                while(true){
                    val count=source.read(chunk)
                    if(count<0)break
                    total+=count
                    if(total>limit)throw IOException("文件不能超过 100 MB")
                    if(size>=0&&total>size)throw IOException("文件大小已变化，请重新选择")
                    sink.write(chunk,0,count)
                }
                if(total==0L)throw IOException("文件不能为空")
                if(size>=0&&total!=size)throw IOException("文件大小已变化，请重新选择")
            }
        }
    }
}
