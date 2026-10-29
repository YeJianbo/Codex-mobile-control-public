package com.localcodex.control

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

enum class NativeTextEncoding(val charset:Charset,private val prefix:ByteArray){
    UTF8(Charsets.UTF_8,byteArrayOf(-17,-69,-65)),
    UTF16_LE(Charsets.UTF_16LE,byteArrayOf(-1,-2)),
    UTF16_BE(Charsets.UTF_16BE,byteArrayOf(-2,-1));
    internal fun hasPrefix(bytes:ByteArray)=bytes.size>=prefix.size&&prefix.indices.all{bytes[it]==prefix[it]}
    internal val prefixSize get()=prefix.size
    internal fun encode(text:String,hasBom:Boolean):ByteArray=text.toByteArray(charset).let{if(hasBom)prefix+it else it}
}

internal fun nativeWorkspaceParentPath(path:String,root:String):String? {
    val current=path.replace('\\','/').trim('/')
    val boundary=root.replace('\\','/').trim('/')
    if(current==boundary||boundary.isNotEmpty()&&!current.startsWith("$boundary/"))return null
    return current.substringBeforeLast('/',"")
}

internal data class NativeDecodedText(val content:String,val encoding:NativeTextEncoding,val hasBom:Boolean)
internal fun nativeDecodeText(bytes:ByteArray):NativeDecodedText?{
    // UTF-32 prefixes overlap UTF-16LE; keep unsupported data for system opening.
    if(bytes.size>=4&&(bytes[0]==(-1).toByte()&&bytes[1]==(-2).toByte()&&bytes[2]==0.toByte()&&bytes[3]==0.toByte()||
        bytes[0]==0.toByte()&&bytes[1]==0.toByte()&&bytes[2]==(-2).toByte()&&bytes[3]==(-1).toByte()))return null
    val encoding=NativeTextEncoding.entries.firstOrNull{it.hasPrefix(bytes)}?:NativeTextEncoding.UTF8
    val hasBom=encoding.hasPrefix(bytes)
    val offset=if(hasBom)encoding.prefixSize else 0
    return try{
        val decoder=encoding.charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        NativeDecodedText(decoder.decode(ByteBuffer.wrap(bytes,offset,bytes.size-offset)).toString(),encoding,hasBom)
    }catch(_:CharacterCodingException){null}
}

fun nativeIsMarkdownFile(name:String,mime:String=""):Boolean =
    name.let{it.endsWith(".md",true)||it.endsWith(".markdown",true)} || mime in setOf("text/markdown","text/x-markdown")

internal fun nativeIsTextFile(name:String,mime:String):Boolean =
    mime.startsWith("text/") || mime in setOf("application/json","application/xml","application/yaml","application/x-yaml","application/toml","application/javascript") ||
        name.substringAfterLast('.',"").lowercase() in setOf("txt","log","json","csv","tsv","yaml","yml","toml","xml","html","htm","css","js","ts","py","sh","kt","java","go","rs","c","h","cpp","hpp","sql","ps1","bat","ini","cfg","tex","bib","r")

internal fun nativeUploadedMime(name:String,mime:String):String {
    val type=mime.substringBefore(';').trim().lowercase()
    if(type.isNotBlank()&&type!="application/octet-stream")return type
    if(nativeIsMarkdownFile(name))return "text/markdown"
    val inferred=nativeOutputMime(name)
    return if(inferred=="application/octet-stream"&&nativeIsTextFile(name,""))"text/plain" else inferred
}

fun nativeFileEndpoint(state:NativeState,href:String)=nativeFileEndpointForPath(state,nativeOutputLinkPath(href))
internal fun nativeWorkspaceFilePath(project:Project,path:String):String =
    nativeLocalFilePath(project.path).trimEnd('/')+"/"+path.replace('\\','/').trimStart('/')

internal fun nativeFileEndpointForPath(state:NativeState,path:String):String {
    val file=nativeLocalFilePath(path)
    val absolute=file.startsWith('/')||Regex("^[a-zA-Z]:/").containsMatchIn(file)
    val selectedPath=state.threads.find{it.id==state.threadId}?.projectPath.orEmpty()
    val project=if(absolute)state.projects.sortedByDescending{it.path.length}.find{nativePath(file).startsWith(nativePath(it.path)+"/")}
        else state.projects.find{it.id==state.projectId}?:state.projects.find{selectedPath.isNotBlank()&&nativePath(it.path)==nativePath(selectedPath)}
    require(project!=null){if(absolute)"文件不在已授权项目中，请在电脑网关添加对应目录后重试" else "无法确定文件所属项目，请先选择会话项目"}
    val relative=if(absolute)file.substring(nativePath(project.path).length+1)else file
    return "/raw/projects/${project.id}/file?path=${URLEncoder.encode(relative,"UTF-8")}" 
}
internal fun nativeMarkdownTarget(sourcePath:String,href:String):String {
    if(href.startsWith("#"))return href
    val normalized=href.replace('\\','/')
    val base=sourcePath.replace('\\','/').substringBeforeLast('/',"")
    val absolute=normalized.startsWith('/')||Regex("^[A-Za-z]:/").containsMatchIn(normalized)||normalized.contains("://")
    return if(absolute||base.isBlank())normalized else "$base/$normalized"
}
fun nativeThreadOutputEndpoint(threadId:String,eventId:String,href:String,sourcePath:String=""):String {
    val name=nativeOutputLinkName(href)
    return "/api/threads/${Uri.encode(threadId)}/output-file/${Uri.encode(name)}?eventId=${Uri.encode(eventId)}&path=${Uri.encode(href)}"+if(sourcePath.isBlank())"" else "&source=${Uri.encode(sourcePath)}"
}
internal fun nativeThreadDirectoryEndpoint(directory:NativeOutputDirectory,path:String,browse:Boolean=false):String =
    nativeThreadOutputEndpoint(directory.threadId,directory.eventId,path)+"&directory=${Uri.encode(directory.href)}"+if(browse)"&browse=1" else ""
internal fun nativeOpenSavedFile(context:Context,uri:Uri,mime:String){
    android.widget.Toast.makeText(context,if(mime.startsWith("image/"))"图片已保存到相册/Codex" else "已保存到下载/Codex",android.widget.Toast.LENGTH_SHORT).show()
    val view=Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    try{context.startActivity(view)}catch(e:android.content.ActivityNotFoundException){
        val share=Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(share,"保存或打开文件").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
