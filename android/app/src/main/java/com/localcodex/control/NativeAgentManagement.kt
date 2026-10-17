package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.util.Locale

data class NativeHarnessProcess(val state:String="unknown",val count:Int=0,val memoryBytes:Long?=null,val sampledAt:String="",val error:String="")
data class NativeHarnessUpdate(val state:String="not_checked",val installedVersion:String="",val latestVersion:String="",val checkedAt:String="",val source:String="",val url:String="",val error:String="")
data class NativeAgentHealth(val agent:String,val name:String,val state:String,val installed:Boolean?,val version:String,val reason:String,val activeCount:Int?,val models:Int?,val pending:Int,val versionError:String,val lastFailure:String,val process:NativeHarnessProcess=NativeHarnessProcess(),val update:NativeHarnessUpdate=NativeHarnessUpdate(),val publicAllowed:Boolean=true)
data class NativeAgentHealthState(val agents:List<NativeAgentHealth> = emptyList(),val loading:Boolean=false,val checkedAt:String="",val error:String="",val desktop:NativeAgentHealth?=null,val checkingUpdates:Boolean=false,val accessBusy:String="")

internal fun parseNativeAgentHealth(row:JSONObject):NativeAgentHealth{
    fun text(data:JSONObject,key:String)=if(data.isNull(key))"" else data.optString(key)
    val process=row.optJSONObject("process")?:JSONObject()
    val update=row.optJSONObject("update")?:JSONObject()
    return NativeAgentHealth(text(row,"agent").ifBlank{text(row,"id")},text(row,"name"),text(row,"state"),row.opt("installed") as? Boolean,text(row,"version"),text(row,"reason"),if(!row.isNull("activeCount"))row.optInt("activeCount") else null,if(!row.isNull("modelCount"))row.optInt("modelCount") else null,row.optInt("pendingRequests"),text(row,"versionError"),row.optJSONObject("lastFailure")?.let{text(it,"message")}.orEmpty(),
        NativeHarnessProcess(text(process,"state").ifBlank{"unknown"},process.optInt("count"),if(process.isNull("memoryBytes"))null else process.optLong("memoryBytes").takeIf{it>=0},text(process,"sampledAt"),text(process,"error")),
        NativeHarnessUpdate(text(update,"state").ifBlank{"not_checked"},text(update,"installedVersion"),text(update,"latestVersion"),text(update,"checkedAt"),text(update,"source"),text(update,"url"),text(update,"error")),row.optBoolean("publicAllowed",true))
}

@Composable internal fun NativeAgentManagement(vm:NativeViewModel,back:()->Unit){
    val state=vm.agentHealth
    val connected=vm.state.connected
    val active=LocalManagementPageActive.current
    val owner=LocalLifecycleOwner.current
    var foreground by remember(owner){mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))}
    DisposableEffect(owner){val observer=LifecycleEventObserver{_,_->foreground=owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)};owner.lifecycle.addObserver(observer);onDispose{owner.lifecycle.removeObserver(observer)}}
    LaunchedEffect(vm,connected,active,foreground,vm.state.address){
        if(connected&&active&&foreground){
            vm.loadAgentHealth()
            while(true){delay(30000);vm.loadAgentHealth()}
        }
    }
    NativeAgentManagementContent(state,connected,back,{vm.loadAgentHealth(force=true)},{vm.checkAgentUpdates()},vm.state.backendRestart,"shared-backend-restart" in vm.state.capabilities,{vm.sharedBackendRestart()},"harness-public-access" in vm.state.capabilities,vm::setHarnessPublicAccess)
}

@Composable internal fun NativeAgentManagementContent(state:NativeAgentHealthState,connected:Boolean,back:()->Unit,onRefresh:()->Unit,onCheckUpdates:()->Unit,restart:NativeBackendRestart=NativeBackendRestart(),canRestart:Boolean=false,onRestart:()->Unit={},canManagePublic:Boolean=false,onPublicAccess:(String,Boolean)->Unit={_,_->}){
    NativeManagementPage("助手管理","",back,modifier=Modifier.testTag("agentManagement"),actions={
        TextButton(onClick=onRefresh,enabled=connected&&!state.loading){Text(if(state.loading)"检查中…" else "刷新")}
    }){
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            if(!connected)Text("连接电脑后查看助手状态",fontSize=14.sp)
            DashboardAction(if(state.checkingUpdates)"正在检查更新…" else "检查更新",onCheckUpdates,Modifier.fillMaxWidth().testTag("checkHarnessUpdates"),connected&&!state.checkingUpdates)
            if(state.error.isNotBlank())Text(state.error,color=MaterialTheme.colors.error,fontSize=13.sp)
            (state.agents+listOfNotNull(state.desktop)).forEach{agent->key(agent.agent){DashboardCard(Modifier.testTag("agentHealth:${agent.agent}")){
                val muted=MaterialTheme.colors.onSurface.copy(alpha=.6f)
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Text(agent.name,Modifier.weight(1f),fontSize=16.sp,fontWeight=FontWeight.SemiBold)
                    Text(when{!connected->"未连接";agent.installed==null->"安装状态未知";agent.installed==false->"未安装";agent.state=="ready"->"可用";agent.state=="connecting"->"连接中";agent.agent=="codex-desktop"->"已安装";else->"需检查"},fontSize=12.sp,color=if(connected&&agent.state=="ready")MaterialTheme.colors.primary else muted)
                }
                if(agent.version.isNotBlank())Text(agent.version,Modifier.padding(top=6.dp),fontSize=12.sp,color=muted)
                val details=listOfNotNull(agent.activeCount?.let{"$it 个任务运行中"},agent.models?.let{"$it 个模型"},if(agent.agent=="codex")"${agent.pending} 个等待请求" else null)
                if(details.isNotEmpty())Text(details.joinToString(" · "),Modifier.padding(top=8.dp),fontSize=12.sp,color=muted)
                Row(Modifier.fillMaxWidth().padding(top=12.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                    Column(Modifier.weight(1f)){
                        Text("进程",fontSize=11.sp,color=muted)
                        Text(when{!connected->"—";agent.process.state=="running"->"运行中 · ${agent.process.count}";agent.process.state=="stopped"->"未运行";else->"未读取"},fontSize=14.sp,fontWeight=FontWeight.Medium)
                    }
                    Column(Modifier.weight(1f)){
                        Text("内存",fontSize=11.sp,color=muted)
                        Text(if(!connected)"—" else agent.process.memoryBytes?.let{if(it>=1024L*1024*1024)String.format(Locale.ROOT,"%.2f GB",it.toDouble()/(1024*1024*1024)) else String.format(Locale.ROOT,"%.1f MB",it.toDouble()/(1024*1024))}?:"—",fontSize=14.sp,fontWeight=FontWeight.Medium)
                    }
                }
                val update=agent.update
                Text(when(update.state){"checking"->"正在检查新版…";"current"->"已是最新版本";"available"->"发现新版 ${update.latestVersion}";"unsupported"->"${update.source.ifBlank{"当前来源"}} · 暂不支持版本比较";"unknown"->"暂未确认最新版本";else->"尚未检查新版"},Modifier.padding(top=10.dp),fontSize=12.sp,color=if(update.state=="available")MaterialTheme.colors.primary else muted)
                if(update.error.isNotBlank())Text(update.error,fontSize=11.sp,color=muted)
                if(agent.process.error.isNotBlank())Text(agent.process.error,fontSize=11.sp,color=muted)
                if(agent.reason.isNotBlank())Text(agent.reason,Modifier.padding(top=8.dp),fontSize=12.sp,color=MaterialTheme.colors.error)
                if(agent.versionError.isNotBlank())Text(agent.versionError,Modifier.padding(top=8.dp),fontSize=12.sp,color=muted)
                if(agent.lastFailure.isNotBlank())Text("上次任务失败 · ${agent.lastFailure}",Modifier.padding(top=8.dp),fontSize=12.sp,color=muted)
                if(canManagePublic&&agent.agent!="codex-desktop")Row(Modifier.fillMaxWidth().padding(top=12.dp),verticalAlignment=Alignment.CenterVertically){
                    Text("公网访问",Modifier.weight(1f),fontSize=14.sp)
                    DashboardSwitch(agent.publicAllowed,{onPublicAccess(agent.agent,it)},enabled=connected&&state.accessBusy.isBlank(),modifier=Modifier.testTag("harnessPublic:${agent.agent}"))
                }
                if(agent.agent=="codex"&&canRestart){
                    TextButton(onClick=onRestart,enabled=connected&&!restart.busy,modifier=Modifier.testTag("agentRestart:codex")){Text(if(restart.busy)"正在检查…" else "重启 Codex")}
                    if(restart.error.isNotBlank())Text(restart.error,fontSize=12.sp,color=MaterialTheme.colors.error)
                    if(restart.done)Text("共享后端已重启",fontSize=12.sp,color=muted)
                }
            }}}
            if(state.checkedAt.isNotBlank())Text("检查于 ${runCatching{java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date.from(java.time.Instant.parse(state.checkedAt)))}.getOrDefault(state.checkedAt)}",Modifier.padding(horizontal=4.dp),fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.5f))
        }
    }
}
