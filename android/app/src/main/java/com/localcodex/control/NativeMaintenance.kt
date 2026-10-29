package com.localcodex.control

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val maintenancePrefix="/api/mobile-management/"
private data class ManagementLoad(val data:JSONObject?=null,val busy:Boolean=false,val error:String="",val message:String="")

/** Requests follow the visible page, including dialogs retained during close animations. */
private class ManagementRequests(private val scope:CoroutineScope,private val request:suspend(String,JSONObject?)->JSONObject){
    var state by mutableStateOf(ManagementLoad());private set
    private var job:Job?=null
    private var ticket=0
    fun run(work:suspend ManagementRequests.()->Unit){
        if(state.busy)return
        val current=++ticket
        state=state.copy(busy=true,error="",message="")
        job=scope.launch{
            try{work()}catch(cancel:CancellationException){throw cancel}
            catch(error:Exception){if(current==ticket)state=state.copy(error=error.message.orEmpty().ifBlank{"操作失败，请刷新后重试"})}
            finally{if(current==ticket)state=state.copy(busy=false)}
        }
    }
    suspend fun call(route:String,body:JSONObject?=null)=request(maintenancePrefix+route,body)
    suspend fun reload(route:String){state=state.copy(data=call(route))}
    fun message(value:String){state=state.copy(message=value)}
    fun cancel(){ticket++;job?.cancel();job=null;state=state.copy(busy=false)}
}

@Composable private fun rememberManagementRequests(vm:NativeViewModel,route:String,active:Boolean):ManagementRequests{
    val scope=rememberCoroutineScope()
    val address=vm.state.address
    val requests=remember(vm,address,route){ManagementRequests(scope,vm::managementRequest)}
    val connected=vm.state.connected
    LaunchedEffect(requests,connected,active){
        if(connected&&active)requests.run{reload(route)} else requests.cancel()
    }
    DisposableEffect(requests){onDispose{requests.cancel()}}
    return requests
}

private data class MaintenanceCheck(val title:String,val detail:String,val status:String)
private data class MaintenanceBackup(val id:String,val kind:String,val at:String)
private data class MaintenanceEvent(val at:String,val status:String,val count:Int)
private data class MaintenanceOperation(val action:String,val state:String,val at:String,val started:Boolean,val error:String)
private data class MaintenanceSnapshot(
    val home:String="",val catalog:String="",val provider:String="",val model:String="",val route:String="",val port:Int=0,val memoryMB:Int=0,val startedAt:String="",
    val gatewayRunning:Boolean=false,val gatewayAutoStart:Boolean=false,val gatewayOrigin:String="",
    val backendRunning:Boolean=false,val backendPid:Int=0,val backendStartedAt:String="",val catalogReloadPending:Boolean=false,val backendOperation:MaintenanceOperation?=null,
    val processOperation:MaintenanceOperation?=null,val backups:List<MaintenanceBackup> = emptyList(),val events:List<MaintenanceEvent> = emptyList(),
)
private data class MaintenanceRenderState(val snapshot:MaintenanceSnapshot?,val checks:List<MaintenanceCheck>,val busy:Boolean,val error:String,val message:String,val connected:Boolean)
private data class MaintenanceChoice(val id:Int?=null,val title:String,val detail:String="")
private data class MaintenanceConfirmation(
    val action:String,val title:String,val detail:String,val planId:String,val choices:List<MaintenanceChoice> = emptyList(),
    val acknowledge:Boolean=false,val selectable:Boolean=false,val report:String="",val app:String="",val profileId:String="",
)

@Composable internal fun NativeDiagnosticsManagement(vm:NativeViewModel,back:()->Unit){
    val active=LocalManagementPageActive.current
    val connected=vm.state.connected
    val address=vm.state.address
    val requests=rememberManagementRequests(vm,"maintenance",active)
    var checks by remember(address){mutableStateOf<List<MaintenanceCheck>>(emptyList())}
    var confirmation by remember(address){mutableStateOf<MaintenanceConfirmation?>(null)}
    var reportText by remember(address){mutableStateOf<String?>(null)}
    val context=LocalContext.current
    val latestReport by rememberUpdatedState(reportText)
    val saveReport=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")){uri->
        val value=latestReport
        if(uri!=null&&value!=null)requests.run{
            withContext(Dispatchers.IO){
                val output=context.contentResolver.openOutputStream(uri)?:throw IllegalStateException("无法打开保存位置")
                output.use{it.write(value.toByteArray(Charsets.UTF_8))}
            }
            message("诊断报告已保存")
        }
    }
    val source=requests.state
    val snapshot=remember(source.data){source.data?.let(::maintenanceSnapshot)}
    fun action(name:String,body:JSONObject=JSONObject()){
        if(!connected||!active)return
        requests.run{
            when(name){
                "diagnose"->{checks=maintenanceObjects(call("maintenance/diagnose",JSONObject()).optJSONArray("checks")).map{MaintenanceCheck(it.maintenanceText("title"),it.maintenanceText("detail"),it.maintenanceText("status"))};message("诊断完成")}
                "repair-preview"->{
                    val result=call("maintenance/repair-preview",JSONObject())
                    val choices=maintenanceObjects(result.optJSONArray("actions")).map{MaintenanceChoice(title=it.maintenanceText("title"),detail=it.maintenanceText("detail"))}
                    if(choices.isEmpty())message("没有需要自动修复的项目") else confirmation=MaintenanceConfirmation("repair","确认修复","将修复以下配置项目，并保留原有备份机制。",result.maintenanceText("planId"),choices)
                }
                "report"->{reportText=call("maintenance/report").toString(2)}
                "backup"->{val result=call("maintenance/backup",JSONObject());reload("maintenance");message("配置已备份：${result.maintenanceText("id")}")}
                "restore-preview"->{
                    val result=call("maintenance/restore-preview",body)
                    val backup=result.optJSONObject("backup")?:JSONObject()
                    confirmation=MaintenanceConfirmation("restore","恢复 Codex 配置",result.maintenanceText("message"),result.maintenanceText("planId"),listOf(MaintenanceChoice(title=maintenanceDate(backup.maintenanceText("at")),detail="备份 ${backup.maintenanceText("id")}\n当前路由：${result.maintenanceText("currentProvider")}")),acknowledge=true)
                }
                "cleanup-preview"->{
                    val result=call("maintenance/cleanup-preview",body)
                    val choices=maintenanceObjects(result.optJSONArray("files")).map{MaintenanceChoice(it.optInt("id"),"${it.maintenanceText("group")}/${it.maintenanceText("name")}","${maintenanceBytes(it.optLong("bytes"))} · ${maintenanceDate(it.maintenanceText("at"))}")}
                    if(choices.isEmpty())message("没有符合条件的旧备份") else confirmation=MaintenanceConfirmation("cleanup","永久删除旧备份","保留最近 ${result.optInt("keep")} 份和 ${result.optInt("days")} 天内备份。候选总计 ${maintenanceBytes(result.optLong("totalBytes"))}；选中的文件将永久删除。",result.maintenanceText("planId"),choices,acknowledge=true,selectable=true)
                }
                "process-preview"->{
                    val result=call("maintenance/process-preview",body)
                    val operation=result.maintenanceText("action")
                    val choices=maintenanceObjects(result.optJSONArray("targets")).map{MaintenanceChoice(title="${it.maintenanceText("name")} · PID ${it.optInt("id")}",detail="${it.optInt("memoryMB")} MB")}
                    if(operation=="stop"&&choices.isEmpty())message("没有可关闭的 Codex 桌面进程") else confirmation=MaintenanceConfirmation("process-apply",if(operation=="stop")"强制关闭 Codex" else "重启 Codex",if(choices.isEmpty())"桌面未运行，将启动已安装的 Codex。" else "将关闭以下桌面及子进程，正在执行的任务可能中断。",result.maintenanceText("planId"),choices,acknowledge=true)
                }
                "gateway/start"->{call("maintenance/gateway/start",JSONObject());reload("maintenance");message("后台监听已启动")}
                "gateway/autostart"->{call("maintenance/gateway/autostart",body);reload("maintenance");message("后台启动设置已保存")}
                "backend/restart-preview"->{
                    val result=call("maintenance/backend/restart-preview",JSONObject())
                    if(!result.optBoolean("canRestart")){
                        val blocking=maintenanceObjects(result.optJSONArray("blockingThreads")).joinToString("、"){it.maintenanceText("name")}
                        message(if(blocking.isBlank())"共享后端暂不能重启，请刷新后检查" else "请等待运行任务结束：$blocking")
                    }else confirmation=MaintenanceConfirmation("backend/restart","重启 Codex",if(result.optBoolean("desktopRunning"))"将重启桌面端与共享 CLI，完成后恢复桌面窗口。会话记录保留，连接会短暂断开。" else "将重启共享 CLI。桌面端当前未运行，重启后保持关闭。会话记录保留，连接会短暂断开。",result.maintenanceText("planId"))
                }
            }
        }
    }
    NativeDiagnosticsManagementContent(MaintenanceRenderState(snapshot,checks,source.busy,source.error,source.message,connected),back,{requests.run{reload("maintenance")}},::action,performance={NativePerformancePanel(vm)})
    confirmation?.let{preview->MaintenanceConfirmationDialog(preview,source.busy,connected,onDismiss={confirmation=null}){selected->
        confirmation=null
        requests.run{
            val body=JSONObject().put("planId",preview.planId).put("confirmed",true)
            if(preview.action=="cleanup")body.put("selected",JSONArray(selected.sorted()))
            if(preview.action=="process-apply")body.put("allowActive",true)
            val result=call("maintenance/${preview.action}",body)
            when(preview.action){
                "repair"->{
                    val failed=maintenanceObjects(result.optJSONArray("results")).filter{!it.optBoolean("ok")}
                    checks=maintenanceObjects(call("maintenance/diagnose",JSONObject()).optJSONArray("checks")).map{MaintenanceCheck(it.maintenanceText("title"),it.maintenanceText("detail"),it.maintenanceText("status"))}
                    message(if(failed.isEmpty())"修复完成" else "部分修复失败：${failed.first().maintenanceText("error")}")
                }
                "cleanup"->{val failed=maintenanceObjects(result.optJSONArray("results")).count{!it.optBoolean("ok")};message("已释放 ${maintenanceBytes(result.optLong("freedBytes"))}"+if(failed>0)"；$failed 项变化或删除失败" else "")}
                "restore"->message("配置已恢复；恢复前版本已备份为 ${result.maintenanceText("undo")}")
                "send"->message(if(result.optBoolean("sent"))"诊断信息已发送" else "诊断信息未发送")
                "process-apply"->message("进程操作已接收，稍后刷新查看结果")
                "backend/restart"->message("共享后端已重启")
            }
            reload("maintenance")
        }
    }}
    reportText?.let{value->MaintenanceReportDialog(value,source.busy,source.error,onDismiss={reportText=null},onSave={saveReport.launch("local-console-diagnostics.json")}){destination->
        requests.run{
            val result=call("maintenance/send-preview",JSONObject().put("destination",destination))
            reportText=null
            confirmation=MaintenanceConfirmation("send","发送诊断信息","接收地址：${result.maintenanceText("destination")}\n本机将在发送时重新采样以下类型的脱敏诊断信息。",result.maintenanceText("planId"),acknowledge=true,report=result.optJSONObject("report")?.toString(2).orEmpty())
        }
    }}
}

@Composable private fun NativeDiagnosticsManagementContent(state:MaintenanceRenderState,back:()->Unit,refresh:()->Unit,action:(String,JSONObject)->Unit,performance:@Composable ()->Unit){
    val enabled=state.connected&&!state.busy
    val snapshot=state.snapshot
    var keep by remember{mutableStateOf("5")}
    var days by remember{mutableStateOf("7")}
    NativeManagementPage("配置与恢复","诊断与维护",back,modifier=Modifier.testTag("nativeDiagnosticsManagement"),actions={ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",refresh,enabled=enabled)}){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),state=rememberNativeManagementListState(),contentPadding=nativeManagementPadding(PaddingValues(16.dp)),verticalArrangement=Arrangement.spacedBy(12.dp)){
            item{ManagementFeedback(state.connected,state.busy,state.error,state.message)}
            item{performance()}
            item{DashboardCard{
                Text("维护工具",fontWeight=FontWeight.SemiBold)
                MaintenanceAction("系统诊断","检查配置、模型目录、账号索引、工具路径和后台进程。","运行诊断",enabled){action("diagnose",JSONObject())}
                MaintenanceAction("修复可修复项","先显示修复清单，确认后执行。","预览修复",enabled){action("repair-preview",JSONObject())}
                MaintenanceAction("脱敏诊断报告","查看运行摘要与事件记录，可保存 JSON 或确认发送。","查看报告",enabled){action("report",JSONObject())}
                MaintenanceAction("备份当前配置","保留当前 Codex 配置的恢复入口。","创建备份",enabled){action("backup",JSONObject())}
            }}
            if(state.checks.isNotEmpty())item{DashboardCard{
                Text("诊断结果",fontWeight=FontWeight.SemiBold)
                state.checks.forEach{check->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top){
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){Text(check.title,fontSize=14.sp,fontWeight=FontWeight.Medium);Text(check.detail,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))}
                    Text(when(check.status){"ok"->"正常";"error"->"异常";else->"需留意"},Modifier.padding(start=12.dp),fontSize=12.sp,color=if(check.status=="error")MaterialTheme.colors.error else if(check.status=="ok")MaterialTheme.colors.primary else MaterialTheme.colors.onSurface)
                }}
            }}
            item{DashboardCard{
                Text("后台监听服务",fontWeight=FontWeight.SemiBold)
                Text(if(snapshot?.gatewayRunning==true)"运行中" else "未运行",fontSize=13.sp)
                snapshot?.gatewayOrigin?.takeIf{it.isNotBlank()}?.let{Text(it,fontSize=12.sp)}
                Row(verticalAlignment=Alignment.CenterVertically){Text("随工作台启动",Modifier.weight(1f),fontSize=13.sp);Switch(snapshot?.gatewayAutoStart==true,{action("gateway/autostart",JSONObject().put("enabled",it))},enabled=enabled&&snapshot!=null)}
                OutlinedButton(onClick={action("gateway/start",JSONObject())},enabled=enabled&&snapshot!=null&&!snapshot.gatewayRunning){Text("启动监听")}
            }}
            item{DashboardCard{
                Text("Codex",fontWeight=FontWeight.SemiBold)
                Text(if(snapshot?.backendRunning==true)"运行中 · PID ${snapshot.backendPid}" else "未运行，请先打开电脑上的 Codex",fontSize=13.sp)
                snapshot?.backendStartedAt?.takeIf{it.isNotBlank()}?.let{Text("启动于 ${maintenanceDate(it)}",fontSize=12.sp)}
                Text("桌面端运行时一起重启；纯远程使用时只重启 CLI。",fontSize=12.sp)
                if(snapshot?.catalogReloadPending==true)Text("模型目录已更新，重启后端后加载。",fontSize=12.sp,color=MaterialTheme.colors.primary)
                snapshot?.backendOperation?.let{MaintenanceOperationContent(it)}
                OutlinedButton(onClick={action("backend/restart-preview",JSONObject())},enabled=enabled&&snapshot?.backendRunning==true){Text("重启 Codex")}
            }}
            item{DashboardCard{
                Text("Codex 桌面进程",fontWeight=FontWeight.SemiBold)
                Text("执行前显示具体进程，强制关闭可能中断桌面任务。",fontSize=12.sp)
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    OutlinedButton(onClick={action("process-preview",JSONObject().put("action","stop"))},enabled=enabled){Text("预览强制关闭")}
                }
                snapshot?.processOperation?.let{MaintenanceOperationContent(it)}
            }}
            if(snapshot!=null)item{DashboardCard{
                Text("路由与配置路径",fontWeight=FontWeight.SemiBold)
                Text("当前提供商：${snapshot.provider.ifBlank{"未设置"}}",fontSize=13.sp)
                if(snapshot.model.isNotBlank())Text("默认模型：${snapshot.model}",fontSize=13.sp)
                Text(snapshot.route,fontSize=12.sp)
                Text("服务内存 ${snapshot.memoryMB} MB · 启动于 ${maintenanceDate(snapshot.startedAt)}",fontSize=12.sp)
                SelectionContainer{Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Text("CODEX HOME",fontSize=10.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f));Text(snapshot.home,fontSize=12.sp,fontFamily=FontFamily.Monospace)
                    Text("当前模型目录",fontSize=10.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f));Text(snapshot.catalog.ifBlank{"使用 Codex 默认目录"},fontSize=12.sp,fontFamily=FontFamily.Monospace)
                }}
            }}
            item{DashboardCard{
                Text("清理旧备份",fontWeight=FontWeight.SemiBold)
                Text("保留近期备份；预览后可逐项选择永久删除。",fontSize=12.sp)
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    OutlinedTextField(keep,{if(it.length<=3&&it.all(Char::isDigit))keep=it},label={Text("至少保留份数")},singleLine=true,modifier=Modifier.weight(1f),enabled=enabled)
                    OutlinedTextField(days,{if(it.length<=3&&it.all(Char::isDigit))days=it},label={Text("保留最近天数")},singleLine=true,modifier=Modifier.weight(1f),enabled=enabled)
                }
                OutlinedButton(onClick={action("cleanup-preview",JSONObject().put("keep",keep.toIntOrNull()).put("days",days.toIntOrNull()))},enabled=enabled&&(keep.toIntOrNull()?:0)in 2..100&&(days.toIntOrNull()?:0)in 1..365){Text("预览清理")}
                Text("份数 2–100，天数 1–365。",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
            }}
            item{Text("配置备份",fontWeight=FontWeight.SemiBold)}
            items(snapshot?.backups.orEmpty(),key={it.id}){backup->DashboardCard{
                Text(if(backup.kind=="config")"Codex 配置" else "账号凭据快照",fontSize=14.sp,fontWeight=FontWeight.Medium)
                Text(maintenanceDate(backup.at),fontSize=12.sp)
                Text(backup.id,fontSize=11.sp,fontFamily=FontFamily.Monospace)
                if(backup.kind=="config")TextButton(onClick={action("restore-preview",JSONObject().put("id",backup.id))},enabled=enabled){Text("预览恢复")} else Text("仅可在电脑本地手动恢复",fontSize=12.sp)
            }}
            if(snapshot!=null&&snapshot.backups.isEmpty())item{Text("还没有备份",fontSize=13.sp)}
            item{DashboardCard{
                Text("模型恢复记录",fontWeight=FontWeight.SemiBold)
                if(snapshot?.events.isNullOrEmpty())Text("暂无恢复记录",fontSize=13.sp)
                snapshot?.events?.forEach{event->Text("${maintenanceDate(event.at)} · ${maintenanceEventLabel(event.status)}${if(event.count>0)" · ${event.count} 个模型" else ""}",fontSize=12.sp)}
            }}
        }
    }
}

private data class McpEntry(val id:String,val enabled:Boolean,val type:String,val target:String)
private data class SkillEntry(val name:String,val description:String)
private data class ExtensionsRenderState(val mcp:List<McpEntry>,val skills:List<SkillEntry>,val loaded:Boolean,val busy:Boolean,val error:String,val message:String,val connected:Boolean)

@Composable internal fun NativeExtensionsManagement(vm:NativeViewModel,back:()->Unit){
    val active=LocalManagementPageActive.current
    val requests=rememberManagementRequests(vm,"extensions",active)
    val source=requests.state
    val mcp=remember(source.data){maintenanceObjects(source.data?.optJSONArray("mcp")).map{McpEntry(it.maintenanceText("id"),it.optBoolean("enabled"),it.maintenanceText("type"),it.maintenanceText("target"))}}
    val skills=remember(source.data){maintenanceObjects(source.data?.optJSONArray("skills")).map{SkillEntry(it.maintenanceText("name"),it.maintenanceText("description"))}}
    NativeExtensionsManagementContent(ExtensionsRenderState(mcp,skills,source.data!=null,source.busy,source.error,source.message,vm.state.connected),back,{requests.run{reload("extensions")}}){entry,enabled->
        if(vm.state.connected&&active)requests.run{
            call("extensions/mcp",JSONObject().put("id",entry.id).put("enabled",enabled))
            reload("extensions");message("${entry.id} 已${if(enabled)"启用" else "停用"}，重新加载 Codex 后生效")
        }
    }
}

@Composable private fun NativeExtensionsManagementContent(state:ExtensionsRenderState,back:()->Unit,refresh:()->Unit,toggle:(McpEntry,Boolean)->Unit){
    var query by remember{mutableStateOf("")}
    val enabled=state.connected&&!state.busy
    val skills=state.skills.filter{query.isBlank()||it.name.contains(query,true)||it.description.contains(query,true)}
    NativeManagementPage("扩展","MCP 与 Skills",back,modifier=Modifier.testTag("nativeExtensionsManagement"),actions={ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",refresh,enabled=enabled)}){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),state=rememberNativeManagementListState(),contentPadding=nativeManagementPadding(PaddingValues(16.dp)),verticalArrangement=Arrangement.spacedBy(12.dp)){
            item{ManagementFeedback(state.connected,state.busy,state.error,state.message)}
            item{Text("MCP 服务 · ${state.mcp.size}",fontWeight=FontWeight.SemiBold);Text("开关写入配置并保留备份，通常需要重新加载 Codex。",fontSize=12.sp)}
            items(state.mcp,key={it.id}){entry->DashboardCard{
                Row(verticalAlignment=Alignment.CenterVertically){
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(6.dp)){Text(entry.id,fontWeight=FontWeight.Medium);Text("${entry.type} · ${entry.target}",fontSize=12.sp);Text(if(entry.enabled)"已启用" else "已停用",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))}
                    Switch(entry.enabled,{toggle(entry,it)},enabled=enabled,modifier=Modifier.testTag("mcpToggle:${entry.id}"))
                }
            }}
            if(state.loaded&&state.mcp.isEmpty())item{Text("未发现用户配置的 MCP 服务",fontSize=13.sp)}
            item{Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
                Text("本地 Skills · ${state.skills.size}",fontWeight=FontWeight.SemiBold)
                OutlinedTextField(query,{query=it},label={Text("搜索技能")},singleLine=true,modifier=Modifier.fillMaxWidth())
            }}
            items(skills){skill->DashboardCard{Text(skill.name,fontWeight=FontWeight.Medium);if(skill.description.isNotBlank())Text(skill.description,fontSize=13.sp)}}
            if(state.loaded&&skills.isEmpty())item{Text(if(query.isBlank())"未发现本地技能" else "没有匹配的技能",fontSize=13.sp)}
        }
    }
}

private val maintenanceHarnessNames=linkedMapOf("claude" to "Claude Code","claude-desktop" to "Claude Desktop","gemini" to "Gemini CLI","codex" to "Codex","grokbuild" to "Grok Build","opencode" to "OpenCode","openclaw" to "OpenClaw","hermes" to "Hermes","pi" to "Pi","mcode" to "MCode")
private data class HarnessProfileEntry(val id:String,val name:String,val category:String,val selectedInCCSwitch:Boolean)
private data class HarnessEntry(val id:String,val name:String,val profiles:List<HarnessProfileEntry>,val activeId:String,val managed:Boolean,val external:Boolean,val mode:String="")
private data class HarnessRenderState(val entries:List<HarnessEntry>,val loaded:Boolean,val sourceAvailable:Boolean,val busy:Boolean,val error:String,val message:String,val connected:Boolean)

@Composable internal fun NativeHarnessManagement(vm:NativeViewModel,back:()->Unit){
    var subpage by remember(vm.state.address){mutableStateOf("")}
    val active=LocalManagementPageActive.current&&subpage.isBlank()
    val requests=rememberManagementRequests(vm,"harnesses",active)
    var confirmation by remember(vm.state.address){mutableStateOf<MaintenanceConfirmation?>(null)}
    if(subpage=="claude"){NativeClaudeConfiguration(vm){subpage=""};return}
    if(subpage=="opencode"){NativeOpenCodeConfiguration(vm){subpage=""};return}
    if(subpage=="codex"){NativeRelayConfiguration(vm){subpage=""};return}
    val source=requests.state
    val entries=remember(source.data){maintenanceHarnesses(source.data)}
    NativeHarnessManagementContent(HarnessRenderState(entries,source.data!=null,source.data?.optBoolean("sourceAvailable")==true,source.busy,source.error,source.message,vm.state.connected),back,{requests.run{reload("harnesses")}},onConfigure={subpage=it}){app,profile->
        if(vm.state.connected&&active)requests.run{
            val result=call("harnesses/switch-preview",JSONObject().put("app",app.id).put("id",profile.id))
            if(!result.optBoolean("canSwitch",true))throw IllegalStateException(result.maintenanceText("message").ifBlank{"当前配置不能切换，请先结束运行任务"})
            val plan=result.maintenanceText("planId")
            if(plan.isBlank())throw IllegalStateException("未取得切换预览，请重试")
            val from=result.optJSONObject("from")?.maintenanceText("name").orEmpty()
            confirmation=MaintenanceConfirmation("harness-switch","切换 ${app.name}","${if(from.isNotBlank())"当前配置：$from\n" else ""}目标配置：${profile.name}\n${result.maintenanceText("message").ifBlank{"新建进程使用切换后的配置。"}}",plan,app=app.id,profileId=profile.id)
        }
    }
    confirmation?.let{preview->MaintenanceConfirmationDialog(preview,source.busy,vm.state.connected,onDismiss={confirmation=null}){
        confirmation=null
        requests.run{
            call("harnesses/switch",JSONObject().put("app",preview.app).put("id",preview.profileId).put("planId",preview.planId).put("confirmed",true))
            reload("harnesses");message("${maintenanceHarnessNames[preview.app].orEmpty()} 配置已切换，新建进程使用新配置")
        }
    }}
}

@Composable private fun NativeHarnessManagementContent(state:HarnessRenderState,back:()->Unit,refresh:()->Unit,onConfigure:(String)->Unit,onSwitch:(HarnessEntry,HarnessProfileEntry)->Unit){
    val enabled=state.connected&&!state.busy
    NativeManagementPage("Harness 配置","本机工具",back,modifier=Modifier.testTag("nativeHarnessManagement"),actions={ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",refresh,enabled=enabled)}){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),state=rememberNativeManagementListState(),contentPadding=nativeManagementPadding(PaddingValues(16.dp)),verticalArrangement=Arrangement.spacedBy(12.dp)){
            item{ManagementFeedback(state.connected,state.busy,state.error,state.message)}
            item{Text("按本机实际配置识别当前选择。Claude Code 支持热加载；Gemini CLI 新进程使用新配置；Claude Desktop 切换后需重新打开。",fontSize=12.sp)}
            if(state.loaded&&!state.sourceAvailable)item{Text("未发现 CC Switch 数据库，仍显示工作台保存的配置。",fontSize=12.sp)}
            items(state.entries,key={it.id}){app->DashboardCard(Modifier.testTag("harnessManagement:${app.id}")){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(app.name,Modifier.weight(1f),fontWeight=FontWeight.SemiBold);Text(when{app.mode=="1p"->"官方模式";app.external->"外部配置";app.activeId.isNotBlank()->"已识别当前配置";else->"未识别"},fontSize=11.sp)}
                if(app.id=="codex"){
                    Text("官方账号和中转模型在账号与中转配置中管理。",fontSize=13.sp)
                    TextButton(onClick={onConfigure("codex")},enabled=enabled){Text("Codex 中转与模型")}
                }else{
                    if(app.id=="claude")TextButton(onClick={onConfigure("claude")},enabled=enabled){Text("编辑 Claude 配置")}
                    if(app.id=="opencode")TextButton(onClick={onConfigure("opencode")},enabled=enabled){Text("供应商与模型配置")}
                    if(app.profiles.isEmpty())Text("没有该工具的供应商配置",fontSize=13.sp)
                    app.profiles.forEach{profile->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                            Text(profile.name,fontSize=14.sp,fontWeight=FontWeight.Medium)
                            Text(when(profile.category){"official"->"官方登录";"aggregator"->"中转服务";else->"自定义配置"}+if(profile.selectedInCCSwitch)" · CC Switch 已选" else "",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                        }
                        when{profile.id==app.activeId->Text("当前",Modifier.padding(start=10.dp),fontSize=12.sp,color=MaterialTheme.colors.primary)
                            app.managed->TextButton(onClick={onSwitch(app,profile)},enabled=enabled){Text("预览切换")}
                            else->Text("暂无切换适配",Modifier.padding(start=10.dp),fontSize=11.sp)}
                    }}
                }
            }}
        }
    }
}

@Composable private fun ManagementFeedback(connected:Boolean,busy:Boolean,error:String,message:String){
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        if(!connected)Text("连接电脑后使用管理功能",fontSize=13.sp)
        if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error,fontSize=13.sp,modifier=Modifier.testTag("managementError"))
        if(message.isNotBlank())Text(message,color=MaterialTheme.colors.primary,fontSize=13.sp)
    }
}
@Composable private fun MaintenanceAction(title:String,detail:String,label:String,enabled:Boolean,onClick:()->Unit){
    Column(verticalArrangement=Arrangement.spacedBy(4.dp)){Text(title,fontSize=14.sp,fontWeight=FontWeight.Medium);Text(detail,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f));TextButton(onClick=onClick,enabled=enabled){Text(label)}}
}
@Composable private fun MaintenanceOperationContent(operation:MaintenanceOperation){
    val label=when(operation.state){"scheduled"->"已接收，准备执行";"running"->"正在执行";"done"->"已完成";"error"->"失败";else->operation.state}
    Text("最近操作：$label · ${maintenanceDate(operation.at)}",fontSize=12.sp)
    if(operation.error.isNotBlank())Text(operation.error,fontSize=12.sp,color=MaterialTheme.colors.error)
    else if(operation.state=="done")Text(if(operation.started)"已检测到新进程" else "操作已完成",fontSize=12.sp)
}

@Composable private fun MaintenanceConfirmationDialog(preview:MaintenanceConfirmation,busy:Boolean,connected:Boolean,onDismiss:()->Unit,onConfirm:(Set<Int>)->Unit){
    var acknowledged by remember(preview){mutableStateOf(false)}
    var selected by remember(preview){mutableStateOf(preview.choices.mapNotNull{it.id}.toSet())}
    NativeAlertDialog(onDismissRequest={if(!busy)onDismiss()},title={Text(preview.title)},text={Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text(preview.detail,fontSize=14.sp)
        preview.choices.forEach{choice->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top){
            if(preview.selectable&&choice.id!=null)Checkbox(choice.id in selected,{checked->selected=if(checked)selected+choice.id else selected-choice.id},enabled=!busy)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){Text(choice.title,fontSize=13.sp,fontWeight=FontWeight.Medium);if(choice.detail.isNotBlank())Text(choice.detail,fontSize=12.sp)}
        }}
        if(preview.report.isNotBlank())SelectionContainer{Text(preview.report,fontSize=11.sp,fontFamily=FontFamily.Monospace)}
        if(preview.acknowledge)Row(verticalAlignment=Alignment.CenterVertically){Checkbox(acknowledged,{acknowledged=it},enabled=!busy);Text(when(preview.action){"cleanup"->"确认永久删除选中的备份，此操作不可撤销";"process-apply"->"确认执行，并接受任务可能中断";"send"->"确认接收地址和上述诊断信息类型";else->"确认使用此备份覆盖当前配置"},fontSize=13.sp)}
    }},confirmButton={TextButton(onClick={onConfirm(selected)},enabled=connected&&!busy&&preview.planId.isNotBlank()&&(!preview.acknowledge||acknowledged)&&(!preview.selectable||selected.isNotEmpty())){Text(if(preview.action=="cleanup")"永久删除" else "确认执行")}},dismissButton={TextButton(onClick=onDismiss,enabled=!busy){Text("取消")}})
}

@Composable private fun MaintenanceReportDialog(report:String,busy:Boolean,error:String,onDismiss:()->Unit,onSave:()->Unit,onSendPreview:(String)->Unit){
    var destination by remember(report){mutableStateOf("")}
    NativeAlertDialog(onDismissRequest={if(!busy)onDismiss()},title={Text("脱敏诊断报告")},text={Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
        SelectionContainer{Text(report,fontSize=11.sp,fontFamily=FontFamily.Monospace)}
        OutlinedTextField(destination,{destination=it},label={Text("HTTPS 接收地址")},placeholder={Text("https://你的接收服务/diagnostics")},enabled=!busy,singleLine=true,modifier=Modifier.fillMaxWidth())
        Text("发送前会再次展示接收地址与脱敏内容。",fontSize=12.sp)
        if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error,fontSize=12.sp)
        if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        TextButton(onClick={onSendPreview(destination.trim())},enabled=!busy&&destination.isNotBlank()){Text("预览发送")}
    }},confirmButton={TextButton(onClick=onSave,enabled=!busy){Text("保存 JSON")}},dismissButton={TextButton(onClick=onDismiss,enabled=!busy){Text("关闭")}})
}

private fun maintenanceObjects(value:JSONArray?):List<JSONObject> = (0 until (value?.length()?:0)).mapNotNull{value?.optJSONObject(it)}
private fun JSONObject.maintenanceText(key:String)=optString(key).takeUnless{it=="null"}.orEmpty()
private fun maintenanceDate(value:String):String=try{DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm",Locale.getDefault()).withZone(ZoneId.systemDefault()).format(Instant.parse(value))}catch(_:Exception){value.ifBlank{"暂无时间"}}
private fun maintenanceBytes(value:Long):String=when{value>=1048576->String.format(Locale.ROOT,"%.2f MB",value/1048576.0);value>=1024->String.format(Locale.ROOT,"%.1f KB",value/1024.0);else->"$value B"}
private fun maintenanceEventLabel(value:String)=when(value){"restored"->"已恢复缺失的官方模型";"watcher-started"->"模型守护已启动";"deferred"->"暂缓处理，等待有效配置";else->value}
private fun maintenanceOperation(value:JSONObject?):MaintenanceOperation?=value?.let{MaintenanceOperation(it.maintenanceText("action"),it.maintenanceText("state"),it.maintenanceText("completedAt").ifBlank{it.maintenanceText("at")},it.optBoolean("started"),it.maintenanceText("error"))}
private fun maintenanceSnapshot(value:JSONObject):MaintenanceSnapshot{
    val config=value.optJSONObject("config")?:JSONObject()
    val gateway=value.optJSONObject("gateway")?:JSONObject()
    val backend=value.optJSONObject("sharedBackend")?:JSONObject()
    val route=when{config.optBoolean("owned")->if(config.optBoolean("relayOnly"))"Codex → 本地中转路由 → 指定中转；官方模型不可用。" else "Codex → 本地路由 → 官方或指定中转。";config.optBoolean("officialHttp")->"Codex → OpenAI（HTTPS 流式响应）。";config.optBoolean("officialLocal")->"Codex → 本地转发 → OpenAI。";config.optBoolean("officialEndpointOverride")->"Codex → 配置的自定义端点。";else->"Codex → OpenAI；工作台维护模型目录。"}
    return MaintenanceSnapshot(value.maintenanceText("home"),config.maintenanceText("catalog"),config.maintenanceText("provider"),config.maintenanceText("model"),route,value.optInt("port"),value.optInt("memoryMB"),value.maintenanceText("startedAt"),gateway.optBoolean("running"),gateway.optBoolean("autoStart"),gateway.maintenanceText("origin"),backend.optBoolean("running"),backend.optInt("backendPid"),backend.maintenanceText("startedAt"),backend.optBoolean("catalogReloadPending"),maintenanceOperation(backend.optJSONObject("operation")),maintenanceOperation(value.optJSONObject("processOperation")),maintenanceObjects(value.optJSONArray("backups")).map{MaintenanceBackup(it.maintenanceText("id"),it.maintenanceText("kind"),it.maintenanceText("at"))},maintenanceObjects(value.optJSONArray("events")).map{MaintenanceEvent(it.maintenanceText("at"),it.maintenanceText("status"),it.optInt("count"))})
}
private fun maintenanceHarnesses(value:JSONObject?):List<HarnessEntry>{
    val apps=value?.optJSONObject("apps")
    val desktop=value?.optJSONObject("desktop")
    return maintenanceHarnessNames.map{(id,name)->
        val app=apps?.optJSONObject(id)?:JSONObject()
        val profiles=maintenanceObjects(app.optJSONArray("profiles")).map{HarnessProfileEntry(it.maintenanceText("id"),it.maintenanceText("name"),it.maintenanceText("category"),it.optBoolean("selectedInCCSwitch"))}
        val mode=if(id=="claude-desktop")desktop?.maintenanceText("mode").orEmpty() else ""
        val active=if(id=="claude-desktop")when{mode=="1p"->profiles.firstOrNull{it.category=="official"}?.id.orEmpty();desktop?.optBoolean("profileApplied")==true->desktop.maintenanceText("providerId");else->""} else app.maintenanceText("activeId")
        HarnessEntry(id,name,profiles,active,app.optBoolean("managed"),if(id=="claude-desktop")mode!="1p"&&desktop?.optBoolean("profileApplied")!=true else app.optBoolean("external"),mode)
    }
}
