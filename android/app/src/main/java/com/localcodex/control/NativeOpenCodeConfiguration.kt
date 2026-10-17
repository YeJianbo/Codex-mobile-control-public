package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private const val openCodeRoute="/api/mobile-management/opencode"
private data class OpenCodeModelDraft(val id:String="",val name:String="",val context:String="",val output:String="")
private data class OpenCodeProviderDraft(val id:String="",val originalId:String="",val name:String="",val npm:String="@ai-sdk/openai-compatible",val baseUrl:String="",val originalUrl:String="",val apiKey:String="",val hasKey:Boolean=false,val enabled:Boolean=true,val models:List<OpenCodeModelDraft> = listOf(OpenCodeModelDraft()))
private data class OpenCodeLoad(val data:JSONObject?=null,val busy:Boolean=false,val error:String="",val message:String="",val preview:JSONObject?=null,val applyKind:String="",val applied:Int=0)

private class OpenCodeRequests(private val scope:CoroutineScope,private val request:suspend(String,JSONObject?)->JSONObject){
    var state by mutableStateOf(OpenCodeLoad());private set
    private var job:Job?=null
    private var ticket=0
    fun run(work:suspend()->Unit){
        if(state.busy)return
        val current=++ticket;state=state.copy(busy=true,error="",message="")
        job=scope.launch{try{work()}catch(cancel:CancellationException){throw cancel}catch(error:Exception){if(current==ticket)state=state.copy(error=error.message.orEmpty().ifBlank{"操作失败，请重试"})}finally{if(current==ticket)state=state.copy(busy=false)}}
    }
    fun load()=run{state=state.copy(data=request(openCodeRoute,null))}
    fun preview(kind:String,body:JSONObject)=run{state=state.copy(preview=request("$openCodeRoute/$kind-preview",body),applyKind=kind)}
    fun dismiss(){if(!state.busy)state=state.copy(preview=null)}
    fun apply(){
        val preview=state.preview?:return
        val kind=state.applyKind
        if(!preview.optBoolean("canSwitch",false)||preview.accountText("planId").isBlank())return
        run{
            val result=request("$openCodeRoute/$kind-apply",JSONObject().put("planId",preview.accountText("planId")).put("confirmed",true))
            state=state.copy(preview=null,applied=state.applied+1,message=result.accountText("message").ifBlank{"OpenCode 配置已保存"})
            try{state=state.copy(data=request(openCodeRoute,null))}catch(cancel:CancellationException){throw cancel}catch(error:Exception){state=state.copy(error="配置已保存，刷新失败：${error.message.orEmpty()}")}
        }
    }
    fun cancel(){ticket++;job?.cancel();job=null;state=state.copy(busy=false,preview=null)}
}

@Composable internal fun NativeOpenCodeConfiguration(vm:NativeViewModel,back:()->Unit){
    val scope=rememberCoroutineScope()
    val address=vm.state.address
    val fingerprint=vm.state.certificateSha256
    val requests=remember(vm,address,fingerprint){OpenCodeRequests(scope,vm::managementRequest)}
    val connected=vm.state.connected
    val active=LocalManagementPageActive.current
    var editor by remember(address,fingerprint){mutableStateOf<OpenCodeProviderDraft?>(null)}
    var modelsEditor by remember(address,fingerprint){mutableStateOf(false)}
    LaunchedEffect(requests,connected,active){if(connected&&active)requests.load() else requests.cancel()}
    DisposableEffect(requests){onDispose{requests.cancel()}}
    LaunchedEffect(requests.state.applied){if(requests.state.applied>0){editor=null;modelsEditor=false;vm.refreshBackends(force=true)}}
    NativeOpenCodeContent(requests.state,connected,editor,modelsEditor,
        {if(editor!=null)editor=null else if(modelsEditor)modelsEditor=false else back()},requests::load,{editor=it},{modelsEditor=it}){kind,body->if(connected&&active)requests.preview(kind,body)}
    requests.state.preview?.let{preview->
        val allowed=preview.optBoolean("canSwitch",false)&&preview.accountText("planId").isNotBlank()&&preview.optInt("blockingCount")==0
        AlertDialog(onDismissRequest=requests::dismiss,title={Text("确认更新 OpenCode 配置")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text(preview.accountText("message").ifBlank{if(allowed)"确认后保存到电脑，新建会话使用更新后的配置。" else "当前配置不能更新，请检查运行任务。"})
            preview.accountRows("changes").forEach{change->Text(change.accountText("title"),fontWeight=FontWeight.Medium);change.accountText("detail").takeIf{it.isNotBlank()}?.let{Text(it,fontSize=13.sp)}}
        }},confirmButton={if(allowed)TextButton(onClick=requests::apply,enabled=!requests.state.busy,modifier=Modifier.testTag("applyOpenCodeConfiguration")){Text(if(requests.state.busy)"正在保存…" else "确认保存")}},dismissButton={TextButton(onClick=requests::dismiss,enabled=!requests.state.busy){Text("取消")}})
    }
}

@Composable private fun NativeOpenCodeContent(state:OpenCodeLoad,connected:Boolean,editor:OpenCodeProviderDraft?,modelsEditor:Boolean,back:()->Unit,refresh:()->Unit,edit:(OpenCodeProviderDraft?)->Unit,editModels:(Boolean)->Unit,preview:(String,JSONObject)->Unit){
    val data=state.data
    val providers=data?.accountRows("providers").orEmpty()
    val enabled=connected&&!state.busy&&data?.optBoolean("writable",true)!=false
    NativeManagementPage(if(editor!=null)if(editor.originalId.isBlank())"添加 OpenCode 供应商" else "编辑 OpenCode 供应商" else if(modelsEditor)"OpenCode 默认模型" else "OpenCode","",back,modifier=Modifier.testTag("openCodeConfiguration"),actions={
        if(editor==null&&!modelsEditor)TextButton(onClick=refresh,enabled=connected&&!state.busy){Text("刷新")}
    }){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            if(!connected)item{Text("连接电脑后管理 OpenCode 配置")}
            if(state.busy)item{LinearProgressIndicator(Modifier.fillMaxWidth())}
            if(state.error.isNotBlank())item{Text(state.error,color=MaterialTheme.colors.error)}
            if(state.message.isNotBlank())item{Text(state.message,color=MaterialTheme.colors.primary)}
            data?.accountText("error")?.takeIf{it.isNotBlank()}?.let{message->item{Text(message,color=MaterialTheme.colors.error)}}
            if(editor!=null)item{OpenCodeProviderEditor(editor,enabled,edit){preview("provider",it)}}
            else if(modelsEditor&&data!=null)item{OpenCodeDefaultModels(data,enabled){preview("model",it)}}
            else if(data!=null){
                item{DashboardCard{
                    Text("OpenCode",fontWeight=FontWeight.SemiBold)
                    Text(if(data.optBoolean("installed"))"已检测到本机安装" else "未检测到本机安装",fontSize=13.sp)
                    Text(if(data.optBoolean("configured"))"已读取本机配置" else "尚未配置供应商",fontSize=13.sp)
                    Text("默认模型：${data.accountText("model").ifBlank{"由 OpenCode 选择"}}",fontSize=13.sp)
                    Text("小模型：${data.accountText("smallModel").ifBlank{"由 OpenCode 选择"}}",fontSize=13.sp)
                    TextButton(onClick={editModels(true)},enabled=enabled){Text("设置默认模型")}
                    Button(onClick={edit(OpenCodeProviderDraft())},enabled=enabled,modifier=Modifier.testTag("addOpenCodeProvider")){Text("添加供应商")}
                }}
                items(providers,key={it.accountText("id")}){provider->DashboardCard(Modifier.testTag("openCodeProvider:${provider.accountText("id")}")){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(provider.accountText("name").ifBlank{provider.accountText("id")},Modifier.weight(1f),fontWeight=FontWeight.SemiBold);Text(if(provider.optBoolean("enabled"))"已启用" else "已停用",fontSize=12.sp)}
                    Text(provider.accountText("id")+" · "+provider.accountText("npm"),fontSize=12.sp)
                    provider.accountText("baseUrl").takeIf{it.isNotBlank()}?.let{Text(it,fontSize=12.sp)}
                    Text("${provider.accountRows("models").size} 个模型 · "+when(provider.accountText("authType")){"oauth"->"OAuth 授权";"api"->if(provider.optBoolean("hasKey"))"已配置 API 认证" else "尚无 API 密钥";else->if(provider.optBoolean("hasKey"))"已配置密钥" else "未保存认证"},fontSize=12.sp)
                    TextButton(onClick={edit(openCodeDraft(provider))},enabled=enabled){Text("编辑供应商与模型")}
                }}
                data.accountRows("accounts").filter{it.accountText("type")=="oauth"}.forEach{account->item{Text("${account.accountText("providerId")} · 本机 OAuth 授权",fontSize=12.sp)}}
                val warnings=data.optJSONArray("warnings")
                (0 until (warnings?.length()?:0)).forEach{index->item{Text(warnings!!.optString(index),fontSize=12.sp)}}
            }
        }
    }
}

@Composable private fun OpenCodeProviderEditor(draft:OpenCodeProviderDraft,enabled:Boolean,edit:(OpenCodeProviderDraft?)->Unit,preview:(JSONObject)->Unit){
    var packagesOpen by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf("")}
    val packages=(listOf("@ai-sdk/openai-compatible","@ai-sdk/openai","@ai-sdk/anthropic")+draft.npm).filter{it.isNotBlank()||draft.originalId.isNotBlank()}.distinct()
    fun packageName(npm:String)=when(npm){"@ai-sdk/openai-compatible"->"OpenAI 兼容";"@ai-sdk/openai"->"OpenAI Responses";"@ai-sdk/anthropic"->"Anthropic";""->"原生 SDK 默认值";else->npm}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        OutlinedTextField(draft.id,{edit(draft.copy(id=it))},label={Text("供应商 ID")},singleLine=true,enabled=enabled&&draft.originalId.isBlank(),modifier=Modifier.fillMaxWidth())
        OutlinedTextField(draft.name,{edit(draft.copy(name=it))},label={Text("显示名称")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
        Box{OutlinedButton(onClick={packagesOpen=true},enabled=enabled){Text(packageName(draft.npm))};DropdownMenu(packagesOpen,{packagesOpen=false}){packages.forEach{npm->DropdownMenuItem(onClick={edit(draft.copy(npm=npm));packagesOpen=false}){Text(packageName(npm))}}}}
        OutlinedTextField(draft.baseUrl,{edit(draft.copy(baseUrl=it))},label={Text("服务地址（留空使用默认地址）")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(draft.apiKey,{edit(draft.copy(apiKey=it))},label={Text(if(draft.hasKey)"API Key（留空保留）" else "API Key")},visualTransformation=PasswordVisualTransformation(),singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
        Row(verticalAlignment=Alignment.CenterVertically){Checkbox(draft.enabled,{edit(draft.copy(enabled=it))},enabled=enabled);Text("启用此供应商")}
        draft.models.forEachIndexed{index,model->
            DashboardCard{
                Text("模型 ${index+1}",fontWeight=FontWeight.Medium)
                fun update(value:OpenCodeModelDraft){edit(draft.copy(models=draft.models.toMutableList().also{it[index]=value}))}
                OutlinedTextField(model.id,{update(model.copy(id=it))},label={Text("模型 ID")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
                OutlinedTextField(model.name,{update(model.copy(name=it))},label={Text("模型显示名称（可选）")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
                OutlinedTextField(model.context,{update(model.copy(context=it))},label={Text("上下文长度（可选）")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
                OutlinedTextField(model.output,{update(model.copy(output=it))},label={Text("输出上限（可选）")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
                TextButton(onClick={edit(draft.copy(models=draft.models.filterIndexed{i,_->i!=index}))},enabled=enabled){Text("移除模型")}
            }
        }
        TextButton(onClick={edit(draft.copy(models=draft.models+OpenCodeModelDraft()))},enabled=enabled){Text("添加模型")}
        if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error)
        Button(onClick={
            error=when{
                draft.id.isBlank()->"请填写供应商 ID"
                draft.name.isBlank()->"请填写显示名称"
                draft.hasKey&&draft.originalUrl.trimEnd('/')!=draft.baseUrl.trim().trimEnd('/')&&draft.apiKey.isBlank()->"服务地址已改变，请填写新地址的密钥"
                draft.models.any{it.id.isBlank()}->"请填写每个模型的 ID"
                draft.models.map{it.id.trim()}.distinct().size!=draft.models.size->"模型 ID 不能重复"
                draft.models.any{listOf(it.context,it.output).any{limit->limit.isNotBlank()&&(limit.toLongOrNull()?.let{n->n>0}!=true)}}->"上下文与输出上限应为正整数"
                else->""
            }
            if(error.isBlank()){
                val models=JSONArray(draft.models.map{model->JSONObject().apply{
                    put("id",model.id.trim())
                    if(model.name.isNotBlank())put("name",model.name.trim())
                    model.context.toLongOrNull()?.let{put("context",it)}
                    model.output.toLongOrNull()?.let{put("output",it)}
                }})
                val payload=JSONObject().apply{
                    put("providerId",draft.id.trim());put("name",draft.name.trim());put("npm",draft.npm)
                    put("baseUrl",draft.baseUrl.trim());put("apiKey",draft.apiKey);put("enabled",draft.enabled);put("models",models)
                }
                preview(payload)
            }
        },enabled=enabled,modifier=Modifier.fillMaxWidth().testTag("previewOpenCodeProvider")){Text("预览保存")}
    }
}

@Composable private fun OpenCodeDefaultModels(data:JSONObject,enabled:Boolean,preview:(JSONObject)->Unit){
    var model by remember(data){mutableStateOf(data.accountText("model"))}
    var smallModel by remember(data){mutableStateOf(data.accountText("smallModel"))}
    val choices=data.accountRows("providers").filter{it.optBoolean("enabled")}.flatMap{provider->provider.accountRows("models").map{provider.accountText("id")+"/"+it.accountText("id")}}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        OpenCodeModelField("默认模型",model,{model=it},choices,enabled)
        OpenCodeModelField("小模型（留空自动选择）",smallModel,{smallModel=it},choices,enabled)
        Button(onClick={preview(JSONObject().put("model",model.trim()).put("smallModel",smallModel.trim()))},enabled=enabled&&model.isNotBlank(),modifier=Modifier.fillMaxWidth().testTag("previewOpenCodeModels")){Text("预览保存")}
    }
}

@Composable private fun OpenCodeModelField(label:String,value:String,change:(String)->Unit,choices:List<String>,enabled:Boolean){
    var expanded by remember{mutableStateOf(false)}
    OutlinedTextField(value,change,label={Text(label)},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
    if(choices.isNotEmpty())Box{TextButton(onClick={expanded=true},enabled=enabled){Text("从已配置模型选择")};DropdownMenu(expanded,{expanded=false}){choices.forEach{model->DropdownMenuItem(onClick={change(model);expanded=false}){Text(model)}}}}
}

private fun openCodeDraft(row:JSONObject):OpenCodeProviderDraft{
    fun limit(model:JSONObject,key:String)=if(model.isNull(key))"" else model.optLong(key).takeIf{it>0}?.toString().orEmpty()
    return OpenCodeProviderDraft(id=row.accountText("id"),originalId=row.accountText("id"),name=row.accountText("name").ifBlank{row.accountText("id")},npm=row.accountText("npm"),baseUrl=row.accountText("baseUrl"),originalUrl=row.accountText("baseUrl"),hasKey=row.optBoolean("hasKey"),enabled=row.optBoolean("enabled"),models=row.accountRows("models").map{OpenCodeModelDraft(it.accountText("id"),it.accountText("name"),limit(it,"context"),limit(it,"output"))})
}
