package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal data class ManagedSessionFilters(
    val archived:Boolean=false,val source:String="interactive",val search:String="",val cwd:String="",
    val olderThanDays:Int=0,val minBytes:Long=0,val onlyIdle:Boolean=false
)
internal data class ManagedSession(
    val id:String,val title:String,val cwd:String,val updatedAt:Long?,val status:String,val activity:String,
    val isSubagent:Boolean,val agentRole:String,val logBytes:Long?,val selected:Boolean=false,
    val canDelete:Boolean=false,val reason:String=""
){val selectable:Boolean get()=status !in listOf("inProgress","unknown")&&activity!="inProgress"}
internal data class ManagedSessionConfirmation(
    val action:String,val ids:List<String>,val source:String,val threads:List<ManagedSession>,val affected:List<ManagedSession> = emptyList(),
    val planId:String="",val logBytes:Long?=null,val unknownSizes:Int=0
){val deletable:Boolean get()=action!="delete"||(planId.isNotBlank()&&threads.isNotEmpty()&&threads.all{it.canDelete})}
internal data class SessionManagementState(
    val filters:ManagedSessionFilters=ManagedSessionFilters(),val applied:ManagedSessionFilters=ManagedSessionFilters(),
    val threads:List<ManagedSession> = emptyList(),val projects:List<String> = emptyList(),val selected:Set<String> = emptySet(),
    val loading:Boolean=false,val busy:Boolean=false,val loaded:Boolean=false,val error:String="",val message:String="",
    val cursor:String?=null,val nextCursor:String?=null,val page:Int=1,val pageLogBytes:Long?=null,val unknownSizes:Int=0,
    val confirmation:ManagedSessionConfirmation?=null
)

private fun JSONObject.sessionText(key:String)=if(isNull(key))"" else optString(key)
private fun JSONObject.sessionRows(key:String):List<JSONObject>{val array=optJSONArray(key)?:return emptyList();return (0 until array.length()).mapNotNull{array.optJSONObject(it)}}
private fun JSONObject.sessionLong(key:String):Long?=if(!has(key)||isNull(key))null else optLong(key)
private fun managedSession(row:JSONObject)=ManagedSession(row.sessionText("id"),row.sessionText("title"),row.sessionText("cwd"),row.sessionLong("updatedAt"),
    row.sessionText("status"),row.sessionText("activity"),row.optBoolean("isSubagent"),row.sessionText("agentRole"),row.sessionLong("logBytes"),
    row.optBoolean("selected"),row.optBoolean("canDelete"),row.sessionText("reason"))

private class SessionManagementController(
    private val scope:CoroutineScope,private val request:suspend(String,JSONObject?)->JSONObject
){
    var state by mutableStateOf(SessionManagementState());private set
    private var job:Job?=null
    private var ticket=0
    fun cancel(){ticket++;job?.cancel();job=null;state=state.copy(loading=false,busy=false)}
    fun filters(value:ManagedSessionFilters,reload:Boolean){state=state.copy(filters=value);if(reload)load()}
    fun load(cursor:String?=null,page:Int=1,useApplied:Boolean=false){
        job?.cancel();val token=++ticket;val query=if(useApplied)state.applied else state.filters
        state=state.copy(loading=true,busy=false,error="",selected=emptySet(),confirmation=null)
        job=scope.launch{
            try{
                val params=linkedMapOf("archived" to query.archived.toString(),"source" to query.source,"search" to query.search,
                    "cwd" to query.cwd,"olderThanDays" to query.olderThanDays.toString(),"minBytes" to query.minBytes.toString(),"onlyIdle" to query.onlyIdle.toString())
                if(cursor!=null)params["cursor"]=cursor
                val route="/api/mobile-management/sessions?"+params.entries.joinToString("&"){URLEncoder.encode(it.key,"UTF-8")+"="+URLEncoder.encode(it.value,"UTF-8")}
                val result=request(route,null);if(token!=ticket)return@launch
                val paths=result.optJSONArray("projects")
                state=state.copy(applied=query,threads=result.sessionRows("threads").map(::managedSession),projects=(0 until (paths?.length()?:0)).map{paths!!.optString(it)}.filter{it.isNotBlank()},
                    loading=false,loaded=true,cursor=cursor,nextCursor=result.sessionText("nextCursor").ifBlank{null},page=page,
                    pageLogBytes=result.sessionLong("pageLogBytes"),unknownSizes=result.optInt("unknownSizes"))
            }catch(error:CancellationException){throw error}catch(error:Exception){if(token==ticket)state=state.copy(loading=false,error=error.message?:"读取会话失败")}
        }
    }
    fun select(id:String,checked:Boolean){
        if(state.loading||state.busy)return
        if(checked&&state.selected.size>=30){state=state.copy(error="每批最多选择 30 个会话");return}
        state=state.copy(selected=if(checked)state.selected+id else state.selected-id,error="")
    }
    fun selectPage(){val eligible=state.threads.filter{it.selectable}.map{it.id}.take(30).toSet();state=state.copy(selected=if(eligible.isNotEmpty()&&state.selected.containsAll(eligible))emptySet() else eligible,error="")}
    fun dismiss(){if(!state.busy)state=state.copy(confirmation=null)}
    fun preview(action:String,ids:List<String> = state.selected.toList()){
        if(state.loading||state.busy)return
        if(ids.isEmpty()){state=state.copy(error="请先选择会话");return}
        if(ids.size>30){state=state.copy(error="每批最多选择 30 个会话");return}
        val source=state.applied.source
        if(action!="delete"){
            state=state.copy(confirmation=ManagedSessionConfirmation(action,ids,source,state.threads.filter{it.id in ids}),error="",message="");return
        }
        state=state.copy(busy=true,error="",message="");val token=++ticket
        job=scope.launch{
            try{
                val result=request("/api/mobile-management/sessions/delete-preview",JSONObject().put("ids",JSONArray(ids)).put("source",source))
                if(token==ticket)state=state.copy(busy=false,confirmation=ManagedSessionConfirmation(action,ids,source,result.sessionRows("threads").map(::managedSession),
                    result.sessionRows("affected").map(::managedSession),result.sessionText("planId"),result.sessionLong("logBytes"),result.optInt("unknownSizes")))
            }catch(error:CancellationException){throw error}catch(error:Exception){if(token==ticket)state=state.copy(busy=false,error=error.message?:"无法预览删除范围")}
        }
    }
    fun confirm(){
        val confirmation=state.confirmation?:return;if(state.busy||!confirmation.deletable)return
        state=state.copy(busy=true,error="");val token=++ticket
        job=scope.launch{
            try{
                val body=JSONObject().put("ids",JSONArray(confirmation.ids)).put("source",confirmation.source).put("action",confirmation.action)
                if(confirmation.action=="delete")body.put("planId",confirmation.planId)
                val result=request("/api/mobile-management/sessions/change",body);if(token!=ticket)return@launch
                val failed=result.sessionRows("results").filter{!it.optBoolean("ok")}
                val count=if(confirmation.action=="delete")result.sessionLong("affectedCount")?:result.optLong("completed") else result.optLong("completed")
                val verb=when(confirmation.action){"delete"->"删除";"archive"->"归档";else->"恢复"}
                state=state.copy(busy=false,confirmation=null,message="已$verb $count 个会话"+(if(failed.isNotEmpty())"；${failed.size} 个未完成：${failed.first().sessionText("error")}" else ""))
                load(state.cursor,state.page,useApplied=true)
            }catch(error:CancellationException){throw error}catch(error:Exception){if(token==ticket)state=state.copy(busy=false,error=error.message?:"会话操作未完成")}
        }
    }
}

@Composable internal fun NativeSessionManagement(vm:NativeViewModel,back:()->Unit){
    val scope=rememberCoroutineScope()
    val address=vm.state.address
    val controller=remember(vm,address){SessionManagementController(scope){route,body->vm.managementRequest(route,body)}}
    val active=LocalManagementPageActive.current
    val connected=vm.state.connected
    LaunchedEffect(controller,connected,active){if(connected&&active)controller.load() else controller.cancel()}
    DisposableEffect(controller){onDispose{controller.cancel()}}
    NativeSessionManagementContent(controller.state,connected,vm.state.projects.map{it.path},back,
        {controller.load(controller.state.cursor,controller.state.page,useApplied=true)},controller::filters,controller::select,controller::selectPage,
        {action,ids->controller.preview(action,ids)},controller::dismiss,controller::confirm,
        {controller.load()}, {controller.load(controller.state.nextCursor,controller.state.page+1,useApplied=true)})
}

@Composable internal fun NativeSessionManagementContent(
    state:SessionManagementState,connected:Boolean,knownProjects:List<String>,back:()->Unit,refresh:()->Unit,
    filters:(ManagedSessionFilters,Boolean)->Unit,select:(String,Boolean)->Unit,selectPage:()->Unit,
    preview:(String,List<String>)->Unit,dismiss:()->Unit,confirm:()->Unit,first:()->Unit,next:()->Unit
){
    val enabled=connected&&!state.loading&&!state.busy
    val archived=state.applied.archived
    NativeManagementPage("会话管理","",back,modifier=Modifier.testTag("sessionManagement"),actions={
        ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",refresh,enabled=enabled)
    }){
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("sessionManagementList"),state=rememberNativeManagementListState(),contentPadding=nativeManagementPadding(PaddingValues(16.dp)),verticalArrangement=Arrangement.spacedBy(12.dp)){
            item{
                DashboardCard{
                    DashboardTabs(listOf("current" to "当前会话","archived" to "已归档"),if(state.filters.archived)"archived" else "current",{filters(state.filters.copy(archived=it=="archived"),true)},enabled=enabled)
                    DashboardTabs(listOf("interactive" to "主会话","subagent" to "子代理会话"),state.filters.source,{filters(state.filters.copy(source=it),true)},enabled=enabled)
                    OutlinedTextField(state.filters.search,{filters(state.filters.copy(search=it.take(200)),false)},label={Text("搜索会话")},enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth().testTag("sessionSearch"))
                    OutlinedTextField(state.filters.cwd,{filters(state.filters.copy(cwd=it.take(2000)),false)},label={Text("项目目录（留空为全部）")},enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth())
                    val directories=(knownProjects+state.projects).distinct().filter{it.isNotBlank()}
                    if(directories.isNotEmpty())SessionChoice("选择目录",state.filters.cwd,listOf("" to "全部项目")+directories.map{it to it},enabled){filters(state.filters.copy(cwd=it),false)}
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Box(Modifier.weight(1f)){SessionChoice("未更新时间",state.filters.olderThanDays.toString(),listOf("0" to "不限","7" to "超过 7 天","30" to "超过 30 天","90" to "超过 90 天"),enabled){filters(state.filters.copy(olderThanDays=it.toInt()),false)}}
                        Box(Modifier.weight(1f)){SessionChoice("日志大小",state.filters.minBytes.toString(),listOf("0" to "不限","1048576" to "至少 1 MB","10485760" to "至少 10 MB","52428800" to "至少 50 MB"),enabled){filters(state.filters.copy(minBytes=it.toLong()),false)}}
                    }
                    Row(verticalAlignment=Alignment.CenterVertically){Checkbox(state.filters.onlyIdle,{filters(state.filters.copy(onlyIdle=it),false)},enabled=enabled);Text("仅已结束",fontSize=14.sp)}
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Button(onClick={filters(state.filters,true)},enabled=enabled){Text("应用筛选")}
                        TextButton(onClick={filters(ManagedSessionFilters(archived=state.filters.archived,source=state.filters.source),true)},enabled=enabled){Text("重置筛选")}
                    }
                }
            }
            item{
                Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                    if(!connected)Text("连接电脑后管理会话")
                    if(state.loading||state.busy){LinearProgressIndicator(Modifier.fillMaxWidth());Text(if(state.busy)"正在处理会话…" else "正在读取会话…",fontSize=13.sp)}
                    if(state.error.isNotBlank())Text(state.error,color=MaterialTheme.colors.error,modifier=Modifier.testTag("sessionManagementError"))
                    if(state.message.isNotBlank())Text(state.message,fontSize=13.sp,modifier=Modifier.testTag("sessionManagementResult"))
                }
            }
            if(state.threads.isNotEmpty())item{
                DashboardCard{
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        Text("已选 ${state.selected.size} / 30",Modifier.weight(1f),fontWeight=FontWeight.Medium)
                        TextButton(onClick=selectPage,enabled=enabled){Text(if(state.selected.isEmpty())"选择本页" else "选择／取消本页")}
                    }
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Button(onClick={preview(if(archived)"restore" else "archive",state.selected.toList())},enabled=enabled&&state.selected.isNotEmpty()){Text(if(archived)"恢复所选" else "归档所选")}
                        if(archived)OutlinedButton(onClick={preview("delete",state.selected.toList())},enabled=enabled&&state.selected.isNotEmpty()){Text("删除所选",color=MaterialTheme.colors.error)}
                    }
                }
            }
            items(state.threads,key={it.id}){thread->
                DashboardCard(Modifier.testTag("managedSession:${thread.id}")){
                    Row(verticalAlignment=Alignment.CenterVertically){
                        Checkbox(thread.id in state.selected,{select(thread.id,it)},enabled=enabled&&thread.selectable)
                        Column(Modifier.weight(1f)){
                            Text(nativeDisplayThreadTitle(thread.title,thread.id),fontSize=15.sp,fontWeight=FontWeight.Medium)
                            if(thread.isSubagent)Text(thread.agentRole.ifBlank{"子代理"},fontSize=12.sp,color=MaterialTheme.colors.primary)
                        }
                    }
                    if(thread.cwd.isNotBlank())Text(nativeDisplayPath(thread.cwd),fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                    Text("${sessionDate(thread.updatedAt)} · ${sessionSize(thread.logBytes)}",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                    Text(when{thread.activity=="inProgress"||thread.status=="inProgress"->"运行中";thread.activity=="unknown"||thread.status=="unknown"->if(archived)"已归档 · 状态待确认" else "状态待确认";archived->"已归档";else->"已结束"},fontSize=12.sp)
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        TextButton(onClick={preview(if(archived)"restore" else "archive",listOf(thread.id))},enabled=enabled&&thread.selectable){Text(if(archived)"恢复" else "归档")}
                        if(archived)TextButton(onClick={preview("delete",listOf(thread.id))},enabled=enabled&&thread.selectable){Text("预览删除",color=MaterialTheme.colors.error)}
                    }
                }
            }
            if(state.loaded&&state.threads.isEmpty()&&!state.loading)item{Text("没有匹配的会话",Modifier.padding(16.dp),fontSize=14.sp)}
            item{
                Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Text("第 ${state.page} 页 · 本页 ${state.threads.size} 条 · 日志 ${sessionSize(state.pageLogBytes)}"+(if(state.unknownSizes>0)" · ${state.unknownSizes} 条大小未知" else ""),fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        OutlinedButton(onClick=first,enabled=enabled&&state.page>1){Text("首页")}
                        OutlinedButton(onClick=next,enabled=enabled&&state.nextCursor!=null){Text("下一页")}
                    }
                }
            }
        }
    }
    state.confirmation?.let{value->ManagedSessionConfirmationDialog(value,state.busy,state.error,dismiss,confirm)}
}

@Composable private fun ManagedSessionConfirmationDialog(value:ManagedSessionConfirmation,busy:Boolean,error:String,dismiss:()->Unit,confirm:()->Unit){
    var acknowledged by remember(value){mutableStateOf(false)}
    val delete=value.action=="delete"
    val verb=when(value.action){"delete"->"永久删除";"archive"->"归档";else->"恢复"}
    NativeAlertDialog(onDismissRequest={if(!busy)dismiss()},title={Text("${verb}会话")},text={
        Column(Modifier.heightIn(max=460.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
            if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error,fontSize=13.sp)
            if(delete){
                Text("选中 ${value.ids.size} 个已归档会话，将连同后代共删除 ${value.affected.size} 个会话，无法恢复。")
                Text("已知日志合计 ${sessionSize(value.logBytes)}"+(if(value.unknownSizes>0)"；另有 ${value.unknownSizes} 个大小未知" else "")+"。不含共享数据库及项目文件。",fontSize=13.sp)
                value.threads.filter{!it.canDelete}.forEach{Text(it.reason.ifBlank{"${it.title.ifBlank{it.id}}：不符合删除条件"},fontSize=13.sp,color=MaterialTheme.colors.error)}
                if(value.planId.isBlank()&&value.threads.all{it.canDelete})Text("删除预览已失效，请重新预览。",color=MaterialTheme.colors.error,fontSize=13.sp)
                LazyColumn(Modifier.fillMaxWidth().heightIn(max=240.dp)){
                    items(value.affected,key={it.id}){thread->Column(Modifier.padding(vertical=3.dp)){
                        Text(nativeDisplayThreadTitle(thread.title,thread.id),fontSize=13.sp,fontWeight=FontWeight.Medium)
                        Text("${thread.id} · ${if(thread.selected)"已选择" else "关联子会话"} · ${sessionSize(thread.logBytes)}",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                    }}
                }
                Row(verticalAlignment=Alignment.CenterVertically){Checkbox(acknowledged,{acknowledged=it},enabled=!busy&&value.deletable);Text("我确认永久删除清单中的全部会话和子会话",fontSize=13.sp)}
            }else{
                Text("将${verb}选中的 ${value.ids.size} 个会话。")
                if(value.action=="archive")Text("原生归档可能同时归档其子会话，记录可从已归档列表恢复。",fontSize=13.sp)
                value.threads.forEach{Text(nativeDisplayThreadTitle(it.title,it.id),fontSize=13.sp)}
            }
        }
    },confirmButton={TextButton(onClick=confirm,enabled=!busy&&value.deletable&&(!delete||acknowledged),modifier=Modifier.testTag("confirmSessionChange")){Text(if(busy)"处理中…" else verb,color=if(delete)MaterialTheme.colors.error else MaterialTheme.colors.primary)}},
        dismissButton={TextButton(onClick=dismiss,enabled=!busy){Text("取消")}})
}

@Composable private fun SessionChoice(label:String,value:String,choices:List<Pair<String,String>>,enabled:Boolean,onSelect:(String)->Unit){
    var open by remember{mutableStateOf(false)}
    Column(verticalArrangement=Arrangement.spacedBy(3.dp)){
        Text(label,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
        Box{
            OutlinedButton(onClick={open=true},enabled=enabled,modifier=Modifier.fillMaxWidth()){Text(choices.firstOrNull{it.first==value}?.second?:value,maxLines=2)}
            NativeDropdownMenu(open,{open=false}){choices.forEach{choice->DropdownMenuItem(onClick={onSelect(choice.first);open=false}){Text(choice.second,fontSize=13.sp)}}}
        }
    }
}

private fun sessionSize(bytes:Long?):String=when{bytes==null->"未知";bytes<1024->"$bytes B";bytes<1024*1024->String.format(Locale.ROOT,"%.1f KB",bytes/1024.0);bytes<1024L*1024*1024->String.format(Locale.ROOT,"%.1f MB",bytes/1048576.0);else->String.format(Locale.ROOT,"%.2f GB",bytes/1073741824.0)}
private fun sessionDate(seconds:Long?):String=seconds?.let{runCatching{DateTimeFormatter.ofPattern("MM-dd HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochSecond(it))}.getOrNull()}?:"时间未知"
