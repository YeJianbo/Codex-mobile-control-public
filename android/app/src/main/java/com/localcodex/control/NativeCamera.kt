package com.localcodex.control

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import java.io.File

/** Keep the full-resolution output across camera activity recreation, scoped to its original draft. */
@Composable internal fun rememberNativeCamera(
    target:String,onCaptured:(Uri,()->Unit)->Unit,onError:(String)->Unit,
):()->Unit {
    val context=LocalContext.current
    var pendingPath by rememberSaveable{mutableStateOf("")}
    var pendingTarget by rememberSaveable{mutableStateOf("")}
    val camera=rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()){success->
        val file=pendingPath.takeIf{it.isNotBlank()}?.let(::File)
        val original=pendingTarget
        pendingPath="";pendingTarget=""
        if(file!=null){
            val cleanup={file.delete();Unit}
            when{
                !success->cleanup()
                original!=target->{cleanup();onError("会话已改变，请在当前会话重新拍照")}
                !file.exists()||file.length()==0L->{cleanup();onError("未能保存照片，请重新拍摄")}
                else->try{onCaptured(FileProvider.getUriForFile(context,context.packageName+".files",file),cleanup)}
                    catch(error:Exception){cleanup();onError(error.message?:"无法读取照片")}
            }
        }
    }
    return {
        if(pendingPath.isBlank()){
            try{
                val directory=File(context.cacheDir,"outputs").apply{mkdirs()}
                val file=File.createTempFile("camera-",".jpg",directory)
                pendingPath=file.absolutePath;pendingTarget=target
                camera.launch(FileProvider.getUriForFile(context,context.packageName+".files",file))
            }catch(_:Exception){
                pendingPath.takeIf{it.isNotBlank()}?.let{File(it).delete()}
                pendingPath="";pendingTarget="";onError("无法打开相机，请确认手机已安装相机应用")
            }
        }
    }
}
