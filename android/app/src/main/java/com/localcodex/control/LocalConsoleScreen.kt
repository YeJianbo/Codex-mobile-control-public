package com.localcodex.control

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.text.DateFormat
import java.util.Date

private fun consoleTime(value:String)=runCatching{DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(Date.from(java.time.Instant.parse(value)))}.getOrDefault("—")

@Composable internal fun LocalConsoleRoute(vm:NativeViewModel,close:()->Unit,quotaContent:(@Composable ()->Unit)?=null){
    val connected=vm.state.connected
    val active=LocalManagementPageActive.current
    val owner=LocalLifecycleOwner.current
    var foreground by remember(owner){mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))}
    DisposableEffect(owner){val observer=LifecycleEventObserver{_,_->foreground=owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)};owner.lifecycle.addObserver(observer);onDispose{owner.lifecycle.removeObserver(observer)}}
    var section by rememberSaveable{mutableStateOf(if(quotaContent!=null)"额度" else "统计")}
    LaunchedEffect(vm,connected,active,foreground,vm.state.address,section){
        if(connected&&active&&foreground&&section!="额度"){
            fun refresh(){if(section=="统计")vm.loadLocalConsole(includeInfo=false) else vm.loadConsoleInfo()}
            refresh()
            while(true){
                delay(if(section=="统计"&&vm.state.localConsole.statistics?.indexing==true||section!="统计"&&vm.state.localConsole.info?.catalog?.running==true)10000L else 30000L)
                if(vm.state.localConsole.busyAction.isBlank())refresh()
            }
        }
    }
    LocalConsoleContent(vm.state.localConsole,connected,close,{if(section=="统计")vm.loadLocalConsole(includeInfo=false) else vm.loadConsoleInfo()},
        {source,range,pricing->vm.loadLocalConsole(source,range,pricing,includeInfo=false)},
        {action,id,enabled->vm.localConsoleAction(action,id,enabled)},quotaContent=quotaContent,selectedSection=section,onSectionChange={section=it})
}

@Composable internal fun LocalConsoleContent(
    state:LocalConsoleUiState,connected:Boolean,onClose:()->Unit,onRefresh:()->Unit,
    onFilter:(String,String,String)->Unit,onAction:(String,String?,Boolean?)->Unit,modifier:Modifier=Modifier,
    quotaContent:(@Composable ()->Unit)?=null,selectedSection:String?=null,onSectionChange:((String)->Unit)?=null
){
    var savedSection by rememberSaveable{mutableStateOf(if(quotaContent!=null)"额度" else "统计")}
    val section=selectedSection?:savedSection
    val sections=rememberSaveableStateHolder()
    NativeManagementPage(if(quotaContent!=null)"用量与额度" else "电脑控制台",if(quotaContent!=null)"" else if(!connected)"尚未连接电脑" else state.info?.let{"v${it.version} · ${it.models.size} 个模型"}?:"本机服务",onClose,
        modifier=modifier.testTag("localConsole"),actions={
            if(section!="额度")IconButton(onClick=onRefresh,enabled=connected&&!(if(section=="统计")state.statisticsLoading else state.infoLoading)&&state.busyAction.isBlank()){
                Icon(painterResource(R.drawable.ic_lucide_rotate_cw),"刷新电脑控制台")
            }
        }){
                DashboardTabs((if(quotaContent!=null)listOf("额度" to "额度") else emptyList())+listOf("统计" to "统计","模型" to "模型","服务" to "服务"),section,{if(onSectionChange!=null)onSectionChange(it) else savedSection=it},Modifier.padding(horizontal=16.dp))
                sections.SaveableStateProvider(section){Column(Modifier.weight(1f).clipToBounds().verticalScroll(rememberScrollState()).padding(16.dp).testTag("consoleScroll")){
                    if(!connected&&section!="额度")Text("连接电脑后查看统计与管理模型",color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
                    if(section=="额度")quotaContent?.invoke()
                    else if(section=="统计")ConsoleStatisticsContent(state,connected,onFilter,onAction)
                    else{
                        if(state.infoError.isNotBlank())ConsoleErrorText(state.infoError)
                        if(state.infoLoading&&state.info==null)Text("正在读取控制台…")
                        if(section=="模型")ConsoleModelsContent(state,connected,onAction) else ConsoleServiceContent(state.info)
                    }
                }}
    }
}

@Composable private fun ConsoleChips(options:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit,modifier:Modifier=Modifier,enabled:Boolean=true){
    DashboardTabs(options,selected,onSelect,modifier,enabled)
}
@Composable internal fun ConsoleErrorText(message:String){Text(message,Modifier.padding(bottom=12.dp),color=MaterialTheme.colors.error,fontSize=13.sp)}
@Composable private fun ConsoleHeading(text:String){Text(text,Modifier.padding(top=22.dp,bottom=12.dp),fontSize=16.sp,fontWeight=FontWeight.SemiBold)}
@Composable private fun ConsoleMetrics(values:List<Pair<String,String>>){
    values.chunked(2).forEach{row->Row(Modifier.fillMaxWidth().padding(vertical=10.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)){
        row.forEach{(label,value)->Column(Modifier.weight(1f)){Text(label,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f));Text(value,Modifier.padding(top=4.dp),fontSize=23.sp,fontWeight=FontWeight.Medium)}}
    }}
}

@Composable private fun ConsoleModelsContent(state:LocalConsoleUiState,connected:Boolean,onAction:(String,String?,Boolean?)->Unit){
    val info=state.info?:return
    val busy=state.busyAction.isNotBlank();val enabled=connected&&!busy&&!state.infoLoading
    var query by rememberSaveable{mutableStateOf("")};var filter by rememberSaveable{mutableStateOf("all")}
    if(state.actionMessage.isNotBlank())Text(state.actionMessage,Modifier.padding(bottom=12.dp),fontSize=13.sp,color=MaterialTheme.colors.primary)
    DashboardCard(color=MaterialTheme.colors.surface){
    DashboardHeading("电脑默认模型")
    Text(info.model.ifBlank{"未设置"},fontSize=18.sp,fontWeight=FontWeight.SemiBold)
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        DashboardAction(if(state.busyAction=="refresh"||info.catalog.running)"正在检查…" else "检查官方模型",{onAction("refresh",null,null)},Modifier.weight(1f).testTag("consoleRefreshModels"),enabled&&!info.catalog.running,primary=true)
        DashboardAction(if(state.busyAction=="rebuild")"重建中…" else "重建目录",{onAction("rebuild",null,null)},Modifier.testTag("consoleRebuildModels"),enabled&&!info.catalog.running)
    }
    Text("上次检查 ${consoleTime(info.catalog.lastChecked)}",Modifier.padding(top=10.dp),fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
    if(info.catalog.lastUpdated.isNotBlank())Text("上次更新 ${consoleTime(info.catalog.lastUpdated)}",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
    if(info.catalog.automatic)Text("自动检查间隔 ${info.catalog.intervalHours?.toInt()?:6} 小时",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
    }
    if(info.catalog.error.isNotBlank())ConsoleErrorText(info.catalog.error)
    if(info.modelError.isNotBlank())ConsoleErrorText(info.modelError)
    TextField(value=query,onValueChange={query=it},placeholder={Text("搜索模型",fontSize=14.sp)},singleLine=true,shape=Radius.Control,
        colors=TextFieldDefaults.textFieldColors(backgroundColor=MaterialTheme.colors.onSurface.copy(alpha=0.035f),focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent),
        modifier=Modifier.fillMaxWidth().padding(top=18.dp,bottom=12.dp).testTag("consoleModelSearch"))
    ConsoleChips(listOf("all" to "全部","official" to "官方","relay" to "中转"),filter,{filter=it})
    val models=info.models.filter{(filter=="all"||it.official==(filter=="official"))&&(query.isBlank()||it.id.contains(query,true)||it.name.contains(query,true))}
    Text("${models.size} 个模型 · ${info.models.count{it.enabled}} 个已启用",Modifier.padding(top=14.dp,bottom=6.dp),fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
    if(models.isEmpty())Text("没有匹配的模型",Modifier.padding(vertical=20.dp),fontSize=14.sp)
    models.forEach{model->
        DashboardCard(Modifier.padding(vertical=5.dp).testTag("consoleModel:${model.id}"),color=MaterialTheme.colors.surface){
            Row(verticalAlignment=Alignment.CenterVertically){
                Column(Modifier.weight(1f).padding(end=10.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                    Text(nativeCompactModelName(model.name),fontSize=15.sp,fontWeight=FontWeight.SemiBold,maxLines=2,overflow=TextOverflow.Ellipsis)
                    Text((if(model.official)"官方" else "中转")+" · "+(model.context?.let{"上下文 ${nativeContextCount(it)}"}?:"上下文未记录"),fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
                }
                DashboardSwitch(checked=model.enabled,onCheckedChange={onAction("toggle",model.id,it)},enabled=enabled&&!info.catalog.running,modifier=Modifier.testTag("consoleToggle:${model.id}"))
            }
            Row(verticalAlignment=Alignment.CenterVertically){
                Text(if(model.name!=model.id)model.id else if(model.enabled)"已启用" else "已隐藏",Modifier.weight(1f).padding(end=8.dp),fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f),maxLines=1,overflow=TextOverflow.Ellipsis)
                if(model.isDefault)Text("电脑默认",Modifier.clip(Radius.Chip).background(MaterialTheme.colors.primary.copy(alpha=0.08f)).padding(horizontal=10.dp,vertical=7.dp),fontSize=11.sp,fontWeight=FontWeight.Medium,color=MaterialTheme.colors.primary)
                else if(consoleDefaultAllowed(info,model))DashboardAction("设为默认",{onAction("default",model.id,null)},Modifier.testTag("consoleDefault:${model.id}"),enabled&&!info.catalog.running)
            }
        }
    }
}

@Composable private fun ConsoleServiceContent(info:ConsoleInfo?){
    if(info==null)return
    Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
        DashboardCard(color=MaterialTheme.colors.surface){
            DashboardHeading("本机服务"){Text("v${info.version}",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))}
            ConsoleMetrics(listOf("转发请求" to consoleCount(info.service.requests),"失败请求" to consoleCount(info.service.errors),"正在转发" to consoleCount(info.service.activeRequests),"内存" to (info.service.memoryMB?.let{"$it MB"}?:"—")))
            Text("启动于 ${consoleTime(info.service.startedAt)}",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
        }
        DashboardCard(color=MaterialTheme.colors.surface){
            DashboardHeading("模型目录")
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(14.dp)){
                DashboardMetric("已启用",info.models.count{it.enabled}.toString(),Modifier.weight(1f))
                DashboardMetric("已隐藏",info.models.count{!it.enabled}.toString(),Modifier.weight(1f))
            }
            Text("提供商 ${info.provider.ifBlank{"未记录"}}",fontSize=13.sp)
        }
        Text("更新于 ${consoleTime(info.updatedAt)}",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
    }
}
