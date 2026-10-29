package com.localcodex.control

import androidx.compose.foundation.background
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import kotlinx.coroutines.launch

data class NativeAutomation(val id:String,val name:String,val prompt:String,val status:String,val kind:String,val threadId:String,val rrule:String,val nextRunAt:Long?,val lastRunAt:Long?,val threadTitle:String="",val threadPath:String="")
fun JSONObject.toNativeAutomation()=NativeAutomation(getString("id"),optString("name"),optString("prompt"),optString("status"),optString("kind"),optString("threadId"),optString("rrule"),
    if(isNull("nextRunAt"))null else optLong("nextRunAt").takeIf{it>0},if(isNull("lastRunAt"))null else optLong("lastRunAt").takeIf{it>0},optString("threadTitle"),optString("threadPath"))
internal fun nativeScheduledMessage(event:ChatEvent):Pair<String,String>?{
    event.messageSource?.takeIf{it.kind=="schedule"}?.let{return it.automationId to event.text}
    if(!event.text.trim().startsWith("<heartbeat>")||!event.text.trim().endsWith("</heartbeat>"))return null
    val id=Regex("<automation_id>\\s*([a-zA-Z0-9_-]+)\\s*</automation_id>").find(event.text)?.groupValues?.get(1)?:return null
    val prompt=Regex("<instructions>\\s*([\\s\\S]*?)\\s*</instructions>").find(event.text)?.groupValues?.get(1)?:return null
    return id to prompt
}
@Composable internal fun NativeScheduledTrigger(vm:NativeViewModel,event:ChatEvent,scheduled:Pair<String,String>){
    var expanded by remember(event.eventId){mutableStateOf(false)}
    val name=vm.state.automations.find{it.id==scheduled.first}?.name?:"定时任务"
    Column(Modifier.fillMaxWidth().testTag("scheduledTrigger").padding(vertical=8.dp)){
        Row(verticalAlignment=Alignment.CenterVertically){
            Row(Modifier.weight(1f).semantics{contentDescription=if(expanded)"收起定时任务内容" else "展开定时任务内容"}.clickable{expanded=!expanded},verticalAlignment=Alignment.CenterVertically){
                Icon(painterResource(if(expanded)R.drawable.ic_lucide_chevron_down else R.drawable.ic_lucide_chevron_right),null,Modifier.size(16.dp))
                Text("$name 已触发"+nativeRunEndLabel(event.createdAt).takeIf{it.isNotBlank()}?.let{" · $it"}.orEmpty(),Modifier.padding(start=6.dp),fontSize=13.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
            }
            TextButton(onClick={vm.loadAutomations(scheduled.first)}){Text("管理")}
        }
        if(expanded)Text(scheduled.second,Modifier.padding(top=6.dp),fontSize=13.sp)
    }
}
private fun ruleLabel(value:String)=nativeAutomationRuleLabel(value)
internal typealias NativeAutomationFrame = @Composable (String,String,()->Unit,@Composable RowScope.()->Unit,@Composable ColumnScope.()->Unit,@Composable ColumnScope.()->Unit)->Unit
private val automationPageFrame:NativeAutomationFrame={title,subtitle,back,actions,pinned,body->NativeManagementPage(title,subtitle,back,modifier=Modifier.testTag("automationsPage"),actions=actions,pinnedContent=pinned,content=body)}

@Composable internal fun NativeAutomationsSheet(vm:NativeViewModel,threadId:String,onClose:()->Unit){
    NativeAutomations(vm,onClose,threadId){title,subtitle,back,actions,pinned,body->
        val editing=title=="新建任务"||title=="编辑任务"
        Sheet(title,onClose,stableHeight=true,dismissEnabled=!vm.state.automationSaving,bodyScrollState=null,onEntered={vm.loadAutomations(open=false)},contentHorizontalPadding=12.dp){
            BackHandler(onBack=back)
            Row(Modifier.fillMaxWidth().padding(bottom=12.dp),verticalAlignment=Alignment.CenterVertically){
                if(editing)IconButton(onClick=back,enabled=!vm.state.automationSaving){Icon(painterResource(R.drawable.ic_lucide_arrow_left),"返回任务列表",Modifier.size(20.dp))}
                Text(subtitle,Modifier.weight(1f),fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                actions()
            }
            pinned()
            Column(Modifier.weight(1f).testTag("automationsSheetContent"),content=body)
        }
    }
}

@Composable internal fun NativeAutomations(vm:NativeViewModel,onClose:()->Unit=vm::closeAutomations,threadId:String="",frame:NativeAutomationFrame=automationPageFrame){
    val s=vm.state
    NativeAutomationsContent(if(threadId.isBlank())s.automations else s.automations.filter{it.threadId==threadId},s.automationsLoading,s.connected,
        s.connected,s.automationSaving,s.automationFocus,
        onClose,{vm.loadAutomations(open=false)},{id,body,done->
            vm.saveAutomation(id,body,done)
        },error=s.automationError,title=if(threadId.isBlank())"定时任务" else "本会话定时任务",frame=frame,
        newThreadId=threadId.ifBlank{s.threadId.takeIf{s.harness=="codex"&&!vm.isReadOnly()}.orEmpty()},threadInfo={id->s.threads.find{it.id==id}?:s.projectThreads.values.firstNotNullOfOrNull{page->page.rows.find{it.id==id}}},loadTargets=vm::automationTargets)
}

@Composable internal fun NativeAutomationsContent(
    tasks:List<NativeAutomation>,loading:Boolean,connected:Boolean,canCreate:Boolean,busy:Boolean,focus:String,
    onClose:()->Unit,onRefresh:()->Unit,onSave:(String?,JSONObject,()->Unit)->Unit,error:String="",title:String="定时任务",frame:NativeAutomationFrame=automationPageFrame,
    newThreadId:String="",threadInfo:(String)->ThreadRecord?={null},loadTargets:suspend (String,Int)->Pair<List<ThreadRecord>,Boolean> = {_,_->emptyList<ThreadRecord>() to false}
){
    var editing by rememberSaveable(focus){mutableStateOf(focus.ifBlank{null})}
    var creatingThreadId by rememberSaveable{mutableStateOf<String?>(null)}
    val creating=creatingThreadId!=null
    var filter by rememberSaveable{mutableStateOf("all")}
    // The list leaves composition while editing; keep its position at this owner.
    val listState=rememberLazyGridState()
    val scope=rememberCoroutineScope()
    val current=tasks.find{it.id==editing}
    val editor=creating||current!=null
    val back={if(!busy){if(editor){creatingThreadId=null;editing=null}else onClose()}}
    frame(if(creating)"新建任务" else if(editor)"编辑任务" else title,
        if(editor)"定时执行任务" else "${tasks.count{it.status=="ACTIVE"}} 个已启用 · ${tasks.size} 个任务",back,
        {
            if(!editor){
                IconButton(onClick=onRefresh,enabled=connected&&!loading&&!busy){Icon(painterResource(R.drawable.ic_lucide_rotate_cw),"刷新定时任务",Modifier.size(20.dp))}
                IconButton(onClick={creatingThreadId=newThreadId},enabled=canCreate&&!busy,modifier=Modifier.padding(start=4.dp).clip(Radius.Control).background(if(canCreate&&!busy)MaterialTheme.colors.primary else MaterialTheme.colors.onSurface.copy(alpha=.06f))){
                    Icon(painterResource(R.drawable.ic_lucide_plus),"新建定时任务",Modifier.size(22.dp),tint=if(canCreate&&!busy)MaterialTheme.colors.onPrimary else MaterialTheme.colors.onSurface.copy(alpha=.35f))
                }
            }
        },{
        if(error.isNotBlank())Text(error,Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp),fontSize=13.sp,color=MaterialTheme.colors.error)
        Box(Modifier.fillMaxWidth().height(2.dp)){
            if(loading||busy)LinearProgressIndicator(Modifier.fillMaxSize())
        }
        if(!editor){
            Column(Modifier.padding(horizontal=4.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
                if(!connected)Text("连接电脑后可编辑与启用任务",fontSize=13.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                else if(!canCreate)Text("打开一个可编辑的 Codex 会话后新建任务",fontSize=13.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                DashboardTabs(listOf("all" to "全部","active" to "已启用","paused" to "已暂停"),filter,{next->
                    if(filter!=next){filter=next;scope.launch{listState.scrollToItem(0)}}
                })
            }
        }
        }){
        if(editor){
            val targetId=current?.threadId?:creatingThreadId.orEmpty()
            NativeAutomationEditor(current,connected,busy,{id,body->
                onSave(id,body){creatingThreadId=null;editing=null}
            },Modifier.weight(1f).align(Alignment.CenterHorizontally),targetId,threadInfo(targetId),loadTargets)
        }else{
            NativeBackdropScrollMotion{31*listState.firstVisibleItemIndex+listState.firstVisibleItemScrollOffset}
            val filtered=tasks.filter{filter=="all"||(it.status=="ACTIVE")== (filter=="active")}
            LazyVerticalGrid(columns=GridCells.Adaptive(300.dp),state=listState,modifier=Modifier.weight(1f).clipToBounds().testTag("automationList"),
                contentPadding=nativeManagementPadding(PaddingValues(horizontal=4.dp,vertical=12.dp)),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
                if(!loading&&filtered.isEmpty())item(span={GridItemSpan(maxLineSpan)}){
                    Column(Modifier.fillMaxWidth().padding(vertical=48.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){
                        Icon(painterResource(R.drawable.ic_lucide_clock_3),null,Modifier.size(32.dp),tint=MaterialTheme.colors.onSurface.copy(alpha=.4f))
                        Text(if(filter=="all")"还没有定时任务" else if(filter=="active")"没有启用的任务" else "没有暂停的任务",fontSize=15.sp)
                        if(filter=="all")Text("安排一次定时检查，结果会留在原会话里",fontSize=13.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                    }
                }
                items(filtered,key={it.id}){task->DashboardCard(color=MaterialTheme.colors.surface,modifier=Modifier.testTag("automation:${task.id}").clip(Radius.Card).clickable(enabled=!busy,role=androidx.compose.ui.semantics.Role.Button){editing=task.id}){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        Column(Modifier.weight(1f).padding(end=10.dp),verticalArrangement=Arrangement.spacedBy(5.dp)){
                            Text(task.name,fontSize=16.sp,fontWeight=FontWeight.SemiBold,maxLines=2,overflow=TextOverflow.Ellipsis)
                            Text(ruleLabel(task.rrule),fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                        }
                        DashboardSwitch(task.status=="ACTIVE",{checked->onSave(task.id,JSONObject().put("status",if(checked)"ACTIVE" else "PAUSED"),{})},enabled=connected&&!busy,
                            modifier=Modifier.semantics{contentDescription="${task.name}，启用定时任务"})
                    }
                    NativeAutomationTarget(task,task.threadId,threadInfo(task.threadId))
                    Text(task.prompt,fontSize=14.sp,lineHeight=21.sp,maxLines=2,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colors.onSurface.copy(alpha=.75f))
                    Divider(color=MaterialTheme.colors.onSurface.copy(alpha=.07f))
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Icon(painterResource(R.drawable.ic_lucide_clock_3),null,Modifier.size(14.dp),tint=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                        Text(if(task.status=="ACTIVE")"下次运行 · "+(task.nextRunAt?.let{java.text.SimpleDateFormat("M月d日 HH:mm",java.util.Locale.getDefault()).format(java.util.Date(it))}?:"等待安排") else "已暂停",
                            Modifier.weight(1f),fontSize=12.sp,lineHeight=18.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                        Icon(painterResource(R.drawable.ic_lucide_chevron_right),null,Modifier.size(16.dp),tint=MaterialTheme.colors.onSurface.copy(alpha=.5f))
                    }
                }}
            }
        }
    }
}
@Composable private fun NativeAutomationTarget(task:NativeAutomation?,threadId:String,thread:ThreadRecord?){
    val fallback=when{
        threadId.isNotBlank()->"会话 ${threadId.take(8)}"
        task?.kind=="cron"->"每次新建会话"
        else->"未绑定会话"
    }
    val title=nativeDisplayThreadTitle(task?.threadTitle?.takeIf{it.isNotBlank()}?:thread?.title.orEmpty(),fallback)
    val path=thread?.projectPath?.takeIf{it.isNotBlank()}?:task?.threadPath.orEmpty()
    Column(Modifier.fillMaxWidth().testTag("automationTarget:${task?.id?:"new"}"),verticalArrangement=Arrangement.spacedBy(4.dp)){
        Row(verticalAlignment=Alignment.Top){
            Icon(painterResource(R.drawable.ic_lucide_messages_square),null,Modifier.padding(top=2.dp,end=6.dp).size(15.dp),tint=MaterialTheme.colors.onSurface.copy(alpha=.6f))
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)){
                Text("执行会话",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
                Text(title,fontSize=14.sp,lineHeight=20.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
            }
        }
        if(path.isNotBlank())SelectionContainer{Text(nativeDisplayPath(path),fontSize=12.sp,lineHeight=17.sp,maxLines=2,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))}
    }
}
@Composable private fun NativeAutomationEditor(task:NativeAutomation?,connected:Boolean,busy:Boolean,onSave:(String?,JSONObject)->Unit,modifier:Modifier=Modifier,targetId:String=task?.threadId.orEmpty(),targetThread:ThreadRecord?=null,loadTargets:suspend (String,Int)->Pair<List<ThreadRecord>,Boolean>){
    var name by rememberSaveable(task?.id){mutableStateOf(task?.name.orEmpty())}
    var prompt by rememberSaveable(task?.id){mutableStateOf(task?.prompt.orEmpty())}
    var changeTime by rememberSaveable(task?.id){mutableStateOf(task==null)}
    var interval by rememberSaveable(task?.id){mutableStateOf(Regex("INTERVAL=(\\d+)").find(task?.rrule.orEmpty())?.groupValues?.get(1)?:"5")}
    var frequency by rememberSaveable(task?.id){mutableStateOf(Regex("FREQ=([A-Z]+)").find(task?.rrule.orEmpty())?.groupValues?.get(1)?:"MINUTELY")}
    val originalRule=task?.rrule.orEmpty()
    val initialDays=nativeRulePart(originalRule,"BYDAY").ifBlank{"MO"}
    var scheduleMode by rememberSaveable(task?.id){mutableStateOf(when{
        frequency=="DAILY"&&interval=="1"->"daily"
        frequency=="DAILY"->"custom"
        frequency=="WEEKLY"&&interval=="1"&&initialDays=="MO,TU,WE,TH,FR"->"weekdays"
        frequency=="WEEKLY"&&interval=="1"->"weekly"
        frequency=="WEEKLY"->"custom"
        else->"interval"
    })}
    var hour by rememberSaveable(task?.id){mutableStateOf(nativeRulePart(originalRule,"BYHOUR").ifBlank{"9"})}
    var minute by rememberSaveable(task?.id){mutableStateOf(nativeRulePart(originalRule,"BYMINUTE").ifBlank{"00"})}
    var days by rememberSaveable(task?.id){mutableStateOf(initialDays)}
    val scheduleBody=nativeScheduleBody(scheduleMode,frequency,interval,hour,minute,days)
    var selectedId by rememberSaveable(task?.id){mutableStateOf(targetId)}
    var selectedTitle by rememberSaveable(task?.id){mutableStateOf("")}
    var selectedPath by rememberSaveable(task?.id){mutableStateOf("")}
    var choosing by rememberSaveable(task?.id){mutableStateOf(targetId.isBlank()&&task?.kind!="cron")}
    BackHandler(enabled=choosing&&!busy){choosing=false}
    val fieldColors=TextFieldDefaults.textFieldColors(backgroundColor=MaterialTheme.colors.onSurface.copy(alpha=.04f),focusedIndicatorColor=Color.Transparent,unfocusedIndicatorColor=Color.Transparent,disabledIndicatorColor=Color.Transparent)
    Column(modifier.widthIn(max=720.dp).fillMaxWidth().testTag("automationEditor")){
        Column(Modifier.weight(1f).clipToBounds().nativeManagementScroll(rememberScrollState()).padding(horizontal=4.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
            DashboardCard(color=MaterialTheme.colors.surface){
                NativeAutomationTarget(task?.takeIf{selectedId==task.threadId},selectedId,if(selectedTitle.isNotBlank())ThreadRecord(selectedId,selectedPath,selectedTitle)else targetThread?.takeIf{it.id==selectedId})
                if(task?.kind!="cron"){
                    TextButton(onClick={choosing=!choosing},enabled=connected&&!busy){Text(if(choosing)"收起会话列表" else if(selectedId.isBlank())"指定执行会话" else "更换执行会话")}
                    if(choosing)NativeAutomationThreadPicker(connected,selectedId,loadTargets){thread->selectedId=thread.id;selectedTitle=thread.title;selectedPath=thread.projectPath;choosing=false}
                }
            }
            DashboardCard(color=MaterialTheme.colors.surface){
                DashboardHeading("任务内容")
                TextField(name,{name=it},label={Text("任务名称")},singleLine=true,shape=Radius.Control,colors=fieldColors,enabled=!busy,modifier=Modifier.fillMaxWidth())
                TextField(prompt,{prompt=it},label={Text("任务指令")},placeholder={Text("希望助手定时做什么？")},shape=Radius.Control,colors=fieldColors,enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=150.dp,max=280.dp))
            }
            DashboardCard(color=MaterialTheme.colors.surface){
                DashboardHeading("运行时间"){
                    if(task!=null)DashboardSwitch(changeTime,{changeTime=it},enabled=!busy,modifier=Modifier.semantics{contentDescription="修改运行时间"})
                }
                if(changeTime){
                    listOf("interval" to "间隔","daily" to "每天","weekdays" to "工作日","weekly" to "每周","custom" to "自定义").chunked(3).forEach{row->
                        Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){
                            row.forEach{(mode,label)->OutlinedButton(onClick={
                                scheduleMode=mode
                                if(mode=="interval"&&frequency !in listOf("MINUTELY","HOURLY"))frequency="HOURLY"
                                if(mode=="custom"&&frequency !in listOf("DAILY","WEEKLY"))frequency="WEEKLY"
                            },enabled=!busy,shape=Radius.Control,modifier=Modifier.weight(1f),contentPadding=PaddingValues(horizontal=6.dp,vertical=8.dp),colors=ButtonDefaults.outlinedButtonColors(backgroundColor=if(scheduleMode==mode)MaterialTheme.colors.primary.copy(alpha=.12f) else MaterialTheme.colors.surface)){
                                Text(label,fontSize=12.sp,color=if(scheduleMode==mode)MaterialTheme.colors.primary else MaterialTheme.colors.onSurface)
                            }}
                            if(row.size<3)Spacer(Modifier.weight((3-row.size).toFloat()))
                        }
                    }
                    if(scheduleMode=="interval"||scheduleMode=="custom"){
                        TextField(interval,{interval=it.filter(Char::isDigit).take(5)},label={Text("每隔")},singleLine=true,shape=Radius.Control,colors=fieldColors,enabled=!busy,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),modifier=Modifier.fillMaxWidth())
                        DashboardTabs(if(scheduleMode=="interval")listOf("MINUTELY" to "分钟","HOURLY" to "小时") else listOf("DAILY" to "天","WEEKLY" to "周"),frequency,{frequency=it},enabled=!busy)
                    }
                    if(scheduleMode!="interval"){
                        NativeClockFields("运行时间",hour,minute,{hour=it},{minute=it},!busy)
                        if(scheduleMode=="weekly"||(scheduleMode=="custom"&&frequency=="WEEKLY")){
                            Text("运行星期 · 可多选",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                            nativeWeekdays.chunked(4).forEach{row->Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){
                                row.forEach{(code,label)->
                                    val checked=code in days.split(',')
                                    OutlinedButton(onClick={days=(if(checked)days.split(',')-code else days.split(',')+code).filter{it.isNotBlank()}.joinToString(",")},enabled=!busy,shape=Radius.Chip,modifier=Modifier.weight(1f),contentPadding=PaddingValues(horizontal=4.dp,vertical=8.dp),colors=ButtonDefaults.outlinedButtonColors(backgroundColor=if(checked)MaterialTheme.colors.primary.copy(alpha=.12f) else MaterialTheme.colors.surface)){Text("周"+label,color=if(checked)MaterialTheme.colors.primary else MaterialTheme.colors.onSurface,fontSize=12.sp)}
                                }
                                if(row.size<4)Spacer(Modifier.weight((4-row.size).toFloat()))
                            }}
                        }
                        Text("按电脑时区运行",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.55f))
                    }
                }else Text(ruleLabel(task?.rrule.orEmpty()),fontSize=14.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
            }
        }
        DashboardAction(if(busy)"正在保存…" else "保存任务",{
            val body=JSONObject().put("name",name.trim()).put("prompt",prompt.trim())
            if(task==null||selectedId!=task.threadId)body.put("threadId",selectedId)
            if(changeTime)body.put("schedule",scheduleBody)
            onSave(task?.id,body)
        },Modifier.fillMaxWidth().padding(horizontal=4.dp,vertical=12.dp),enabled=connected&&!busy&&(selectedId.isNotBlank()||task?.kind=="cron")&&name.isNotBlank()&&prompt.isNotBlank()&&(!changeTime||scheduleBody!=null),primary=true)
    }
}

@Composable private fun NativeAutomationThreadPicker(connected:Boolean,selectedId:String,loadTargets:suspend (String,Int)->Pair<List<ThreadRecord>,Boolean>,onSelect:(ThreadRecord)->Unit){
    var query by rememberSaveable{mutableStateOf("")}
    var limit by rememberSaveable(query){mutableIntStateOf(60)}
    var retry by remember{mutableIntStateOf(0)}
    var rows by remember{mutableStateOf(emptyList<ThreadRecord>())}
    var loading by remember{mutableStateOf(true)}
    var hasMore by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf("")}
    val loader by rememberUpdatedState(loadTargets)
    LaunchedEffect(query,limit,connected,retry){
        rows=emptyList();error="";loading=connected
        if(!connected)return@LaunchedEffect
        try{
            if(query.isNotBlank())kotlinx.coroutines.delay(250)
            val result=loader(query,limit);rows=result.first;hasMore=result.second
        }catch(e:kotlinx.coroutines.CancellationException){throw e}catch(e:Exception){error=e.message?.takeIf{it.isNotBlank()}?:"读取会话失败"}finally{loading=false}
    }
    TextField(query,{query=it},label={Text("搜索会话名称、路径或 ID")},singleLine=true,shape=Radius.Control,modifier=Modifier.fillMaxWidth())
    Box(Modifier.fillMaxWidth().height(2.dp)){if(loading)LinearProgressIndicator(Modifier.fillMaxSize())}
    if(error.isNotBlank()){Text(error,fontSize=12.sp,color=MaterialTheme.colors.error);TextButton(onClick={retry++}){Text("重试")}}
    LazyColumn(Modifier.fillMaxWidth().heightIn(max=300.dp).testTag("automationThreadPicker"),verticalArrangement=Arrangement.spacedBy(2.dp)){
        items(rows,key={it.id}){thread->
            Row(Modifier.fillMaxWidth().clip(Radius.Control).clickable{onSelect(thread)}.padding(10.dp),verticalAlignment=Alignment.CenterVertically){
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)){
                    Text(nativeDisplayThreadTitle(thread.title),fontSize=14.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
                    if(thread.projectPath.isNotBlank())Text(nativeDisplayPath(thread.projectPath),fontSize=11.sp,maxLines=2,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
                    Text(thread.id,fontSize=10.sp,maxLines=1,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colors.onSurface.copy(alpha=.5f))
                }
                if(thread.id==selectedId)Icon(painterResource(R.drawable.ic_lucide_check),"已选择",Modifier.padding(start=8.dp).size(18.dp),tint=MaterialTheme.colors.primary)
            }
        }
        if(!loading&&error.isBlank()&&rows.isEmpty())item{Text("没有匹配的会话",Modifier.padding(10.dp),fontSize=13.sp)}
        if(hasMore&&!loading)item{TextButton(onClick={limit=(limit+60).coerceAtMost(500)},enabled=limit<500){Text(if(limit<500)"加载更多" else "请输入关键词缩小范围")}}
    }
}
