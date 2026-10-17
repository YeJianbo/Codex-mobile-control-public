package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal data class NativeWorkspaceFilesState(
    val files:List<FileEntry>,val path:String,val root:String,
    val busy:Boolean,val message:String,val error:String,
)

@Composable internal fun NativeWorkspaceFiles(
    state:NativeWorkspaceFilesState,listState:LazyListState,
    onOpen:(FileEntry)->Unit,onRefresh:()->Unit,onUp:()->Unit,onRetry:()->Unit,
    modifier:Modifier=Modifier,
){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.64f)
    Column(modifier){
        Row(Modifier.fillMaxWidth().heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically){
            StatusPulseText(if(state.busy)state.message else state.path.removePrefix(state.root).trimStart('/').ifBlank{"工作区根目录"},
                state.busy,Modifier.weight(1f).padding(end=8.dp))
            IconButton(onClick=onUp,enabled=!state.busy&&nativeWorkspaceParentPath(state.path,state.root)!=null){
                Icon(painterResource(R.drawable.ic_lucide_arrow_up),"上一级",Modifier.size(18.dp),tint=muted)
            }
            IconButton(onClick=onRefresh,enabled=!state.busy){
                Icon(painterResource(R.drawable.ic_lucide_rotate_cw),"刷新文件",Modifier.size(18.dp),tint=muted)
            }
        }
        if(state.error.isNotBlank())Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Text(state.error,Modifier.weight(1f),fontSize=13.sp,color=MaterialTheme.colors.error)
            TextButton(onClick=onRetry,enabled=!state.busy){Text("重试")}
        }
        LazyColumn(Modifier.fillMaxWidth().weight(1f).testTag("workspaceFiles"),state=listState){
            if(!state.busy&&state.error.isBlank()&&state.files.isEmpty())item("empty"){
                Text("此目录为空",Modifier.padding(vertical=20.dp),color=muted)
            }
            items(state.files,key={it.path},contentType={it.kind}){file->
                TextButton(onClick={onOpen(file)},enabled=!state.busy,
                    colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colors.onSurface),
                    modifier=Modifier.fillMaxWidth().heightIn(min=56.dp).testTag("workspaceFile:${file.path}")){
                    Icon(painterResource(if(file.kind=="directory")R.drawable.ic_lucide_folder else R.drawable.ic_lucide_file_text),null,
                        Modifier.size(19.dp),tint=if(file.kind=="directory")MaterialTheme.colors.primary else muted)
                    Text(file.name,Modifier.weight(1f).padding(horizontal=12.dp,vertical=8.dp),textAlign=TextAlign.Start,maxLines=2,overflow=TextOverflow.Ellipsis)
                    if(file.kind=="directory")Icon(painterResource(R.drawable.ic_lucide_chevron_right),null,Modifier.size(16.dp),tint=muted)
                }
            }
        }
    }
}
