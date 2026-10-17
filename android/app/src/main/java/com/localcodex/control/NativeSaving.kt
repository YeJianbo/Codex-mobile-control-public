package com.localcodex.control

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.OutputStream
import java.util.UUID

internal class NativeStoragePermissionRequired:IllegalStateException("保存文件需要存储权限")
internal fun nativeNeedsStoragePermission(context:Context)=Build.VERSION.SDK_INT<29&&ContextCompat.checkSelfPermission(context,Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED

internal fun nativeOutputName(path:String):String {
    val name=path.replace('\\','/').substringAfterLast('/').ifBlank{"Codex-file"}
        .replace(Regex("[\\p{Cntrl}/\\\\:*?\"<>|]"),"_")
    val ext=name.substringAfterLast('.',"").take(16)
    return if(ext.isBlank())name.take(160)else name.substringBeforeLast('.').take(140)+".$ext"
}
// Names returned by the gateway are already decoded; only links need URI parsing.
internal fun nativeLocalFilePath(path:String)=path.replace(Regex("^file://",RegexOption.IGNORE_CASE),"").replace('\\','/').removePrefix("//?/").replace(Regex("^/([a-zA-Z]:/)"),"$1")
internal fun nativeOutputLinkPath(href:String)=nativeLocalFilePath(Uri.decode(nativeLocalFilePath(href).substringBefore('?').substringBefore('#'))).replace(Regex(":\\d+(?::\\d+)?$"),"")
internal fun nativeFilePathHref(path:String)=Uri.encode(nativeLocalFilePath(path),"/")
internal fun nativeOutputLinkName(href:String)=nativeOutputName(nativeOutputLinkPath(href))
internal fun nativeOutputMime(name:String):String {
    val file=nativeOutputName(name)
    return if(file.endsWith(".apk",true))"application/vnd.android.package-archive" else android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.substringAfterLast('.',"").lowercase())?:"application/octet-stream"
}
internal fun nativeImageName(endpoint:String,mime:String):String {
    val source=Uri.parse(endpoint).getQueryParameter("path")
    val name=if(source!=null)nativeOutputName(source) else nativeOutputLinkName(endpoint)
    val ext=when(mime){"image/jpeg"->"jpg";"image/png"->"png";"image/webp"->"webp";"image/gif"->"gif";else->android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?:error("无法识别原图格式")}
    return if(name.contains('.'))name.substringBeforeLast('.')+".$ext"
        else "Codex-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(6)}.$ext"
}
internal fun nativeEncodedImageMime(bytes:ByteArray):String {
    val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true}
    android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
    require(bounds.outWidth>0&&bounds.outHeight>0){"图片格式无法解码"}
    return bounds.outMimeType?.takeIf{it.startsWith("image/")}?:error("无法识别原图格式")
}

/** Explicit saves are user files, outside all app cache directories and eviction. */
internal fun nativeSavePublicFile(context:Context,name:String,mime:String,write:(OutputStream)->Unit):Uri {
    if(nativeNeedsStoragePermission(context))throw NativeStoragePermissionRequired()
    val image=mime.startsWith("image/")
    val fileName=nativeOutputName(name)
    // MediaStore appends .txt for text/plain with an unknown extension (e.g. .kt).
    // Keep the original filename; the reader and ACTION_VIEW retain the text MIME.
    val storageMime=if(mime=="text/plain"&&nativeOutputMime(fileName)=="application/octet-stream")"application/octet-stream" else mime
    if(Build.VERSION.SDK_INT>=29){
        val resolver=context.contentResolver
        val collection=if(image)MediaStore.Images.Media.EXTERNAL_CONTENT_URI else MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val values=ContentValues().apply{
            put(MediaStore.MediaColumns.DISPLAY_NAME,fileName);put(MediaStore.MediaColumns.MIME_TYPE,storageMime)
            put(MediaStore.MediaColumns.RELATIVE_PATH,(if(image)Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS)+"/Codex")
            put(MediaStore.MediaColumns.IS_PENDING,1)
        }
        val uri=resolver.insert(collection,values)?:error("无法创建保存文件")
        try{
            resolver.openOutputStream(uri)?.use(write)?:error("无法写入保存文件")
            check(resolver.update(uri,ContentValues().apply{put(MediaStore.MediaColumns.IS_PENDING,0)},null,null)>0){"无法完成保存"}
            return uri
        }catch(error:Throwable){runCatching{resolver.delete(uri,null,null)};throw error}
    }
    @Suppress("DEPRECATION")
    val directory=File(Environment.getExternalStoragePublicDirectory(if(image)Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS),"Codex")
    check(directory.isDirectory||directory.mkdirs()){"无法创建保存目录"}
    var target=File(directory,fileName)
    if(target.exists())target=File(directory,"${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(6)}-$fileName")
    try{target.outputStream().use(write)}catch(error:Throwable){target.delete();throw error}
    MediaScannerConnection.scanFile(context,arrayOf(target.absolutePath),arrayOf(storageMime),null)
    return FileProvider.getUriForFile(context,context.packageName+".files",target)
}

internal data class NativeSaveAction(val saving:Boolean,val save:()->Unit)
@Composable internal fun rememberNativeSaveAction(action:suspend ()->String):NativeSaveAction {
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    val latest by rememberUpdatedState(action)
    var saving by remember{mutableStateOf(false)}
    var pending by remember{mutableStateOf<(suspend ()->String)?>(null)}
    fun execute(block:suspend ()->String){
        saving=true
        scope.launch(Dispatchers.Main.immediate){
            try{val message=withContext(Dispatchers.IO){block()};Toast.makeText(context,message,Toast.LENGTH_SHORT).show()}
            catch(error:CancellationException){throw error}
            catch(error:Exception){Toast.makeText(context,error.message?:"保存失败，请重试",Toast.LENGTH_LONG).show()}
            finally{saving=false}
        }
    }
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){granted->
        val block=pending;pending=null
        if(granted&&block!=null)execute(block)else{saving=false;Toast.makeText(context,"未获得存储权限，文件未保存",Toast.LENGTH_SHORT).show()}
    }
    return NativeSaveAction(saving){
        if(!saving){
            val block=latest
            if(nativeNeedsStoragePermission(context)){saving=true;pending=block;permission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)}else execute(block)
        }
    }
}
