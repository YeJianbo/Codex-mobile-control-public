package com.localcodex.control

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import java.io.File
import java.util.Locale

internal fun nativeAppInstallIntent(context:android.content.Context,file:File)=Intent(Intent.ACTION_VIEW)
    .setDataAndType(FileProvider.getUriForFile(context,context.packageName+".files",file),"application/vnd.android.package-archive")
    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

@Composable internal fun NativeAppUpdatePage(controller:NativeAppUpdateController,back:()->Unit){
    val context=LocalContext.current
    val active=LocalManagementPageActive.current
    val state=controller.state
    fun install(){controller.install{file->context.startActivity(nativeAppInstallIntent(context,file))}}
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){
        if(context.packageManager.canRequestPackageInstalls())install()
    }
    fun requestInstall(){
        if(context.packageManager.canRequestPackageInstalls())install()
        else permission.launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")))
    }
    LaunchedEffect(active){if(active)controller.check()}
    LaunchedEffect(active,state.requestInstall){if(active&&state.requestInstall){controller.consumeInstallRequest();requestInstall()}}
    NativeAppUpdateContent(state,controller.currentCode,BuildConfig.VERSION_NAME,back,{controller.check()},controller::download,
        controller::cancel,::requestInstall,controller::automatic)
}

@Composable internal fun NativeAppUpdateContent(
    state:NativeAppUpdateState,currentCode:Long,currentVersion:String,back:()->Unit,check:()->Unit,download:()->Unit,
    cancel:()->Unit,install:()->Unit,automatic:(Boolean)->Unit,
){
    val release=state.release
    val newer=release!=null&&release.code>currentCode
    val busy=state.checking||state.downloading||state.verifying
    NativeManagementPage("应用更新","",back,modifier=Modifier.testTag("appUpdatePage"),actions={
        ChromeButton(R.drawable.ic_lucide_rotate_cw,"检查更新",check,enabled=!busy)
    }){
        Column(Modifier.weight(1f).nativeManagementScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
            NativeSettingsGroup{
                Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                    Text(when{state.checking->"正在检查更新";state.verifying->"正在校验安装包";newer->"发现新版本";release!=null->"已是最新版本";else->"检查应用更新"},fontSize=21.sp,fontWeight=FontWeight.SemiBold)
                    Text("当前版本 $currentVersion",fontSize=13.sp,color=NativeMuted)
                    if(newer)Text("${release!!.version} · ${String.format(Locale.ROOT,"%.1f",release.size/1048576.0)} MB",fontSize=15.sp,color=NativeAccent)
                    if(state.downloading){
                        val progress=if(state.total>0)(state.downloaded.toFloat()/state.total).coerceIn(0f,1f) else 0f
                        LinearProgressIndicator(progress,Modifier.fillMaxWidth().testTag("appUpdateProgress"),color=NativeAccent)
                        Text("正在下载 ${(progress*100).toInt()}%",fontSize=13.sp,color=NativeMuted)
                        TextButton(cancel){Text("取消下载")}
                    }else if(state.verifying)LinearProgressIndicator(Modifier.fillMaxWidth(),color=NativeAccent)
                    else if(state.ready!=null&&newer)Button(install,Modifier.fillMaxWidth()){Text("安装更新")}
                    else if(newer)Button(download,Modifier.fillMaxWidth(),enabled=!busy){Text("下载并安装")}
                    else Button(check,Modifier.fillMaxWidth(),enabled=!busy){Text("检查更新")}
                    if(state.error.isNotBlank())Text(state.error,color=MaterialTheme.colors.error,fontSize=13.sp)
                }
            }
            if(release?.notes?.isNotBlank()==true){
                SettingsSectionLabel("更新内容")
                NativeSettingsGroup{Text(release.notes,Modifier.padding(18.dp),fontSize=14.sp,lineHeight=22.sp)}
            }
            NativeSettingsGroup{
                Row(Modifier.fillMaxWidth().padding(18.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
                    Column(Modifier.weight(1f).padding(end=12.dp)){
                        Text("自动检查更新",fontSize=15.sp)
                        Text("连接电脑后检查，不自动下载",fontSize=12.sp,color=NativeMuted)
                    }
                    ModernToggle(state.autoCheck,true,automatic)
                }
            }
        }
    }
}
