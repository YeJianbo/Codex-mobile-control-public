package com.localcodex.control

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable internal fun NativeSideChatTitle(controller:NativeSideChatController){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Text("侧聊",Modifier.weight(1f),fontSize=18.sp,fontWeight=FontWeight.SemiBold)
        NativeSideChatMenu(controller)
    }
}

@Composable internal fun NativeSideChatMenu(controller:NativeSideChatController){
    var open by remember{mutableStateOf(false)}
    val enabled by remember(controller){derivedStateOf{controller.state.threadId.isNotBlank()&&!controller.state.busy}}
    Box{
        IconButton(onClick={open=true},enabled=enabled,modifier=Modifier.size(48.dp)){
            ModernIcon(R.drawable.ic_lucide_ellipsis,"侧聊操作",tint=if(enabled)NativeInk else NativeMuted)
        }
        ModernDropdown(open,{open=false},180.dp){
            PopupMenuRow(R.drawable.ic_lucide_x,"结束侧聊"){open=false;controller.close()}
        }
    }
}

@Composable internal fun NativeSideChatContent(controller:NativeSideChatController,modifier:Modifier=Modifier,vm:NativeViewModel?=null,models:List<NativeModel> = emptyList()){
    val state=controller.state
    val context=LocalContext.current
    var attachmentMenu by remember{mutableStateOf(false)}
    var modelMenu by remember{mutableStateOf(false)}
    var showModels by remember{mutableStateOf(false)}
    val takePhoto=rememberNativeCamera(listOf(vm?.state?.address,state.parentId,state.threadId).joinToString("\n"),
        {uri,cleanup->controller.upload(context.contentResolver,listOf(uri),true,cleanup)},{controller.pickerFailed(it)})
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
        if(result.resultCode==android.app.Activity.RESULT_OK)controller.upload(context.contentResolver,nativePickedUris(result.data),true)
    }
    val files=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
        if(result.resultCode==android.app.Activity.RESULT_OK)controller.upload(context.contentResolver,nativePickedUris(result.data),false)
    }
    fun choose(kind:NativePickKind){
        attachmentMenu=false
        val launcher=if(kind==NativePickKind.MEDIA)picker else files
        runCatching{launcher.launch(nativePickerIntent(context,kind))}.onFailure{
            runCatching{launcher.launch(nativePickerIntent(context,kind,manufacturer=""))}.onFailure{controller.pickerFailed()}
        }
    }
    val blocks=remember(state.events,state.threadId,state.running){nativeTimeline(state.events,state.threadId,running=state.running)}
    val list=rememberLazyListState()
    var follow by remember{mutableStateOf(true)}
    LaunchedEffect(list){snapshotFlow{list.firstVisibleItemIndex to list.isScrollInProgress}.collect{
        if(list.isScrollInProgress)follow=list.layoutInfo.visibleItemsInfo.lastOrNull()?.index==list.layoutInfo.totalItemsCount-1
    }}
    LaunchedEffect(blocks.size,blocks.lastOrNull()?.event?.text,state.error,state.pending,state.running,state.loadingHistory){
        if(follow){withFrameNanos{};val count=list.layoutInfo.totalItemsCount;if(count>0)list.scrollToItem(count-1)}
    }
    val loading=state.error.isBlank()&&(state.loadingHistory||state.busy&&state.threadId.isBlank()||!state.connected&&!state.pending)
    val status=when{
        loading->null
        state.busy->"正在结束侧聊"
        state.error.isNotBlank()->null
        else->nativeChatProgressLabel(state.events,state.threadId,state.running,state.loadingHistory,state.pending)
    }
    Column(modifier.fillMaxSize().testTag("sideChat")){
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("sideChatMessages"),state=list,
            contentPadding=PaddingValues(horizontal=4.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
            if(loading&&blocks.isEmpty())item("historySkeleton"){HistorySkeleton()}
            if(!loading&&blocks.isEmpty()&&state.error.isBlank()&&status==null)item("side-empty"){
                Column(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=40.dp),horizontalAlignment=Alignment.CenterHorizontally,
                    verticalArrangement=Arrangement.spacedBy(10.dp)){
                    ModernIcon(R.drawable.ic_lucide_messages_square,null,Modifier.size(28.dp),NativeMuted)
                    Text("开始侧聊",fontSize=18.sp,fontWeight=FontWeight.Medium,color=NativeInk)
                    Text("沿用当前会话的上下文",fontSize=13.sp,color=NativeMuted)
                }
            }
            items(blocks,key={it.key}){NativeSideBlock(it,controller,vm)}
            if(status!=null)item("side-processing"){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    NativeChatProcessing(status,Modifier.weight(1f).testTag("sideChatStatus"))
                    if(state.pending&&state.error.isBlank())TextButton(onClick=controller::retry){Text("核对提交状态",fontSize=12.sp)}
                }
            }
            if(state.error.isNotBlank())item("side-error"){
                NativeLiquidSurface(Modifier.fillMaxWidth().testTag("sideChatError"),kind=NativeGlassKind.INSET,shape=Radius.Card,color=NativeWash){
                    Column(Modifier.padding(14.dp)){
                        NativeErrorDetail(ChatEvent(type="error",detail=state.error))
                        if(!state.busy)TextButton(onClick=controller::retry){Text(when{
                            state.threadId.isBlank()->"重试创建侧聊"
                            state.pending->"核对提交状态"
                            else->"重新连接"
                        })}
                    }
                }
            }
        }
        NativeComposerSurface(Modifier.imePadding().padding(bottom=8.dp).fillMaxWidth(),kind=NativeGlassKind.INSET){
            Column(Modifier.heightIn(max=160.dp).verticalScroll(rememberScrollState())){
            if(state.uploading)NativeUploadStatus(state.uploadMessage,state.uploadProgress,controller::cancelUpload)
            if(state.images.isNotEmpty()&&vm!=null)NativeImageGallery(vm,state.images.map{"/api/uploads/images/${it.id}"}){controller.removeImage(it.substringAfterLast('/'))}
            state.uploads.forEach{file->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text(file.name,Modifier.weight(1f).clickable{vm?.openUpload(file)}.padding(8.dp),fontSize=12.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                IconButton(onClick={controller.removeFile(file.id)},enabled=!state.pending){ModernIcon(R.drawable.ic_lucide_x,"移除文件",Modifier.size(16.dp))}
            }}
            }
            NativeComposerTextField(state.draft,controller::draft,"描述任务…",
                Modifier.fillMaxWidth().padding(start=12.dp,end=12.dp,top=10.dp,bottom=6.dp)
                    .heightIn(min=26.dp,max=120.dp).testTag("sideChatInput"))
            Row(Modifier.fillMaxWidth().heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically){
                Box{
                    IconButton(onClick={attachmentMenu=true},enabled=!state.pending&&!state.busy&&!state.uploading){ModernIcon(R.drawable.ic_lucide_plus,"侧聊添加附件")}
                    ModernDropdown(attachmentMenu,{attachmentMenu=false},200.dp){
                        PopupMenuRow(R.drawable.ic_lucide_camera,"拍照"){attachmentMenu=false;takePhoto()}
                        PopupMenuRow(R.drawable.ic_lucide_images,"图片与视频"){choose(NativePickKind.MEDIA)}
                        PopupMenuRow(R.drawable.ic_lucide_folder_open,"文件"){choose(NativePickKind.FILES)}
                    }
                }
                Spacer(Modifier.weight(1f))
                val model=models.find{it.id==state.model}
                Box{
                    TextButton(onClick={modelMenu=true;showModels=false},modifier=Modifier.widthIn(max=180.dp).testTag("sideChatModel")){
                        Text((model?.let(::nativeModelDisplayName)?:state.model.ifBlank{"选择模型"})+
                            if(state.effort.isNotBlank())" · ${effortName(state.effort)}" else "",maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=12.sp,color=NativeInk)
                    }
                    ModernDropdown(modelMenu,{modelMenu=false},280.dp,scrollable=false){
                        NativeModelControls(models.filter{it.available&&it.harness==nativeThreadAgent(state.parentId)},model,state.effort,null,false,false,
                            showModels,{showModels=it},{id->models.find{it.id==id}?.let(controller::chooseModel);showModels=false},controller::effort,{},null)
                    }
                }
                NativeComposerAction(
                    when{state.stopping->ComposerAction.Progress;state.running->ComposerAction.Stop;state.busy||state.pending||state.uploading->ComposerAction.Progress;else->ComposerAction.Send},
                    if(state.running)"停止侧聊" else "发送侧聊",
                    state.connected&&!state.busy&&!state.stopping&&(state.running||!state.pending&&!state.uploading&&(state.draft.isNotBlank()||state.images.isNotEmpty()||state.uploads.isNotEmpty())),
                    {if(state.running)controller.stop() else controller.send()},Modifier.padding(start=4.dp).testTag("sideChatSend"))
            }
        }
    }
}

@Composable private fun NativeSideBlock(block:NativeBlock,controller:NativeSideChatController,vm:NativeViewModel?){
    val event=block.event
    when{
        event.type=="user.message"->Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterEnd){
            Column(horizontalAlignment=Alignment.End){
                if(event.images.isNotEmpty()&&vm!=null)NativeImageGallery(vm,event.images.map{"/api/uploads/images/${it.id}"})
                if(event.text.isNotBlank()||event.uploads.isNotEmpty())OutgoingBubble{Column{
                    if(event.text.isNotBlank())SelectionContainer{Text(event.text,fontSize=16.sp)}
                    event.uploads.forEach{file->TextButton(onClick={vm?.openUpload(file)}){ModernIcon(R.drawable.ic_lucide_file_text,null,Modifier.size(16.dp));Text(file.name,Modifier.padding(start=6.dp),fontSize=13.sp)}}
                }}
            }
        }
        event.type=="approval.requested"->{
            val resolved=controller.state.events.any{it.type=="approval.resolved"&&it.approvalId==event.approvalId}
            if(!resolved)NativeLiquidSurface(kind=NativeGlassKind.INSET,shape=Radius.Card){Column(Modifier.padding(12.dp)){
                if(event.approvalType=="question"){
                    val questions=remember(event.detail){runCatching{JSONObject(event.detail).getJSONArray("questions").let{rows->(0 until rows.length()).map{rows.getJSONObject(it)}}}.getOrDefault(emptyList())}
                    NativeQuestionForm(questions,controller.state.answers[event.approvalId].orEmpty(),false,false,
                        {id,value->controller.answer(event.approvalId,id,value)},{controller.submitAnswers(event.approvalId)})
                }else{
                    NativeMarkdown(event.title.ifBlank{event.detail})
                    Row{TextButton(onClick={controller.approve(event.approvalId,false)}){Text("拒绝")};TextButton(onClick={controller.approve(event.approvalId,true)}){Text("允许")}}
                }
            }}
        }
        block.children.isNotEmpty()||block.activities.isNotEmpty()||event.type in setOf("reasoning.summary","context.compaction","tool.started","tool.output","tool.completed","plan.updated","file.changed","diff.updated")->{
            var expanded by remember(block.key){mutableStateOf(false)}
            val title=event.title.ifBlank{when(event.type){
                "reasoning.summary"->"思考摘要"
                "context.compaction"->if(event.status=="running")"正在压缩上下文" else "上下文已压缩"
                else->nativeActivitySummary(block.activities.ifEmpty{listOf(event)})
            }}
            Column{
                if(block.children.isNotEmpty())NativeProcessHeader(title,expanded,{expanded=!expanded},Modifier.testTag("sideActivity:${block.key}"))
                else NativeActivityHeader(title,expanded,{expanded=!expanded},Modifier.testTag("sideActivity:${block.key}"),
                    running=!controller.state.loadingHistory&&(
                        event.type=="context.compaction"&&event.status=="running"||
                            nativeActivityRunning(block.activities,controller.state.events,controller.state.running)),
                    failed=event.status=="error"||block.activities.any{it.status=="error"})
                AnimatedVisibility(expanded,enter=nativeDisclosureEnter(),exit=nativeDisclosureExit()){
                    Column(Modifier.padding(start=6.dp,top=4.dp,bottom=6.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                        when{
                            block.children.isNotEmpty()->block.children.forEach{key(it.key){NativeSideBlock(it,controller,vm)}}
                            block.activities.isNotEmpty()->{
                                val entries=remember(block.activities){nativeActivityItems(block.activities)}
                                entries.forEach{entry->key(entry.key){NativeSideActivityDetail(entry)}}
                            }
                            else->NativeMarkdown(event.text.ifBlank{event.detail})
                        }
                    }
                }
            }
        }
        event.type=="error"->NativeErrorDetail(event)
        event.type in setOf("message.delta","warning")->NativeMarkdown(event.text.ifBlank{event.detail})
    }
}

@Composable private fun NativeSideActivityDetail(entry:NativeActivityItem){
    var expanded by remember(entry.key){mutableStateOf(false)}
    Column{
        NativeActivityHeader(entry.title,expanded,{expanded=!expanded},failed=entry.status=="error")
        if(expanded){
            val detail by produceState<NativePreparedActivityDetail?>(null,entry){value=withContext(Dispatchers.Default){prepareNativeActivityDetail(entry)}}
            detail?.let{NativeMarkdown(it.text)}
        }
    }
}
