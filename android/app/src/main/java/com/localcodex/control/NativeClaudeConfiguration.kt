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
import org.json.JSONObject

private data class ClaudeProfileDraft(
    val id:String="",val name:String="",val category:String="aggregator",val baseUrl:String="",val originalUrl:String="",
    val hasKey:Boolean=false,val apiKey:String="",val authType:String="authToken",val model:String="",val effort:String="",
    val modelEnv:Map<String,String> = emptyMap(),val external:Boolean=false,
)
private val claudeModelFields=listOf(
    "ANTHROPIC_MODEL" to "默认请求模型",
    "ANTHROPIC_REASONING_MODEL" to "推理模型",
    "ANTHROPIC_DEFAULT_OPUS_MODEL" to "Opus 模型",
    "ANTHROPIC_DEFAULT_SONNET_MODEL" to "Sonnet 模型",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL" to "Haiku 模型",
)

@Composable internal fun NativeClaudeConfiguration(vm:NativeViewModel,back:()->Unit){
    val active=LocalManagementPageActive.current
    val connected=vm.state.connected
    val source=vm.accountsState
    val state=if(source.service=="claude-profile")source else NativeAccountsState(service="claude-profile")
    var editor by remember(vm.state.address){mutableStateOf<ClaudeProfileDraft?>(null)}
    var deleting by remember{mutableStateOf<JSONObject?>(null)}
    var pending by remember{mutableStateOf("")}
    var previousResult by remember{mutableStateOf<JSONObject?>(null)}
    fun send(action:String,body:JSONObject){
        if(!connected||state.busy.isNotBlank())return
        pending=action;previousResult=state.result;vm.accountAction("claude-profile",action,body)
    }
    LaunchedEffect(vm,connected,active,vm.state.address){if(connected&&active)vm.loadAccounts("claude-profile")}
    LaunchedEffect(state.result,state.busy){
        val result=state.result
        if(state.busy.isBlank()&&result!=null&&result!==previousResult&&pending.isNotBlank()){
            when(pending){"read"->editor=claudeDraft(result);"save"->editor=null}
            pending=""
        }
    }
    NativeClaudeConfigurationContent(state,connected,editor,back,{vm.loadAccounts("claude-profile")},{editor=it}){action,body->
        if(action=="delete")deleting=body else send(action,body)
    }
    deleting?.let{body->AlertDialog(onDismissRequest={deleting=null},title={Text("删除 Claude 配置")},text={Text("将删除此本机配置及其保存的密钥。当前正在使用的配置需要先切换后才能删除。")},confirmButton={TextButton(onClick={deleting=null;send("delete",body)},enabled=connected&&state.busy.isBlank()){Text("删除",color=MaterialTheme.colors.error)}},dismissButton={TextButton(onClick={deleting=null}){Text("取消")}})}
    state.confirmation?.let{preview->
        val allowed=preview.optBoolean("canSwitch",false)&&!preview.optBoolean("blocked")&&preview.accountText("planId").isNotBlank()
        AlertDialog(onDismissRequest=vm::dismissAccountConfirmation,title={Text("切换 Claude 配置")},text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text(preview.accountText("name").ifBlank{preview.accountText("label")}.ifBlank{"所选配置"},fontWeight=FontWeight.SemiBold)
            Text(preview.accountText("message").ifBlank{if(allowed)"将更新电脑上的 Claude 服务地址、认证和模型。其他设置保留，写入前保存备份。" else "仍有任务正在运行，请结束后重试。"})
            relayObjects(preview.optJSONArray("blockingThreads")).forEach{Text(it.accountText("name").ifBlank{it.accountText("id")},fontSize=12.sp)}
        }},confirmButton={if(allowed)TextButton(onClick={send("switch",JSONObject().put("app","claude").put("id",preview.accountText("id")).put("planId",preview.accountText("planId")))},enabled=connected&&state.busy.isBlank()){Text("确认切换")}},dismissButton={TextButton(onClick=vm::dismissAccountConfirmation){Text("取消")}})
    }
}

@Composable private fun NativeClaudeConfigurationContent(
    state:NativeAccountsState,connected:Boolean,editor:ClaudeProfileDraft?,back:()->Unit,refresh:()->Unit,
    edit:(ClaudeProfileDraft?)->Unit,action:(String,JSONObject)->Unit,
){
    val busy=state.loading||state.busy.isNotBlank()
    val claude=state.data?.optJSONObject("apps")?.optJSONObject("claude")
    val profiles=relayObjects(claude?.optJSONArray("profiles"))
    NativeManagementPage(if(editor==null)"Claude 中转配置" else if(editor.id.isBlank())"添加 Claude 配置" else "编辑 Claude 配置","",if(editor!=null)({edit(null)}) else back,
        modifier=Modifier.testTag("claudeRelayConfiguration"),actions={TextButton(onClick=refresh,enabled=connected&&!busy&&editor==null){Text(if(state.loading)"加载中…" else "刷新")}}){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            if(!connected)item{Text("连接电脑后管理 Claude 配置")}
            if(state.error.isNotBlank())item{Text(state.error,color=MaterialTheme.colors.error,fontSize=13.sp)}
            if(state.message.isNotBlank())item{Text(state.message,color=MaterialTheme.colors.primary,fontSize=13.sp)}
            if(state.busy.isNotBlank())item{LinearProgressIndicator(Modifier.fillMaxWidth())}
            if(editor!=null)item{ClaudeProfileEditor(editor,connected&&!busy,edit,action)}
            else{
                item{DashboardCard{
                    Text("Claude Code",fontWeight=FontWeight.SemiBold)
                    Text(if(claude?.optBoolean("external")==true)"电脑正在使用其他配置" else if(claude?.accountText("activeId").orEmpty().isNotBlank())"已识别当前配置" else "尚未识别当前配置",fontSize=13.sp)
                    Text("保存后可在列表中切换。Claude Code 将读取更新后的配置。",fontSize=12.sp)
                    Button(onClick={edit(ClaudeProfileDraft())},enabled=connected&&!busy,modifier=Modifier.testTag("addClaudeProfile")){Text("添加中转配置")}
                    OutlinedButton(onClick={edit(ClaudeProfileDraft(category="official",name="Claude 官方登录"))},enabled=connected&&!busy){Text("添加官方登录配置")}
                }}
                items(profiles,key={it.optString("id")}){profile->
                    val id=profile.optString("id")
                    val selected=id==claude?.accountText("activeId")
                    DashboardCard(Modifier.testTag("claudeProfile:$id")){
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(profile.optString("name"),Modifier.weight(1f),fontWeight=FontWeight.SemiBold);if(selected)Text("当前",color=MaterialTheme.colors.primary,fontSize=12.sp)}
                        Text("${if(profile.optString("category")=="official")"官方登录" else "中转服务"} · ${profile.optString("source","本机")}",fontSize=12.sp)
                        NativeAccountActions{
                            if(!selected)TextButton(onClick={action("switch-preview",JSONObject().put("app","claude").put("id",id))},enabled=connected&&!busy){Text("切换")}
                            TextButton(onClick={action("read",JSONObject().put("app","claude").put("id",id))},enabled=connected&&!busy){Text(if(profile.optBoolean("editable"))"编辑" else "查看与另存")}
                            if(profile.optBoolean("editable"))TextButton(onClick={action("delete",JSONObject().put("app","claude").put("id",id))},enabled=connected&&!busy&&!selected){Text("删除",color=MaterialTheme.colors.error)}
                        }
                    }
                }
                if(profiles.isEmpty()&&!state.loading)item{Text("尚未保存 Claude 配置，可添加中转或读取本机 CC Switch 配置。",fontSize=13.sp)}
            }
        }
    }
}

@Composable private fun ClaudeProfileEditor(draft:ClaudeProfileDraft,enabled:Boolean,edit:(ClaudeProfileDraft?)->Unit,action:(String,JSONObject)->Unit){
    var error by remember{mutableStateOf("")}
    val official=draft.category=="official"
    val changedUrl=draft.hasKey&&draft.baseUrl.trim().trimEnd('/')!=draft.originalUrl.trimEnd('/')
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        if(draft.external)Text("保存为本机新配置，保留 CC Switch 中的原配置。",fontSize=12.sp)
        OutlinedTextField(draft.name,{edit(draft.copy(name=it))},label={Text("配置名称")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
        DashboardTabs(listOf("aggregator" to "中转服务","official" to "官方登录"),if(official)"official" else "aggregator",{edit(draft.copy(category=it))},enabled=enabled)
        if(!official){
            OutlinedTextField(draft.baseUrl,{edit(draft.copy(baseUrl=it))},label={Text("Anthropic API 地址")},placeholder={Text("https://api.example.com")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
            OutlinedTextField(draft.apiKey,{edit(draft.copy(apiKey=it))},label={Text("API 密钥")},placeholder={Text(if(draft.hasKey)"留空保留已保存密钥" else "填写认证密钥")},visualTransformation=PasswordVisualTransformation(),singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
            if(changedUrl)Text("服务地址已改变，请填写新地址的密钥。",color=MaterialTheme.colors.error,fontSize=12.sp)
            DashboardTabs(listOf("authToken" to "Auth Token","apiKey" to "API Key"),draft.authType,{edit(draft.copy(authType=it))},enabled=enabled)
        }else Text("使用电脑上已有的 Claude 官方登录。此配置清除中转地址与中转认证。",fontSize=12.sp)
        OutlinedTextField(draft.model,{edit(draft.copy(model=it))},label={Text("默认模型（可选）")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(draft.effort,{edit(draft.copy(effort=it))},label={Text("思考强度（可选）")},placeholder={Text("low / medium / high / max")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
        Text("模型映射",fontWeight=FontWeight.SemiBold)
        val fields=(claudeModelFields+draft.modelEnv.keys.filter{key->claudeModelFields.none{it.first==key}}.map{it to it}).distinctBy{it.first}
        fields.forEach{(key,label)->OutlinedTextField(draft.modelEnv[key].orEmpty(),{value->edit(draft.copy(modelEnv=draft.modelEnv+(key to value)))},label={Text(label)},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())}
        if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error,fontSize=13.sp)
        Button(onClick={
            error=when{
                draft.name.isBlank()->"请填写配置名称"
                !official&&relayUrlError(draft.baseUrl)!=null->relayUrlError(draft.baseUrl).orEmpty()
                !official&&changedUrl&&draft.apiKey.isBlank()->"请填写新地址的认证密钥"
                !official&&!draft.hasKey&&draft.apiKey.isBlank()->"请填写 Claude 中转认证密钥"
                draft.effort.isNotBlank()&&draft.effort !in listOf("low","medium","high","max")->"思考强度应为 low、medium、high 或 max"
                else->""
            }
            if(error.isBlank())action("save",JSONObject().apply{
                put("app","claude");if(draft.id.isNotBlank())put("id",draft.id)
                put("name",draft.name.trim());put("category",draft.category);put("authType",draft.authType)
                if(!official&&draft.apiKey.isNotBlank())put("apiKey",draft.apiKey)
                put("settings",JSONObject().put("env",JSONObject().apply{
                    if(!official)put("ANTHROPIC_BASE_URL",draft.baseUrl.trim())
                    draft.modelEnv.forEach{(key,value)->if(value.isNotBlank())put(key,value.trim())}
                }).put("model",draft.model.trim()).put("effortLevel",draft.effort.trim()))
            })
        },enabled=enabled,modifier=Modifier.fillMaxWidth().testTag("saveClaudeProfile")){Text("保存配置")}
    }
}

private fun claudeDraft(profile:JSONObject):ClaudeProfileDraft{
    val settings=profile.optJSONObject("settings")?:JSONObject()
    val env=settings.optJSONObject("env")?:JSONObject()
    val modelEnv=env.keys().asSequence().filter{it!="ANTHROPIC_BASE_URL"&&it!="ANTHROPIC_AUTH_TOKEN"&&it!="ANTHROPIC_API_KEY"}.associateWith{env.accountText(it)}
    return ClaudeProfileDraft(id=profile.accountText("id"),name=profile.accountText("name"),category=profile.accountText("category").ifBlank{"aggregator"},baseUrl=env.accountText("ANTHROPIC_BASE_URL"),originalUrl=env.accountText("ANTHROPIC_BASE_URL"),hasKey=profile.optBoolean("hasKey"),authType=profile.accountText("authType").ifBlank{"authToken"},model=settings.accountText("model"),effort=settings.accountText("effortLevel"),modelEnv=modelEnv,external=profile.accountText("source")=="CC Switch")
}
