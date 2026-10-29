package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable internal fun NativeOutputDirectoryPreview(
    directory:NativeOutputDirectory,busy:Boolean,message:String,error:String,
    open:(FileEntry)->Unit,navigate:(String)->Unit,retry:()->Unit,close:()->Unit,
){
    val list=rememberLazyListState()
    LaunchedEffect(directory.href,directory.path){list.scrollToItem(0)}
    val back={nativeWorkspaceParentPath(directory.path,"")?.let(navigate)?:close()}
    val rootName=nativeOutputLinkName(directory.href)
    val files=NativeWorkspaceFilesState(directory.files,directory.path,"",busy,message,error)
    val up={nativeWorkspaceParentPath(directory.path,"")?.let(navigate);Unit}
    NativeReaderDialog(close=back,header={
      Column{
        NativeReaderToolbar(directory.path.substringAfterLast('/').ifBlank{rootName},"返回",back,
            subtitle=if(directory.path.isBlank())"" else rootName)
        NativeLiquidSurface(Modifier.padding(horizontal=16.dp,vertical=4.dp),shape=Radius.Panel,kind=NativeGlassKind.PANEL){
            Box(Modifier.padding(horizontal=12.dp,vertical=4.dp)){
                NativeWorkspaceFileBar(files,nativeDisplayPath(nativeOutputLinkPath(directory.href)),up,{navigate(directory.path)})
            }
        }
      }
    }){top->
        NativeBackdropScrollMotion{31*list.firstVisibleItemIndex+list.firstVisibleItemScrollOffset}
        NativeWorkspaceFiles(files,list,open,{navigate(directory.path)},up,retry,
            Modifier.fillMaxSize().padding(horizontal=16.dp),rootLabel=rootName,topInset=top,navigation=null)
    }
}
