@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control
import com.localcodex.control.NativeThemeSurface as Surface

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.updateTransition
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.min

@Composable internal fun NativeFileChangeCard(vm:NativeViewModel,block:NativeBlock,modifier:Modifier=Modifier,onRead:()->Unit={}){
    val state=NativeFileChangeState(block,vm.state.connected,vm.state.activityErrors,vm.activityLoadEpoch)
    NativeFileChangeContent(state,loadDetails={events->
        vm.loadActivityGroups(events)
        vm.loadActivityDetails(block.event.threadId,events.filter{it.activityGroupId.isBlank()&&it.detailsDeferred}.map{it.eventId})
    },modifier=modifier,onRead=onRead)
}

internal data class NativeFileChangeState(
    val block:NativeBlock,val connected:Boolean,val activityErrors:Map<String,String>,val loadEpoch:Int,
)

@Composable internal fun NativeFileChangeContent(
    state:NativeFileChangeState,loadDetails:(List<ChatEvent>)->Unit,
    modifier:Modifier=Modifier,onRead:()->Unit={},
){
    val block=state.block
    val summaryFiles=remember(block.event.fileChanges,block.activities){block.event.fileChanges.ifEmpty{nativeFileChanges(block.activities,includeLineCounts=false)}}
    val addedColor=if(MaterialTheme.colors.isLight)Color(0xFF27843C) else Color(0xFF81C995)
    val removedColor=MaterialTheme.colors.error
    var filesExpanded by remember(block.key){mutableStateOf(false)}
    var detailedFiles by remember(block.activities){mutableStateOf<List<NativeFileChange>?>(null)}
    LaunchedEffect(filesExpanded,block.activities){
        if(filesExpanded&&detailedFiles==null)detailedFiles=withContext(Dispatchers.Default){nativeFileChanges(block.activities)}
    }
    val changedFiles=detailedFiles?:summaryFiles
    val expansion=updateTransition(filesExpanded,label="fileExpansion")
    val chevronAngle=expansion.animateFloat(transitionSpec={nativeChevronMotion()},label="fileChevron"){if(it)90f else 0f}
    var selectedFile by remember(block.key){mutableStateOf<String?>(null)}
    val selectedPatch=rememberNativeSelectedFilePatch(selectedFile,block.activities)
    val selectedEvents=selectedPatch?.events.orEmpty()
    LaunchedEffect(selectedFile,selectedEvents,state.connected,state.loadEpoch){if(selectedFile!=null&&state.connected){
        loadDetails(selectedEvents)
    }}
        if(changedFiles.isNotEmpty())Surface(modifier.fillMaxWidth().padding(vertical=3.dp),shape=Radius.Composer,color=NativeWash){Column{
            val summary=buildAnnotatedString{
                append("已更改 ${changedFiles.size} 个文件")
                if(changedFiles.any{it.added!=null}){
                    append("  ")
                    withStyle(SpanStyle(color=addedColor)){append("+${changedFiles.sumOf{it.added?:0}}")}
                }
                if(changedFiles.any{it.removed!=null}){
                    append(if(changedFiles.any{it.added!=null})" " else "  ")
                    withStyle(SpanStyle(color=removedColor)){append("−${changedFiles.sumOf{it.removed?:0}}")}
                }
            }
            Row(Modifier.fillMaxWidth().heightIn(min=44.dp).clip(Radius.Composer).clickable{onRead();filesExpanded=!filesExpanded}.padding(horizontal=16.dp,vertical=2.dp),verticalAlignment=Alignment.CenterVertically){
                Text(summary,fontSize=13.sp,modifier=Modifier.weight(1f))
                ModernIcon(R.drawable.ic_lucide_chevron_right,if(filesExpanded)"收起更改记录" else "展开更改记录",Modifier.size(16.dp).graphicsLayer{rotationZ=chevronAngle.value},NativeMuted)
            }
            expansion.AnimatedVisibility(visible={it},enter=nativeDisclosureEnter(),exit=nativeDisclosureExit()){Column(Modifier.padding(horizontal=16.dp,vertical=2.dp)){changedFiles.forEach{file->key(file.path){Row(Modifier.fillMaxWidth().heightIn(min=36.dp).clip(Radius.Control).clickable{selectedFile=file.path}.padding(vertical=4.dp)){
                Text(nativeDisplayPath(file.path),Modifier.weight(1f),fontSize=13.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                file.added?.let{Text(" +$it",color=addedColor,fontSize=13.sp)}
                file.removed?.let{Text(" −$it",color=removedColor,fontSize=13.sp)}
            }}}}}
        }}
        selectedFile?.let{file->
            val preparing=selectedPatch==null
            val patch=selectedPatch?.detail.orEmpty()
            val deferred=selectedEvents.any{it.detailsDeferred||it.activityGroupId.isNotBlank()}
            val failure=selectedEvents.firstNotNullOfOrNull{state.activityErrors[it.activityGroupId]?:state.activityErrors[it.eventId]}
            val feedback:(@Composable ()->Unit)?=if(preparing||deferred)({
                Column(Modifier.testTag("changeFeedback")){
                    when{
                        preparing->NativeRunningTitle("正在整理改动…",rememberNativeRunningPulse(true),Modifier.testTag("changePreparing"),fontSize=14.sp)
                        !state.connected->Text("连接电脑后继续读取",fontSize=14.sp,color=NativeMuted)
                        failure!=null->{
                            Text("改动详情读取失败",fontSize=14.sp,color=MaterialTheme.colors.error)
                            Text(failure,Modifier.padding(top=6.dp),fontSize=13.sp,color=NativeMuted)
                            TextButton(onClick={
                                loadDetails(selectedEvents)
                            },modifier=Modifier.testTag("changeRetry")){Text("重试")}
                        }
                        else->NativeRunningTitle("正在读取改动详情…",rememberNativeRunningPulse(true),Modifier.testTag("changeLoading"),fontSize=14.sp)
                    }
                }
            })else null
            NativeChangeDetail(file,listOf(file),patch.ifBlank{if(preparing||deferred)"" else "此记录未保存该文件的补丁"},statusContent=feedback){selectedFile=null}
        }
}
@Composable private fun rememberNativeSelectedFilePatch(file:String?,events:List<ChatEvent>):NativeSelectedFilePatch?{
    // Keep this file's last prepared version during refresh; another file owns a fresh state.
    val result=remember(file){mutableStateOf<NativeSelectedFilePatch?>(null)}
    LaunchedEffect(file,events){
        if(file!=null)result.value=withContext(Dispatchers.Default){prepareNativeFilePatch(events,file)}
    }
    return result.value
}
@Composable private fun rememberNativePreparedPatch(detail:String,textSize:Float):NativePreparedPatch?{
    // A new input owns a fresh state, so an old preparation cannot appear under a new title/source.
    val result=remember(detail,textSize){mutableStateOf<NativePreparedPatch?>(null)}
    LaunchedEffect(detail,textSize){result.value=withContext(Dispatchers.Default){prepareNativePatch(detail,textSize)}}
    return result.value
}
private fun LazyListScope.nativePatchRows(rows:List<PatchLine>,start:Int,end:Int){
    items(end-start,key={offset->"line:${start+offset}"},contentType={"patchLine"}){offset->
        val line=rows[start+offset]
        val tint=when(line.kind){"add"->AppColor.StatusOk;"del"->AppColor.StatusError;else->NativeInk}
        val fill=when(line.kind){"add"->AppColor.StatusOk.copy(alpha=0.10f);"del"->AppColor.StatusError.copy(alpha=0.10f);else->Color.Transparent}
        Row(Modifier.fillMaxWidth().background(fill).padding(vertical=1.dp)){
            Text((line.oldLine?.toString()?:"")+" "+(line.newLine?.toString()?:""),Modifier.width(66.dp).padding(horizontal=4.dp),fontSize=10.sp,color=NativeMuted,fontFamily=FontFamily.Monospace)
            Text(line.text.ifEmpty{" "},Modifier.weight(1f),softWrap=false,fontFamily=FontFamily.Monospace,fontSize=12.sp,lineHeight=17.sp,color=tint)
        }
    }
}
@Composable internal fun NativeChangeDetail(title:String,files:List<String>,detail:String,statusContent:(@Composable ()->Unit)?=null,close:()->Unit){
    val clipboard=LocalClipboardManager.current
    val density=LocalDensity.current
    val hasPatch=remember(detail){detail.contains("*** ")||detail.contains("diff --git ")||detail.contains("@@ ")}
    val prepared=if(detail.isNotEmpty())rememberNativePreparedPatch(detail,with(density){12.sp.toPx()}) else null
    val rows=prepared?.rows.orEmpty()
    val codeWidth=prepared?.codeWidth?:0f
    val expandedContext=remember(detail){mutableStateMapOf<Int,Boolean>()}
    val horizontal=rememberScrollState()
    Dialog(onDismissRequest=close,properties=DialogProperties(usePlatformDefaultWidth=false)){
        NativeDialogSystemBars()
        Column(Modifier.fillMaxSize().background(MaterialTheme.colors.background).testTag("changeDetail")){
            Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal=10.dp),verticalAlignment=Alignment.CenterVertically){
                ChromeButton(R.drawable.ic_lucide_x,"关闭改动",close)
                Text(title,Modifier.weight(1f).padding(start=8.dp),fontSize=16.sp,fontWeight=FontWeight.Medium)
                if(hasPatch)TextButton(onClick={clipboard.setText(AnnotatedString(detail))}){Text("复制补丁",fontSize=13.sp)}
            }
            Divider(color=NativeInk.copy(alpha=0.08f))
            if(files.isNotEmpty())Text(files.joinToString("\n"),Modifier.fillMaxWidth().padding(horizontal=18.dp,vertical=10.dp),fontSize=12.sp,fontFamily=FontFamily.Monospace,color=NativeMuted)
            statusContent?.let{content->Box(Modifier.fillMaxWidth().padding(horizontal=18.dp,vertical=8.dp)){content()}}
            if(hasPatch)prepared?.let{Text("+${it.additions}  −${it.deletions}",Modifier.padding(horizontal=18.dp,vertical=8.dp),fontSize=12.sp,color=NativeMuted)}
            if(detail.isNotEmpty()&&prepared==null){
                NativeRunningTitle("正在整理改动…",rememberNativeRunningPulse(true),Modifier.padding(18.dp).testTag("patchPreparing"),fontSize=14.sp)
            }else if(prepared?.tooLarge==true||codeWidth>60000f){
                Text("改动过大或包含超长行，请复制补丁到编辑器查看。",Modifier.padding(18.dp),fontSize=14.sp,color=NativeMuted)
            }else if(!hasPatch){
                if(detail.isNotBlank())Text(detail,Modifier.padding(18.dp),fontSize=14.sp,color=NativeMuted)
            }else BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)){
                val contentWidth=maxOf(maxWidth,with(density){codeWidth.toDp()}+78.dp)
                Box(Modifier.horizontalScroll(horizontal)){
                LazyColumn(Modifier.width(contentWidth).fillMaxHeight().testTag("changeLines"),contentPadding=PaddingValues(vertical=4.dp)){
                prepared?.sections.orEmpty().forEach{section->
                    val start=section.start;val end=section.end
                    if(section.foldable&&expandedContext[start]!=true){
                        nativePatchRows(rows,start,start+3)
                        item("fold:$start",contentType="patchFold"){
                            Text("${end-start-6} 行未修改 · 展开",Modifier.fillMaxWidth().clickable{expandedContext[start]=true}.background(NativeWash).padding(horizontal=14.dp,vertical=6.dp),fontSize=12.sp,color=NativeMuted)
                        }
                        nativePatchRows(rows,end-3,end)
                    }else{
                        nativePatchRows(rows,start,end)
                    }
                }
                }
                }
            }
        }
    }
}
