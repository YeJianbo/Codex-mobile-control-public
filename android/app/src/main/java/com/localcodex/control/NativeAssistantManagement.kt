package com.localcodex.control

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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import org.json.JSONObject
import java.util.UUID

private const val assistantRoute="/api/mobile-management/assistant"
private data class AssistantModel(val executor:String,val harness:String,val id:String,val name:String,val available:Boolean,val reason:String,val efforts:List<Pair<String,String>>,val defaultEffort:String){
    val key:String get()="$executor\n$harness\n$id"
    val group:String get()="$executor\n$harness"
}
private data class AssistantUiState(
    val catalog:List<AssistantModel> = emptyList(),val catalogError:String="",val catalogLoading:Boolean=false,val backendMessages:List<String> = emptyList(),
    val selectedModel:String="",val effort:String="",val projects:List<Pair<String,String>> = emptyList(),
    val projectPath:String="",val prompt:String="",val followup:String="",val tasks:List<JSONObject> = emptyList(),
    val selectedId:String="",val detail:JSONObject?=null,val loading:Boolean=false,val busy:String="",val error:String="",val message:String="",
)

/** Owns request identity and server data; the content composable only renders state and intents. */
private class AssistantStateHolder(private val scope:CoroutineScope,private val request:suspend(String,JSONObject?)->JSONObject){
    var state by mutableStateOf(AssistantUiState());private set
    private val refreshMutex=Mutex()
    private var revision=0L
    private var detailJob:Job?=null
    private var mutationJob:Job?=null
    private var catalogJob:Job?=null
    private var initialRequest:Pair<String,String>?=null
    private var followupRequest:Pair<String,String>?=null
    fun close(){detailJob?.cancel();mutationJob?.cancel();catalogJob?.cancel()}
    fun editPrompt(value:String){state=state.copy(prompt=value)}
    fun editProject(value:String){state=state.copy(projectPath=value)}
    fun editFollowup(value:String){state=state.copy(followup=value)}
    fun chooseModel(key:String){val model=state.catalog.find{it.key==key}?:return;if(!model.available)return;state=state.copy(selectedModel=key,effort=model.defaultEffort.takeIf{effort->model.efforts.any{it.first==effort}}?:model.efforts.firstOrNull()?.first.orEmpty())}
    fun chooseEffort(value:String){val model=state.catalog.find{it.key==state.selectedModel}?:return;if(model.efforts.any{it.first==value})state=state.copy(effort=value)}
    fun select(id:String){
        if(state.busy.isNotBlank())return
        revision++;detailJob?.cancel();state=state.copy(selectedId=id,detail=null,followup="",error="",message="",loading=false)
        if(id.isNotBlank())detailJob=scope.launch{
            state=state.copy(loading=true)
            try{val value=request("$assistantRoute/tasks/$id",null);if(state.selectedId==id)state=state.copy(detail=value,loading=false)}
            catch(e:CancellationException){throw e}catch(e:Exception){if(state.selectedId==id)state=state.copy(loading=false,error=assistantError(e))}
        }
    }
    fun loadCatalog(){
        if(state.catalogLoading)return
        catalogJob=scope.launch{
            state=state.copy(catalogLoading=true,catalogError="")
            try{
                val raw=request("$assistantRoute/catalog",null)
                val models=relayObjects(raw.optJSONArray("models")).map{model->AssistantModel(model.accountText("executor"),model.accountText("harness").ifBlank{model.accountText("executor")},model.accountText("model"),model.accountText("displayName").ifBlank{model.accountText("model")},model.optBoolean("available",true),model.accountText("unavailableReason"),relayObjects(model.optJSONArray("supportedReasoningEfforts")).map{it.accountText("reasoningEffort") to it.accountText("description")},model.accountText("defaultReasoningEffort"))}
                val preferred=raw.optJSONObject("defaultModel")
                val selected=models.find{it.key==state.selectedModel&&it.available}
                    ?:models.find{it.available&&it.executor==preferred?.accountText("executor")&&it.id==preferred?.accountText("model")}
                    ?:models.find{it.available&&it.id=="gpt-6.1-sol"}?:models.find{it.available&&it.id.contains("sol",true)}?:models.firstOrNull{it.available}
                val levels=selected?.efforts.orEmpty()
                val effort=state.effort.takeIf{selected!=null&&selected.key==state.selectedModel&&levels.any{entry->entry.first==it}}
                    ?:selected?.defaultEffort?.takeIf{level->levels.any{it.first==level}}?:levels.firstOrNull()?.first.orEmpty()
                val errors=relayObjects(raw.optJSONArray("errors")).joinToString("；"){it.accountText("message")}
                val backendMessages=relayObjects(raw.optJSONArray("backends")).filter{!it.optBoolean("available")}.map{"${it.accountText("name").ifBlank{it.accountText("agent")}}：${it.accountText("reason").ifBlank{"当前不可用"}}"}
                state=state.copy(catalog=models,catalogLoading=false,selectedModel=selected?.key.orEmpty(),effort=effort,catalogError=if(models.none{it.available})errors.ifBlank{"没有可用执行器，请检查电脑上的连接与登录状态。"} else errors,backendMessages=backendMessages)
            }catch(e:CancellationException){throw e}catch(e:Exception){state=state.copy(catalogLoading=false,catalogError=assistantError(e),selectedModel="")}
        }
    }
    suspend fun loadProjects(){
        try{val raw=request("$assistantRoute/projects",null);state=state.copy(projects=relayObjects(raw.optJSONArray("projects")).mapNotNull{project->val path=project.accountText("path").ifBlank{project.accountText("cwd")};path.takeIf{it.isNotBlank()}?.let{it to project.accountText("name").ifBlank{it}}})}
        catch(e:CancellationException){throw e}catch(e:Exception){state=state.copy(error=assistantError(e))}
    }
    suspend fun refreshTasks(){
        if(state.busy.isNotBlank()||!refreshMutex.tryLock())return
        val ticket=revision;val id=state.selectedId
        try{
            val raw=request("$assistantRoute/tasks",null)
            if(ticket==revision)state=state.copy(tasks=relayObjects(raw.optJSONArray("tasks")))
            if(id.isNotBlank()&&state.selectedId==id){val detail=request("$assistantRoute/tasks/$id",null);if(ticket==revision&&state.selectedId==id)state=state.copy(detail=detail)}
        }catch(e:CancellationException){throw e}catch(e:Exception){if(ticket==revision)state=state.copy(error=assistantError(e))}
        finally{refreshMutex.unlock()}
    }
    fun refresh(){state=state.copy(error="");scope.launch{refreshTasks()}}
    private fun requestId(previous:Pair<String,String>?,payload:String):Pair<String,String> = if(previous!=null&&previous.first==payload)previous else payload to UUID.randomUUID().toString()
    fun create(){
        val model=state.catalog.find{it.key==state.selectedModel&&it.available}?:return
        val prompt=state.prompt.trim();val project=state.projectPath.trim()
        if(prompt.isBlank()||project.isBlank()){state=state.copy(error="请填写任务和工作目录");return}
        val body=JSONObject().put("text",prompt).put("projectPath",project).put("executor",model.executor).put("model",model.id).put("effort",state.effort)
        initialRequest=requestId(initialRequest,body.toString());body.put("requestId",initialRequest!!.second)
        mutate("create",body)
    }
    fun continueTask(){
        val text=state.followup.trim();if(text.isBlank()){state=state.copy(error="请填写补充要求");return}
        followupRequest=requestId(followupRequest,state.selectedId+"\n"+text)
        mutate("continue",JSONObject().put("text",text).put("requestId",followupRequest!!.second))
    }
    fun stop(){mutate("stop",JSONObject())}
    fun approve(body:JSONObject){mutate("approve",body)}
    private fun mutate(action:String,body:JSONObject){
        if(state.busy.isNotBlank())return
        val id=state.selectedId;if(action!="create"&&id.isBlank())return
        revision++;detailJob?.cancel();state=state.copy(busy=action,error="",message="",loading=false)
        mutationJob=scope.launch{
            try{
                val raw=request(if(action=="create")"$assistantRoute/tasks" else "$assistantRoute/tasks/$id/$action",body)
                if(action=="create"||action=="continue"){
                    val task=raw.optJSONObject("task")?:throw IllegalStateException("任务回执不完整，请刷新任务列表确认提交状态")
                    val nextId=task.accountText("id").ifBlank{id}
                    val uncertain=raw.optBoolean("receiptMissing")||task.accountText("state")=="uncertain"
                    state=state.copy(selectedId=nextId,detail=raw,message=task.accountText("error").ifBlank{if(uncertain)"提交待确认，可用相同内容重试查询回执。" else "已提交，请查看执行回执。"},followup=if(action=="continue"&&!uncertain)"" else state.followup)
                }else{
                    val latest=request("$assistantRoute/tasks/$id",null)
                    val code=assistantStatusCode(latest)
                    state=state.copy(detail=latest,message=if(action=="stop")when{
                        code=="command_unknown"||relayObjects(latest.optJSONObject("history")?.optJSONArray("unconfirmedCommands")).isNotEmpty()->"旧命令可能仍在运行，无法确认已停止。请核实进程与实际结果。"
                        raw.optBoolean("ok")&&code in listOf("idle","completed","interrupted","error","paused")->"执行器已确认任务结束。"
                        else->raw.accountText("message").ifBlank{"停止请求已提交，等待执行器确认。"}
                    }else raw.accountText("message").ifBlank{"已提交审批结果。"})
                }
                state=state.copy(busy="")
                refreshTasks()
            }catch(e:CancellationException){throw e}catch(e:Exception){state=state.copy(busy="",error=assistantError(e)+(if(action=="create"||action=="continue")"；请刷新任务或使用相同内容重试查询提交状态。" else ""))}
        }
    }
}

@Composable internal fun NativeAssistantManagement(vm:NativeViewModel,back:()->Unit){
    val scope=rememberCoroutineScope()
    val address=vm.state.address
    val holder=remember(vm,address){AssistantStateHolder(scope){route,body->vm.managementRequest(route,body)}}
    val connected=vm.state.connected
    val active=LocalManagementPageActive.current
    val owner=LocalLifecycleOwner.current
    var foreground by remember(owner){mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))}
    DisposableEffect(owner){val observer=LifecycleEventObserver{_,_->foreground=owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)};owner.lifecycle.addObserver(observer);onDispose{owner.lifecycle.removeObserver(observer)}}
    DisposableEffect(holder){onDispose{holder.close()}}
    LaunchedEffect(holder,connected,active,foreground){
        if(connected&&active&&foreground){holder.loadCatalog();holder.loadProjects();while(true){holder.refreshTasks();delay(5000)}}
    }
    NativeAssistantManagementContent(holder.state,connected,back,holder::select,holder::loadCatalog,holder::refresh,holder::editPrompt,holder::editProject,holder::chooseModel,holder::chooseEffort,holder::create,holder::editFollowup,holder::continueTask,holder::stop,holder::approve)
}

@Composable private fun NativeAssistantManagementContent(
    state:AssistantUiState,connected:Boolean,back:()->Unit,select:(String)->Unit,refreshCatalog:()->Unit,refreshTasks:()->Unit,
    editPrompt:(String)->Unit,editProject:(String)->Unit,chooseModel:(String)->Unit,chooseEffort:(String)->Unit,create:()->Unit,
    editFollowup:(String)->Unit,continueTask:()->Unit,stop:()->Unit,approve:(JSONObject)->Unit,
){
    val busy=state.busy.isNotBlank()
    val enabled=connected&&!busy
    val detail=state.detail
    val task=detail?.optJSONObject("task")
    val approvals=relayObjects(detail?.optJSONArray("approvals"))
    var stopConfirmation by remember(state.selectedId){mutableStateOf(false)}
    NativeManagementPage(if(state.selectedId.isBlank())"个人助理" else "任务详情","",if(state.selectedId.isBlank())back else ({select("")}),modifier=Modifier.testTag("assistantManagement"),actions={ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",refreshTasks,enabled=enabled)}){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),state=rememberNativeManagementListState(),contentPadding=nativeManagementPadding(PaddingValues(16.dp)),verticalArrangement=Arrangement.spacedBy(12.dp)){
            if(!connected)item{Text("连接电脑后使用个人助理")}
            if(state.error.isNotBlank())item{SelectionContainer{Text(state.error,color=MaterialTheme.colors.error,fontSize=13.sp)}}
            if(state.message.isNotBlank())item{Text(state.message,color=MaterialTheme.colors.primary,fontSize=13.sp)}
            if(busy||state.loading)item{LinearProgressIndicator(Modifier.fillMaxWidth());Text(if(busy)"正在处理，请等待执行回执…" else "正在读取任务…",fontSize=12.sp)}
            if(state.selectedId.isBlank()){
                item{AssistantComposer(state,enabled,refreshCatalog,editPrompt,editProject,chooseModel,chooseEffort,create)}
                item{Text("我的任务",fontWeight=FontWeight.SemiBold)}
                items(state.tasks,key={it.accountText("id")}){item->DashboardCard{
                    Text(item.accountText("title"),fontWeight=FontWeight.Medium)
                    Text(if(item.optBoolean("waitingApproval"))"等待确认" else assistantStatusLabel(item.accountText("executionStatus").ifBlank{item.accountText("state")}),fontSize=12.sp)
                    Text("${item.accountText("harness").ifBlank{item.accountText("executor")}} · ${item.accountText("model")}",fontSize=11.sp)
                    TextButton(onClick={select(item.accountText("id"))},enabled=enabled){Text("查看任务")}
                }}
                if(state.tasks.isEmpty())item{Text("还没有任务",fontSize=13.sp)}
            }else if(task!=null&&detail!=null){
                item{DashboardCard{
                    Text(task.accountText("title"),fontWeight=FontWeight.SemiBold,fontSize=16.sp)
                    Text(if(approvals.isNotEmpty())"等待确认" else assistantStatusLabel(assistantStatusCode(detail)),fontSize=13.sp)
                    Text("${task.accountText("harness").ifBlank{task.accountText("executor")}} · ${task.accountText("model")} · ${task.accountText("effort").ifBlank{"执行器管理思考等级"}}",fontSize=12.sp)
                    SelectionContainer{Text(nativeDisplayPath(task.accountText("projectPath")),fontSize=12.sp)}
                    if(task.accountText("error").isNotBlank())SelectionContainer{Text(task.accountText("error"),color=MaterialTheme.colors.error,fontSize=13.sp)}
                    if(detail.optBoolean("receiptMissing"))Text("提交回执尚未确认，请刷新或使用相同内容重试，避免重复任务。",color=MaterialTheme.colors.error,fontSize=12.sp)
                    if(task.accountText("threadId").isNotBlank())OutlinedButton(onClick={stopConfirmation=true},enabled=enabled,modifier=Modifier.testTag("stopAssistantTask")){Text("停止任务")}
                }}
                val unknown=relayObjects(detail.optJSONObject("history")?.optJSONArray("unconfirmedCommands"))
                if(unknown.isNotEmpty())item{DashboardCard{
                    Text("旧命令状态待核实",color=MaterialTheme.colors.error,fontWeight=FontWeight.SemiBold)
                    Text("旧命令可能仍在运行，请核实进程与实际结果。",fontSize=13.sp)
                    unknown.forEach{command->SelectionContainer{Text("PID ${command.accountText("pid")}\n${command.accountText("command")}\n${command.accountText("cwd")}",fontSize=12.sp)}}
                }}
                items(approvals,key={it.accountText("id")}){approval->AssistantApproval(state.selectedId,approval,enabled,approve)}
                item{Text("执行过程",fontWeight=FontWeight.SemiBold)}
                val events=assistantEvents(detail)
                items(events,key={it.first}){(_,event)->AssistantHistoryEvent(event)}
                if(events.isEmpty())item{Text("等待执行回执。",fontSize=13.sp)}
                if(task.accountText("threadId").isNotBlank())item{DashboardCard{
                    OutlinedTextField(state.followup,editFollowup,label={Text("补充要求")},enabled=enabled,modifier=Modifier.fillMaxWidth().heightIn(min=100.dp))
                    val canContinue=approvals.isEmpty()&&assistantStatusCode(detail) in listOf("idle","completed","error","interrupted","paused","command_unknown")
                    Button(onClick=continueTask,enabled=enabled&&canContinue&&state.followup.isNotBlank(),modifier=Modifier.testTag("continueAssistantTask")){Text("继续任务")}
                    if(!canContinue)Text("任务仍在执行或等待确认，结束后可继续。",fontSize=12.sp)
                }}
            }
        }
    }
    if(stopConfirmation)NativeAlertDialog(onDismissRequest={stopConfirmation=false},title={Text("停止任务")},text={Text("将请求执行器停止本轮任务。命令是否退出，以执行回执为准。")},confirmButton={TextButton(onClick={stopConfirmation=false;stop()},enabled=enabled){Text("请求停止")}},dismissButton={TextButton(onClick={stopConfirmation=false}){Text("取消")}})
}

@Composable private fun AssistantComposer(state:AssistantUiState,enabled:Boolean,refreshCatalog:()->Unit,editPrompt:(String)->Unit,editProject:(String)->Unit,chooseModel:(String)->Unit,chooseEffort:(String)->Unit,create:()->Unit){
    val selected=state.catalog.find{it.key==state.selectedModel}
    val groups=state.catalog.distinctBy{it.group}
    DashboardCard{
        Text("交代要完成的事",fontWeight=FontWeight.SemiBold)
        AssistantChoice("执行器",selected?.group.orEmpty(),groups.map{group->Triple(group.group,group.harness,state.catalog.any{it.group==group.group&&it.available})},enabled&&!state.catalogLoading){group->state.catalog.firstOrNull{it.group==group&&it.available}?.let{chooseModel(it.key)}}
        AssistantChoice("模型",state.selectedModel,state.catalog.filter{it.group==selected?.group}.map{Triple(it.key,it.name+(if(it.available)"" else "（${it.reason.ifBlank{"不可用"}}）"),it.available)},enabled&&!state.catalogLoading,chooseModel)
        if(selected!=null&&selected.efforts.isNotEmpty())AssistantChoice("思考等级",state.effort,selected.efforts.map{Triple(it.first,assistantEffortLabel(it.first),true)},enabled,chooseEffort)
        else Text("思考等级由执行器管理",fontSize=12.sp)
        TextButton(onClick=refreshCatalog,enabled=enabled&&!state.catalogLoading){Text(if(state.catalogLoading)"正在读取模型…" else "刷新执行器与模型")}
        if(state.catalogError.isNotBlank())Text(state.catalogError,color=MaterialTheme.colors.error,fontSize=12.sp)
        state.backendMessages.forEach{Text(it,fontSize=12.sp,color=MaterialTheme.colors.error)}
        state.catalog.filter{!it.available}.distinctBy{it.group to it.reason}.forEach{Text("${it.harness}：${it.reason.ifBlank{"当前不可用"}}",fontSize=12.sp,color=MaterialTheme.colors.error)}
        OutlinedTextField(state.projectPath,editProject,label={Text("工作目录")},enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth())
        if(state.projects.isNotEmpty())AssistantChoice("已配置项目",state.projectPath,state.projects.map{Triple(it.first,it.second,true)},enabled,editProject)
        OutlinedTextField(state.prompt,editPrompt,label={Text("任务")},placeholder={Text("整理目录中的文件，查找资料并汇总成文档")},enabled=enabled,modifier=Modifier.fillMaxWidth().heightIn(min=140.dp))
        Button(onClick=create,enabled=enabled&&!state.catalogLoading&&selected?.available==true&&state.prompt.isNotBlank()&&state.projectPath.isNotBlank(),modifier=Modifier.fillMaxWidth().testTag("createAssistantTask")){Text("开始任务")}
    }
}

@Composable private fun AssistantChoice(label:String,selected:String,options:List<Triple<String,String,Boolean>>,enabled:Boolean,onSelect:(String)->Unit){
    var expanded by remember{mutableStateOf(false)}
    Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
        Text(label,fontSize=12.sp)
        Box{OutlinedButton(onClick={expanded=true},enabled=enabled&&options.isNotEmpty(),modifier=Modifier.fillMaxWidth()){Text(options.firstOrNull{it.first==selected}?.second?:"请选择",modifier=Modifier.weight(1f))}
            NativeDropdownMenu(expanded,{expanded=false},modifier=Modifier.heightIn(max=320.dp)){options.forEach{option->DropdownMenuItem(onClick={expanded=false;onSelect(option.first)},enabled=option.third){Text(option.second,fontSize=13.sp)}}}
        }
    }
}

@Composable private fun AssistantApproval(taskId:String,approval:JSONObject,enabled:Boolean,submit:(JSONObject)->Unit){
    val id=approval.accountText("id")
    val detail=approval.opt("detail")
    val parsed=when(detail){is JSONObject->detail;is String->runCatching{JSONObject(detail)}.getOrNull();else->null}
    val questions=relayObjects(parsed?.optJSONArray("questions")?:approval.optJSONArray("questions"))
    var answers by remember(taskId,id){mutableStateOf<Map<String,String>>(emptyMap())}
    DashboardCard(Modifier.testTag("assistantApproval:$id")){
        Text(approval.accountText("title").ifBlank{"需要你的确认"},fontWeight=FontWeight.SemiBold)
        SelectionContainer{Text(assistantContent(detail).ifBlank{approval.accountText("command").ifBlank{approval.accountText("description")}},fontSize=12.sp)}
        if(approval.accountText("approvalType")=="question"){
            questions.forEach{question->
                val key=question.accountText("id")
                Text(question.accountText("question").ifBlank{question.accountText("header")},fontSize=14.sp)
                relayObjects(question.optJSONArray("options")).forEach{option->
                    TextButton(onClick={answers=answers+(key to option.accountText("label"))},enabled=enabled){
                        Column{
                            Text(option.accountText("label"))
                            if(option.accountText("description").isNotBlank())Text(option.accountText("description"),fontSize=12.sp)
                        }
                    }
                }
                OutlinedTextField(answers[key].orEmpty(),{answers=answers+(key to it)},label={Text("回答")},enabled=enabled,modifier=Modifier.fillMaxWidth())
            }
            Button(
                onClick={
                    val payload=JSONObject()
                    questions.forEach{question->
                        val answer=answers[question.accountText("id")].orEmpty()
                        payload.put(question.accountText("id"),JSONObject().put("answers",org.json.JSONArray(listOf(answer))))
                    }
                    submit(JSONObject().put("approvalId",id).put("answers",payload))
                },
                enabled=enabled&&questions.isNotEmpty()&&questions.all{answers[it.accountText("id")].orEmpty().isNotBlank()},
            ){Text("提交回答")}
        }else Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            Button(onClick={submit(JSONObject().put("approvalId",id).put("decision","accept"))},enabled=enabled){Text("允许这次操作")}
            OutlinedButton(onClick={submit(JSONObject().put("approvalId",id).put("decision","decline"))},enabled=enabled){Text("拒绝")}
        }
    }
}

@Composable private fun AssistantHistoryEvent(event:JSONObject){
    val type=event.accountText("type")
    val prose=type in listOf("message.delta","user.message")
    var expanded by remember{mutableStateOf(prose)}
    DashboardCard{
        TextButton(onClick={expanded=!expanded}){Text(when{type=="user.message"->"你";type=="message.delta"->"助理";type.startsWith("approval.")->"权限请求";type.contains("error")->"执行错误";type.startsWith("turn.")->"执行进度";type.contains("reasoning")->"思考过程";else->event.accountText("title").ifBlank{event.accountText("name").ifBlank{"工具操作 · $type"}}})}
        if(expanded)SelectionContainer{Text(if(prose)event.accountText("text").ifBlank{event.accountText("message").ifBlank{assistantContent(event.opt("output")).ifBlank{assistantContent(event.opt("detail"))}}} else event.toString(2),fontSize=13.sp)}
    }
}

private fun assistantEvents(detail:JSONObject):List<Pair<String,JSONObject>>{
    val result=mutableListOf<Pair<String,JSONObject>>()
    relayObjects(detail.optJSONObject("history")?.optJSONArray("events")).forEachIndexed{index,event->
        val previous=result.lastOrNull()
        if(event.accountText("type")=="message.delta"&&previous!=null&&previous.second.accountText("type")=="message.delta"&&event.accountText("itemId")==previous.second.accountText("itemId")&&event.accountText("turnId")==previous.second.accountText("turnId")&&!event.optBoolean("textComplete")){
            result[result.lastIndex]=previous.first to JSONObject(previous.second.toString()).put("text",previous.second.accountText("text")+event.accountText("text"))
        }else result+=(event.accountText("seq").ifBlank{event.accountText("eventId").ifBlank{event.accountText("id").ifBlank{"event-$index"}}} to event)
    }
    return result
}
private fun assistantStatusCode(detail:JSONObject?):String{
    val history=detail?.optJSONObject("history")
    if(relayObjects(history?.optJSONArray("unconfirmedCommands")).isNotEmpty())return "command_unknown"
    return history?.accountText("status").orEmpty().ifBlank{detail?.optJSONObject("task")?.accountText("state").orEmpty()}
}
private fun assistantStatusLabel(value:String)=when(value){
    "submitting"->"提交中";"starting"->"启动中";"accepted"->"已提交";"uncertain"->"提交待确认";"failed"->"提交失败";"idle"->"待命";"running","inProgress"->"执行中";"waiting"->"等待确认";"stopping"->"正在停止，等待确认";"completed"->"已完成";"error"->"执行失败";"interrupted"->"执行已中断";"paused"->"本轮步数已用完，可继续任务";"command_unknown"->"旧命令状态待核实，可能仍在运行";else->"状态待确认"
}
private fun assistantEffortLabel(value:String)=when(value){"minimal"->"最少";"low"->"低";"medium"->"中";"high"->"高";"xhigh"->"很高";"max"->"最大";"ultra"->"超高";"none"->"关闭";"default"->"默认";else->value}
private fun assistantContent(value:Any?):String=when(value){null,JSONObject.NULL->"";is JSONObject->value.toString(2);is org.json.JSONArray->value.toString(2);else->value.toString()}
private fun assistantError(error:Exception)=error.message?.takeIf{it.isNotBlank()}?:"个人助理暂时不可用，请刷新任务状态"
