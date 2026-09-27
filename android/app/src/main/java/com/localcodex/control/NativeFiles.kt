package com.localcodex.control

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.net.URLEncoder
import java.util.UUID

fun nativeIsMarkdownFile(name:String,mime:String=""):Boolean =
    name.substringBefore('?').substringBefore('#').let{it.endsWith(".md",true)||it.endsWith(".markdown",true)} || mime in setOf("text/markdown","text/x-markdown")

fun nativeFileEndpoint(state:NativeState,href:String):String {
    val file=Uri.decode(href).removePrefix("file://").replace('\\','/').removePrefix("//?/").replace(Regex("^/([a-zA-Z]:/)"),"$1").replace(Regex(":\\d+(?::\\d+)?$"),"")
    val absolute=file.startsWith('/')||Regex("^[a-zA-Z]:/").containsMatchIn(file)
    val project=if(absolute)state.projects.sortedByDescending{it.path.length}.find{nativePath(file).startsWith(nativePath(it.path)+"/")} else state.projects.find{it.id==state.projectId}
    require(project!=null){"无法确定文件所属项目，请刷新会话后重试"}
    val relative=if(absolute)file.substring(nativePath(project.path).length+1)else file
    return "/raw/projects/${project.id}/file?path=${URLEncoder.encode(relative,"UTF-8")}" 
}
fun nativeShareFile(context:Context,bytes:ByteArray,name:String){
    val directory=File(context.cacheDir,"outputs").apply{mkdirs()}
    directory.listFiles()?.filter{System.currentTimeMillis()-it.lastModified()>86400000}?.forEach{it.delete()}
    val safeName=name.substringAfterLast('/').substringAfterLast('\\').take(120).ifBlank{"output"}
    val file=File(directory,"${UUID.randomUUID()}-$safeName").apply{writeBytes(bytes)}
    val uri=FileProvider.getUriForFile(context,context.packageName+".files",file)
    val mime=if(file.extension.equals("apk",true))"application/vnd.android.package-archive" else android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase())?:"application/octet-stream"
    val view=Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    try{context.startActivity(view)}catch(e:android.content.ActivityNotFoundException){
        val share=Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(share,"保存或打开文件").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
fun nativeOpenDownloadedFile(context:Context,file:File,mime:String){
    val uri=FileProvider.getUriForFile(context,context.packageName+".files",file)
    val view=Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    try{context.startActivity(view)}catch(e:android.content.ActivityNotFoundException){
        val share=Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(share,"保存或打开文件").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
