package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import java.util.Locale

internal data class NativeWorkspaceFilesState(
    val files:List<FileEntry>,val path:String,val root:String,
    val busy:Boolean,val message:String,val error:String,
)

@Composable internal fun NativeWorkspaceFiles(
    state:NativeWorkspaceFilesState,listState:LazyListState,
    onOpen:(FileEntry)->Unit,onRefresh:()->Unit,onUp:()->Unit,onRetry:()->Unit,
    modifier:Modifier=Modifier,rootLabel:String="工作区根目录",topInset:Dp=0.dp,
    navigation:(@Composable ()->Unit)?={NativeWorkspaceFileBar(state,rootLabel,onUp,onRefresh)},
){
    Column(modifier){
        navigation?.invoke()
        Box(Modifier.fillMaxWidth().weight(1f)){
            LazyColumn(Modifier.fillMaxSize().testTag("workspaceFiles"),state=listState,
                contentPadding=PaddingValues(top=2.dp+topInset,bottom=if(state.error.isBlank())20.dp else 112.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                if(!state.busy&&state.error.isBlank()&&state.files.isEmpty())item("empty"){
                    NativeSettingsGroup{
                        Column(Modifier.fillMaxWidth().padding(vertical=32.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(10.dp)){
                            ModernIcon(R.drawable.ic_lucide_folder_open,null,Modifier.size(30.dp),NativeMuted)
                            Text("此目录为空",fontSize=14.sp,color=NativeMuted)
                        }
                    }
                }
                items(state.files,key={it.path},contentType={it.kind}){file->
                    val folder=file.kind=="directory"
                    val image=nativeOutputMime(file.name).startsWith("image/")
                    NativeSettingsGroup{
                        NativeNavigationRow(file.name,nativeFileDescription(file),
                            if(folder)R.drawable.ic_lucide_folder else if(image)R.drawable.ic_lucide_images else R.drawable.ic_lucide_file_text,
                            {onOpen(file)},Modifier.testTag("workspaceFile:${file.path}"),enabled=!state.busy,
                            iconTint=if(folder)NativeAccent else NativeMuted)
                    }
                }
            }
            if(state.error.isNotBlank())NativeSettingsGroup(Modifier.align(Alignment.BottomCenter).padding(bottom=12.dp)){
                Row(Modifier.padding(start=16.dp,end=8.dp,top=12.dp,bottom=12.dp),verticalAlignment=Alignment.CenterVertically){
                    ModernIcon(R.drawable.ic_lucide_circle_alert,null,Modifier.size(20.dp),MaterialTheme.colors.error)
                    Text(state.error,Modifier.weight(1f).padding(horizontal=12.dp),fontSize=13.sp,lineHeight=18.sp,color=NativeInk,maxLines=3,overflow=TextOverflow.Ellipsis)
                    TextButton(onClick=onRetry,enabled=!state.busy){Text("重试")}
                }
            }
        }
    }
}

@Composable internal fun NativeWorkspaceFileBar(state:NativeWorkspaceFilesState,rootLabel:String,onUp:()->Unit,onRefresh:()->Unit){
    val relative=state.path.removePrefix(state.root).trimStart('/')
    val breadcrumb=if(relative.isBlank())rootLabel else "$rootLabel / ${relative.replace("/"," / ")}" 
    val folderCount=state.files.count{it.kind=="directory"}
    val summary=when{state.files.isEmpty()->"没有文件";folderCount==0->"${state.files.size} 个文件";else->"$folderCount 个文件夹 · ${state.files.size-folderCount} 个文件"}
        Row(Modifier.fillMaxWidth().heightIn(min=68.dp).padding(bottom=8.dp),verticalAlignment=Alignment.CenterVertically){
            Column(Modifier.weight(1f).padding(start=4.dp,end=8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text(breadcrumb,fontSize=12.sp,lineHeight=16.sp,color=NativeMuted,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.testTag("fileBreadcrumb"))
                Box(Modifier.heightIn(min=20.dp)){
                    if(state.busy)StatusPulseText(state.message,true)
                    else Text(summary,fontSize=13.sp,lineHeight=20.sp,color=NativeInk,fontWeight=FontWeight.Medium)
                }
            }
            CompositionLocalProvider(LocalNativeFloatingChrome provides false){
                ChromeButton(R.drawable.ic_lucide_arrow_up,"上一级",onUp,enabled=!state.busy&&nativeWorkspaceParentPath(state.path,state.root)!=null)
                ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新文件",onRefresh,enabled=!state.busy)
            }
        }
}

private fun nativeFileDescription(file:FileEntry):String {
    if(file.kind=="directory")return "文件夹"
    val type=when{
        nativeOutputMime(file.name).startsWith("image/")->"图片"
        file.name.endsWith(".pdf",true)->"PDF"
        file.name.endsWith(".xlsx",true)||nativeIsTabularFile(file.name)->"表格"
        file.name.endsWith(".pptx",true)->"演示文稿"
        file.name.endsWith(".docx",true)->"文档"
        nativeIsTextFile(file.name,nativeOutputMime(file.name))->"文本"
        else->file.name.substringAfterLast('.',"").uppercase(Locale.ROOT).take(12).ifBlank{"文件"}
    }
    val size=when{
        file.size>=1024L*1024*1024->String.format(Locale.ROOT,"%.1f GB",file.size/(1024.0*1024*1024))
        file.size>=1024L*1024->String.format(Locale.ROOT,"%.1f MB",file.size/(1024.0*1024))
        file.size>=1024->String.format(Locale.ROOT,"%.0f KB",file.size/1024.0)
        else->"${file.size} B"
    }
    return "$type · $size"
}
