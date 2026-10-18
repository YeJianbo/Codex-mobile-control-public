@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun NativeWorkspace(vm:NativeViewModel,panel:String,modifier:Modifier=Modifier){
    val s=vm.state
    val fileList=rememberLazyListState()
    LaunchedEffect(s.fileProjectId,s.filePath){fileList.scrollToItem(0)}
    Column(modifier){
    when(panel){
        "文件"->{
            val file=s.file
            if(file!=null){
                NativeWorkspaceEditorContent(NativeWorkspaceEditorState(file,s.fileDraft,s.fileBusy,s.fileMessage,s.fileError),
                    vm::editFile,vm::saveFile,vm::backToFiles,vm::retryFile)
            }
            else{
                val files=remember(s.files,s.filePath,s.fileRootPath,s.fileBusy,s.fileMessage,s.fileError){
                    NativeWorkspaceFilesState(s.files,s.filePath,s.fileRootPath,s.fileBusy,s.fileMessage,s.fileError)
                }
                val path=s.filePath
                NativeWorkspaceFiles(files,fileList,vm::readFile,{vm.files(path)},
                    {nativeWorkspaceParentPath(path,s.fileRootPath)?.let(vm::files)},vm::retryFile,Modifier.weight(1f).fillMaxWidth())
            }
        }
        "改动"->NativeMarkdown("```diff\n${s.diff}\n```")
        "终端"->NativeTerminalContent(
            NativeTerminalState(s.projects.find{it.id==s.projectId}?.path,s.projectId.isNotBlank(),s.connected,
                s.terminal,s.terminalDraft,s.terminalError,s.terminalBusy,s.terminalSession.isNotBlank()),
            vm::editTerminal,vm::terminal,vm::stopTerminal,
        )
    }
    if(vm.currentWorkBusy())LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}
internal data class NativeWorkspaceEditorState(
    val file:FileContent,val draft:String,val busy:Boolean,val message:String,val error:String,
)

@Composable internal fun NativeWorkspaceEditorContent(
    state:NativeWorkspaceEditorState,onEdit:(String)->Unit,onSave:()->Unit,onBack:()->Unit,onRetry:()->Unit,
){
    if(state.busy)StatusPulseText(state.message,true,Modifier.padding(vertical=8.dp))
    if(state.error.isNotBlank()){
        Text(state.error,color=MaterialTheme.colors.error,fontSize=13.sp)
        TextButton(onClick=onRetry,enabled=!state.busy){Text("重试")}
    }
    NativeFileEditor(state.file,state.draft,state.busy,onEdit,onSave,onBack)
}

internal data class NativeTerminalState(
    val projectPath:String?,val projectSelected:Boolean,val connected:Boolean,
    val output:String,val draft:String,val error:String,val busy:Boolean,val hasSession:Boolean,
)

@Composable internal fun NativeTerminalContent(
    state:NativeTerminalState,onEdit:(String)->Unit,onExecute:()->Unit,onStop:()->Unit,
){
    state.projectPath?.let{Text(nativeDisplayPath(it),fontSize=13.sp,color=NativeMuted)}
    if(!state.projectSelected)Text("请先选择项目",color=NativeMuted)
    if(state.output.isNotBlank())NativeMarkdown("```\n${state.output}\n```")
    NativeTextEntry(state.draft,onEdit,"输入命令",Modifier.testTag("terminalEditor"))
    if(state.error.isNotBlank())Text(state.error,color=MaterialTheme.colors.error,fontSize=12.sp)
    Row{
        NativePrimaryButton(onClick=onExecute,enabled=state.connected&&!state.busy&&state.projectSelected&&state.draft.isNotBlank(),modifier=Modifier.testTag("terminalExecute")){Text(if(state.busy)"处理中…" else "执行")}
        TextButton(onClick=onStop,enabled=!state.busy&&state.hasSession){Text("停止终端")}
    }
}

@Composable internal fun NativeFileEditor(file:FileContent,draft:String,busy:Boolean,onEdit:(String)->Unit,onSave:()->Unit,onBack:()->Unit){
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)){
        TextButton(onClick=onBack,enabled=!busy){Text("返回目录")}
        Text(nativeDisplayPath(file.path),fontSize=13.sp)
        if(file.editable){
            NativeTextEntry(draft,onEdit,"",Modifier.fillMaxWidth().testTag("fileEditor"),label="文件内容")
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){
                Text(if(draft!=file.content)"有未保存的修改" else "内容已保存",fontSize=12.sp,color=NativeMuted,modifier=Modifier.testTag("fileSaveState"))
                NativePrimaryButton(onClick=onSave,enabled=!busy&&draft!=file.content,modifier=Modifier.testTag("fileSaveButton")){Text("保存")}
            }
        }else SelectionContainer{Text(file.content)}
    }
}
