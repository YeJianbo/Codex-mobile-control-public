package com.localcodex.control
import com.localcodex.control.NativeThemeSurface as Surface

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

data class NativeSubagentCloseState(val thread:ThreadRecord?=null,val busy:Boolean=false,val confirmStop:Boolean=false,val message:String="",val error:String="")
internal fun JSONObject.accountText(key:String)=if(isNull(key))"" else optString(key)
internal fun JSONObject.accountRows(key:String):List<JSONObject>{val a=optJSONArray(key)?:return emptyList();return (0 until a.length()).mapNotNull{a.optJSONObject(it)}}
private val accountServices=listOf("codex" to "Codex","agy" to "AGY / Antigravity","claude" to "Claude","deepseek" to "DeepSeek Harness","hermes" to "Hermes","opencode" to "OpenCode")

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun NativeAccountActions(modifier:Modifier=Modifier,content:@Composable ()->Unit){
    FlowRow(modifier,horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){content()}
}

@Composable internal fun NativeAccountsRoute(vm:NativeViewModel,back:()->Unit){
    var service by rememberSaveable{mutableStateOf("")}
    val active=LocalManagementPageActive.current
    val connected=vm.state.connected
    DisposableEffect(service,connected,active){
        val readingService=service
        if(readingService.isNotBlank()&&readingService !in listOf("codex-relay","claude-profile","opencode")&&connected&&active)vm.loadAccounts(readingService)
        onDispose{vm.cancelAccountRead(readingService)}
    }
    when(service){
        "codex-relay"->NativeRelayConfiguration(vm){service=""}
        "claude-profile"->NativeClaudeConfiguration(vm){service=""}
        "opencode"->NativeOpenCodeConfiguration(vm){service=""}
        else->NativeAccountsContent(vm.accountsState,service,connected,{service=it},{if(service.isBlank())back() else service=""},
            {vm.loadAccounts(service)},{action,body->vm.accountAction(service,action,body)},vm::dismissAccountConfirmation)
    }
}

@Composable internal fun NativeAccountsContent(state:NativeAccountsState,service:String,connected:Boolean,navigate:(String)->Unit,back:()->Unit,refresh:()->Unit,action:(String,JSONObject)->Unit,dismissConfirmation:()->Unit){
    val current=state.takeIf{it.service==service}
    val loading=connected&&service.isNotBlank()&&(current==null||current.loading)
    val busy=loading||current?.busy?.isNotBlank()==true
    val pulse=rememberNativeRunningPulse(busy&&service.isNotBlank())
    NativeManagementPage(accountServices.firstOrNull{it.first==service}?.second?:"账号","",back,modifier=Modifier.testTag("accountsPage:$service"),actions={
        if(service.isNotBlank())Box(Modifier.width(88.dp).height(48.dp).testTag("accountRefreshArea"),contentAlignment=Alignment.Center){
            if(busy)NativeRunningTitle(if(loading)"正在读取…" else "正在处理…",pulse,fontSize=13.sp)
            else TextButton(onClick=refresh,enabled=connected,modifier=Modifier.fillMaxSize()){Text("刷新")}
        }
    }){
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
            if(service.isBlank())(accountServices+listOf("codex-relay" to "Codex 中转与模型","claude-profile" to "Claude 中转配置")).forEach{(id,name)->
                Surface(shape=Radius.Section,color=MaterialTheme.colors.surface){TextButton(onClick={navigate(id)},modifier=Modifier.fillMaxWidth().testTag("accountService:$id")){Column(Modifier.fillMaxWidth().padding(8.dp)){
                    Text(name,fontSize=16.sp,fontWeight=FontWeight.Medium)
                    Text(if(id in listOf("deepseek","hermes","opencode"))"供应商、服务地址与模型" else "账号、登录状态与切换",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
                }}}
            } else {
                if(!connected)Text("连接电脑后管理账号")
                current?.error?.takeIf{it.isNotBlank()}?.let{Text(it,color=MaterialTheme.colors.error,modifier=Modifier.testTag("accountsError"))}
                current?.message?.takeIf{it.isNotBlank()}?.let{Text(it,modifier=Modifier.testTag("accountsMessage"))}
                val data=current?.data
                if(data!=null){
                    if(service in listOf("deepseek","hermes"))NativeModelAccountForm(data,current.result,connected&&!busy,action)
                    else NativeSavedAccounts(service,data,current.result,connected&&!busy,action)
                }
            }
        }
    }
    current?.confirmation?.takeIf{service.isNotBlank()}?.let{preview->
        val allowed=preview.optBoolean("canSwitch",false)&&!preview.optBoolean("blocked")&&preview.accountText("planId").isNotBlank()
        AlertDialog(onDismissRequest=dismissConfirmation,title={Text("确认切换账号")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text(preview.accountText("label").ifBlank{preview.accountText("name").ifBlank{preview.accountText("email").ifBlank{"所选账号"}}})
            Text(preview.accountText("message").ifBlank{if(allowed)"切换后，新请求使用该账号。" else "仍有任务正在运行，请结束后重试。"})
        }},confirmButton={if(allowed)TextButton(onClick={action("switch",JSONObject().put("id",preview.accountText("id")).put("accountId",preview.accountText("accountId")).put("target",preview.accountText("target")).put("planId",preview.accountText("planId")))},modifier=Modifier.testTag("confirmAccountSwitch")){Text("切换到此账号")}},dismissButton={TextButton(onClick=dismissConfirmation){Text("取消")}})
    }
}

@Composable private fun NativeSavedAccounts(service:String,data:JSONObject,result:JSONObject?,enabled:Boolean,action:(String,JSONObject)->Unit){
    var importName by remember(service,data){mutableStateOf("")}
    var importJson by remember(service,data){mutableStateOf("")}
    var showImport by remember(service,data){mutableStateOf(false)}
    var showExternal by remember(service){mutableStateOf(false)}
    var historyDays by remember(service){mutableStateOf(7)}
    val current=data.optJSONObject("current")
    val identity=current?.accountText("identity").orEmpty().ifBlank{current?.accountText("email").orEmpty()}.ifBlank{data.accountText("email")}
    if(identity.isNotBlank())Text("当前：$identity",fontWeight=FontWeight.Medium)
    current?.accountText("usageReason")?.takeIf{it.isNotBlank()}?.let{Text(it,fontSize=13.sp)}
    if(service=="agy"){
        NativeAccountActions{
            TextButton(onClick={action("import",JSONObject().put("source","tools"))},enabled=enabled){Text("从 Tools 导入")}
            TextButton(onClick={action("import",JSONObject().put("source","current"))},enabled=enabled){Text("保存当前账号")}
        }
        TextButton(onClick={action("refresh",JSONObject())},enabled=enabled,modifier=Modifier.testTag("refreshAgyQuota")){Text("刷新额度")}
        Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
            Text("历史范围",fontSize=12.sp)
            NativeAccountActions{listOf(1,7,30,90).forEach{days->TextButton(onClick={historyDays=days},enabled=enabled){Text("${days}天",fontWeight=if(historyDays==days)FontWeight.Bold else FontWeight.Normal)}}}
        }
        result?.accountRows("windows").orEmpty().ifEmpty{data.accountRows("windows")}.forEach{window->
            Text("${window.accountText("name").ifBlank{window.accountText("window")}} · ${if(window.has("remainingPercent"))"剩余 ${window.optDouble("remainingPercent")}%" else "尚无额度数据"}"+(window.accountText("resetsAt").takeIf{it.isNotBlank()}?.let{" · $it"}?:""),fontSize=12.sp)
        }
    }
    if(service=="claude"){
        OutlinedTextField(importName,{importName=it},label={Text("账号名称（可选）")},modifier=Modifier.fillMaxWidth(),singleLine=true)
        NativeAccountActions{
            TextButton(onClick={action("import-current",JSONObject().put("name",importName.ifBlank{identity.ifBlank{"Claude 账号"}}))},enabled=enabled){Text("保存当前账号")}
            TextButton(onClick={showImport=!showImport},enabled=enabled){Text("导入账号")}
        }
        if(showImport){
            OutlinedTextField(importJson,{importJson=it},label={Text("凭据 JSON")},visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth().heightIn(min=100.dp))
            Button(onClick={action("import",JSONObject().put("name",importName.ifBlank{"导入的 Claude 账号"}).put("json",importJson))},enabled=enabled&&importJson.isNotBlank()){Text("导入并保存到电脑")}
        }
        NativeAccountActions{TextButton(onClick={action("refresh",JSONObject().put("id","current"))},enabled=enabled){Text("刷新当前额度")};TextButton(onClick={action("select",JSONObject().put("id","current"))},enabled=enabled){Text("当前账号历史")}}
        val external=data.accountRows("externalProfiles")
        if(external.isNotEmpty()){
            TextButton(onClick={showExternal=!showExternal},enabled=enabled){Text("从 CC Switch 导入（${external.size}）")}
            if(showExternal)external.forEach{profile->TextButton(onClick={action("import-cc-switch",JSONObject().put("id",profile.accountText("id")).put("name",profile.accountText("name")))},enabled=enabled){Text(profile.accountText("name").ifBlank{profile.accountText("id")})}}
        }
    }
    val rows=data.accountRows("items")
    if(rows.isEmpty())Text(if(service=="codex")"电脑上没有已保存的账号，请先在电脑登录并保存账号。" else "尚未保存账号",fontSize=13.sp)
    rows.forEach{account->
        val id=account.accountText("id")
        val label=account.accountText("alias").ifBlank{account.accountText("name")}.ifBlank{account.accountText("email")}.ifBlank{"账号"}
        val active=account.optBoolean("active")
        Surface(shape=Radius.Section,color=MaterialTheme.colors.surface){Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text(label+if(active)" · 当前" else "",fontWeight=FontWeight.Medium)
            listOf("email","plan","workspace","serviceHost","authMethod","usageReason").map{account.accountText(it)}.filter{it.isNotBlank()&&it!=label}.distinct().forEach{Text(it,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))}
            if(service=="agy")data.accountRows("targets").forEach{target->
                val targetId=target.accountText("id");val selected=if(targetId=="acp")account.optBoolean("acpActive") else active
                TextButton(onClick={action("switch-preview",JSONObject().put("accountId",id).put("target",targetId))},enabled=enabled&&target.optBoolean("available")&&!selected&&!account.optBoolean("disabled")){Text(if(selected)"${target.accountText("name")} · 当前" else "切换 ${target.accountText("name")} 到此账号")}
            }else TextButton(onClick={action("switch-preview",JSONObject().put("id",id))},enabled=enabled&&!active&&id!="current",modifier=Modifier.testTag("switchAccount:$id")){Text("切换到此账号")}
            if(service=="agy")TextButton(onClick={action("history",JSONObject().put("accountId",id).put("days",historyDays))},enabled=enabled){Text("近 ${historyDays} 天额度历史")}
            if(service=="claude")NativeAccountActions{TextButton(onClick={action("refresh",JSONObject().put("id",id))},enabled=enabled){Text("刷新额度")};TextButton(onClick={action("select",JSONObject().put("id",id))},enabled=enabled){Text("查看历史")}}
        }}
    }
    val history=if(service=="agy")result?.accountRows("points").orEmpty().ifEmpty{result?.optJSONObject("history")?.accountRows("points").orEmpty()}.ifEmpty{result?.accountRows("history").orEmpty()}.ifEmpty{data.accountRows("history")} else data.accountRows("history")
    if(history.isNotEmpty()){
        Text("额度历史",fontWeight=FontWeight.Medium)
        history.takeLast(20).reversed().forEach{point->
            Text(point.accountText("at"),fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
            point.accountRows("windows").forEach{window->Text("${window.accountText("name").ifBlank{window.accountText("window")}} · ${if(window.has("remainingPercent"))"剩余 ${window.optDouble("remainingPercent")}%" else "尚无额度数据"}"+(window.accountText("resetsAt").takeIf{it.isNotBlank()}?.let{" · $it"}?:""),fontSize=12.sp)}
            point.accountText("reason").takeIf{it.isNotBlank()}?.let{Text(it,fontSize=12.sp)}
        }
    }
    data.accountText("switchReason").takeIf{it.isNotBlank()}?.let{Text(it,fontSize=13.sp)}
}

@Composable private fun NativeModelAccountForm(data:JSONObject,result:JSONObject?,enabled:Boolean,action:(String,JSONObject)->Unit){
    val uriHandler=LocalUriHandler.current
    var provider by remember(data){mutableStateOf(data.accountText("provider"))}
    var baseUrl by remember(data){mutableStateOf(data.accountText("baseUrl"))}
    var model by remember(data){mutableStateOf(data.accountText("model"))}
    var apiMode by remember(data){mutableStateOf(data.accountText("apiMode"))}
    var apiKey by remember(data){mutableStateOf("")}
    var providerOpen by remember{mutableStateOf(false)}
    var protocolOpen by remember{mutableStateOf(false)}
    val deepseek=data.accountText("app")=="deepseek"
    val protocols=if(deepseek)listOf("" to "自动判断","openai-responses" to "OpenAI Responses","openai-completions" to "OpenAI Chat Completions","anthropic-messages" to "Anthropic Messages") else listOf("" to "自动判断","codex_responses" to "OpenAI Responses","chat_completions" to "OpenAI Chat Completions","anthropic_messages" to "Anthropic Messages")
    val choices=data.accountRows("providerChoices").ifEmpty{if(data.accountText("app")=="hermes")listOf("openrouter","openai-api","openai-codex","deepseek","anthropic","custom").map{JSONObject().put("id",it).put("name",it).put("baseUrl",when(it){"openrouter"->"https://openrouter.ai/api/v1";"openai-api"->"https://api.openai.com/v1";"openai-codex"->"https://chatgpt.com/backend-api/codex";"deepseek"->"https://api.deepseek.com/v1";"anthropic"->"https://api.anthropic.com";else->""})}else emptyList()}
    Text(if(data.optBoolean("configured"))"已配置" else "尚未配置",fontWeight=FontWeight.Medium)
    data.accountText("error").takeIf{it.isNotBlank()}?.let{Text(it,color=MaterialTheme.colors.error)}
    Box{
        OutlinedButton(onClick={providerOpen=true},enabled=enabled){Text(choices.firstOrNull{it.accountText("id")==provider}?.accountText("name")?:provider.ifBlank{"选择供应商"})}
        DropdownMenu(providerOpen,{providerOpen=false}){choices.forEach{choice->DropdownMenuItem(onClick={provider=choice.accountText("id");baseUrl=choice.accountText("baseUrl");apiMode=choice.accountText("apiMode");apiKey="";providerOpen=false}){Text(choice.accountText("name").ifBlank{choice.accountText("id")})}}}
    }
    if(deepseek)OutlinedTextField(provider,{provider=it;apiKey=""},label={Text("供应商 ID")},enabled=enabled,modifier=Modifier.fillMaxWidth(),singleLine=true)
    OutlinedTextField(baseUrl,{baseUrl=it},label={Text("服务地址")},enabled=enabled&&provider!="openai-codex",modifier=Modifier.fillMaxWidth(),singleLine=true)
    Box{
        OutlinedButton(onClick={protocolOpen=true},enabled=enabled&&provider!="openai-codex"){Text("接口协议："+(protocols.firstOrNull{it.first==apiMode}?.second?:apiMode))}
        DropdownMenu(protocolOpen,{protocolOpen=false}){protocols.forEach{(id,label)->DropdownMenuItem(onClick={apiMode=id;protocolOpen=false}){Text(label)}}}
    }
    OutlinedTextField(model,{model=it},label={Text("模型 ID")},enabled=enabled,modifier=Modifier.fillMaxWidth(),singleLine=true)
    if(provider!="openai-codex")OutlinedTextField(apiKey,{apiKey=it},label={Text(if(data.optBoolean("hasKey"))"API Key（同供应商、地址留空保留）" else "API Key")},visualTransformation=PasswordVisualTransformation(),enabled=enabled,modifier=Modifier.fillMaxWidth(),singleLine=true)
    if(provider=="openai-codex"){
        Text(if(data.optBoolean("oauthConfigured"))"已保存 OpenAI 授权" else "需要 OpenAI 授权",fontSize=13.sp)
        TextButton(onClick={action("oauth-start",JSONObject())},enabled=enabled){Text("登录 OpenAI")}
        if(result?.accountText("state")=="waiting"){
            val code=result.accountText("userCode")
            if(code.isNotBlank())Text("授权码：$code",fontWeight=FontWeight.Medium)
            if(result.accountText("verificationUrl")=="https://auth.openai.com/codex/device")TextButton(onClick={uriHandler.openUri("https://auth.openai.com/codex/device")}){Text("打开 OpenAI 授权页面")}
            NativeAccountActions{TextButton(onClick={action("oauth-status",JSONObject())},enabled=enabled){Text("刷新授权状态")};TextButton(onClick={action("oauth-cancel",JSONObject())},enabled=enabled){Text("取消授权")}}
        }
        result?.accountText("message")?.takeIf{it.isNotBlank()}?.let{Text(it,fontSize=13.sp)}
    }
    val payload={JSONObject().put("provider",provider).put("baseUrl",baseUrl).put("model",model).put("apiKey",apiKey).also{if(apiMode.isNotBlank())it.put("apiMode",apiMode)}}
    NativeAccountActions{
        TextButton(onClick={action("models",payload())},enabled=enabled&&baseUrl.isNotBlank()){Text("获取模型")}
        TextButton(onClick={action("test",payload())},enabled=enabled&&baseUrl.isNotBlank()&&model.isNotBlank()){Text("测试连接")}
    }
    val models=result?.optJSONArray("models")?:data.optJSONArray("modelChoices")?:JSONArray()
    if(models.length()>0){var open by remember{mutableStateOf(false)};Box{OutlinedButton(onClick={open=true},enabled=enabled){Text("选择模型（${models.length()}）")};DropdownMenu(open,{open=false}){(0 until models.length()).forEach{index->val name=models.optString(index);DropdownMenuItem(onClick={model=name;open=false}){Text(name)}}}}}
    Button(onClick={action("save",payload())},enabled=enabled&&baseUrl.isNotBlank()&&model.isNotBlank(),modifier=Modifier.fillMaxWidth().testTag("saveModelAccount")){Text("保存配置")}
}
